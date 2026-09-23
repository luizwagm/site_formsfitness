/* ==========================================================================
   gestao/rotas.js — a API da gestão da academia

   Três portas, cada uma com a sua regra de entrada:

     publico(req,res,p)            SEM login — só o formulário de matrícula do
                                   site e a lista de turmas que ele oferece
     api(req,res,p,usuario)        /api/gestao/…  — exige login
     imprimir(req,res,p,usuario)   /admin/imprimir/… e /admin/arquivo/… —
                                   páginas e imagens, também só com login

   As regras de negócio moram AQUI, e não na tela: a tela esconde o botão de
   apagar um aluno com contrato, mas quem garante que ele não é apagado é a
   rota. Tela se contorna com um fetch; rota não.
   ========================================================================== */
"use strict";

const path = require("node:path");
const U = require("./util");
const D = require("./documentos");
const { CODIGO_INICIAL } = require("./esquema");
const { criarAuditoria } = require("./auditoria");
const { lerVersoes } = require("./sobre");
const { criarBuscaCep } = require("./cep");
const { lerConfig: lerConfigSicredi, criarSicredi } = require("./sicredi");
const { criarCobranca } = require("./cobranca");
const { carneHTML } = require("./carne");

const agora = () => new Date().toISOString();
const ESTADOS_CIVIS = ["Solteiro(a)", "Casado(a)", "União estável", "Separado(a)", "Divorciado(a)", "Viúvo(a)"];
const SEXOS = ["Masculino", "Feminino", "Outro"];
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

/* Todos os campos de texto do cadastro, e o tamanho máximo de cada um. Uma
   lista de PERMISSÃO: o que não está aqui não é gravado, venha de onde vier. */
const TEXTO_ALUNO = {
  nome: 120, sexo: 20, nascimento: 10, estado_civil: 30, nacionalidade: 40,
  rg: 30, rg_emissor: 20, cpf: 14, email: 120, profissao: 80,
  fone1: 20, fone2: 20, instagram: 60,
  logradouro: 120, numero: 20, complemento: 60, bairro: 80, cidade: 80, uf: 2, cep: 9,
  pai: 120, mae: 120,
  resp_nome: 120, resp_nacionalidade: 40, resp_cpf: 14, resp_rg: 30, resp_rg_emissor: 20,
  resp_nascimento: 10, resp_fone: 20, resp_profissao: 80, resp_estado_civil: 30,
  resp_end_trabalho: 160, resp_fone_trabalho: 20,
  horario_desejado: 60, data_matricula: 10, observacao: 1000,
};

const limpar = (v, max) => String(v ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, max);
const dataValida = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));

class Recusa extends Error {
  constructor(status, mensagem, extra) { super(mensagem); this.status = status; this.extra = extra; }
}

function criar(ctx) {
  const { db, getS, setS, hashSenha, confereSenha, htmlLimpo, readBody, json, ipDoCliente, CSP_IMPRESSAO } = ctx;
  const auditoria = criarAuditoria(db);
  /* A consulta de CEP é criada uma vez: ela guarda as respostas por um dia. */
  const buscarCep = criarBuscaCep();

  /* ------------------------------------------------ boletos Sicredi (1.26.0)
     Sem as credenciais no .env, `sicredi` fica nulo e as telas dizem o que
     falta em vez de oferecer um botão que não funciona. O beneficiário (nome e
     CNPJ que saem no carnê) é o do contrato; `g_boleto_beneficiario_*` troca
     sem mexer em código, se um dia a razão social mudar. */
  const cfgSicredi = lerConfigSicredi();
  const sicredi = cfgSicredi.configurado ? criarSicredi(cfgSicredi) : null;
  const beneficiario = () => ({
    nome: getS("g_boleto_beneficiario_nome") || "FORMS FITNESS ACADEMIA AQUATICA",
    documento: getS("g_boleto_beneficiario_doc") || "02.192.745/0001-25",
  });
  const cobranca = criarCobranca({ db, cfg: cfgSicredi, sicredi, beneficiario });
  const semSicredi = () => new Recusa(503, `Boletos ainda não configurados no servidor. Falta: ${cfgSicredi.faltam.join(", ")}.`);

  /* ------------------------------------------------------------ consultas */
  const um = (sql, ...a) => db.prepare(sql).get(...a);
  const todos = (sql, ...a) => db.prepare(sql).all(...a);
  const roda = (sql, ...a) => db.prepare(sql).run(...a);

  /* O "alvo" da auditoria: de QUEM era o cadastro que mudou. Resolvido ANTES
     de a rota agir — depois de apagar uma pré-matrícula não há mais nome
     para ler. */
  function alvoDaRota(rota) {
    let r;
    try {
      if ((r = /^\/alunos\/(\d+)/.exec(rota))) {
        /* Pré-matrícula entra só pelo NÚMERO: ela pode ser apagada (a
           política de privacidade promete), e a auditoria não se apaga.
           Aluno efetivado tem contrato — aí o nome e o código entram. */
        const a = um("SELECT nome, codigo, status FROM g_alunos WHERE id=?", Number(r[1]));
        if (!a) return "";
        return a.status === "pendente" ? `pré-matrícula nº ${Number(r[1])}` : `${a.nome} (${U.codigoFormatado(a.codigo)})`;
      }
      if ((r = /^\/contratos\/(\d+)/.exec(rota))) {
        const c = um("SELECT c.id, al.nome FROM g_contratos c JOIN g_alunos al ON al.id=c.aluno_id WHERE c.id=?", Number(r[1]));
        return c ? `contrato nº ${c.id} — ${c.nome}` : "";
      }
      if ((r = /^\/boletos\/(\d+)/.exec(rota))) {
        const b = um("SELECT b.competencia, al.nome, al.codigo FROM g_boletos b JOIN g_alunos al ON al.id=b.aluno_id WHERE b.id=?", Number(r[1]));
        return b ? `boleto de ${b.competencia} — ${b.nome} (${U.codigoFormatado(b.codigo)})` : "";
      }
      if ((r = /^\/turmas\/(\d+)/.exec(rota))) { const t = turmaCompleta(Number(r[1])); return t ? rotuloTurma(t) : ""; }
      if ((r = /^\/atividades\/(\d+)/.exec(rota))) return um("SELECT nome FROM g_atividades WHERE id=?", Number(r[1]))?.nome || "";
      if ((r = /^\/feriados\/(\d+)/.exec(rota))) return um("SELECT nome FROM g_feriados WHERE id=?", Number(r[1]))?.nome || "";
      if ((r = /^\/professores\/(\d+)/.exec(rota))) return um("SELECT nome FROM g_professores WHERE id=?", Number(r[1]))?.nome || "";
      if ((r = /^\/usuarios\/(\d+)/.exec(rota))) {
        const u = um("SELECT nome, login FROM usuarios WHERE id=?", Number(r[1]));
        return u ? `${u.nome} (${u.login})` : "";
      }
    } catch {}
    return "";
  }

  /* O que sai no rodapé da agenda impressa e da imagem para rede social:
     só o contato PÚBLICO que o site já mostra. */
  const contatoPublico = () => ({
    site: String(ctx.site || "").replace(/^https?:\/\//, ""),
    instagram: getS("instagram") ? "@" + String(getS("instagram")).replace(/^.*instagram\.com\//, "").replace(/[@/]/g, "") : "",
    whatsapp: getS("whatsapp_display") || "",
  });

  /* O rodapé do contrato: site, e-mail administrativo, Instagram e WhatsApp.
     Site, Instagram e WhatsApp vêm do Contato do site (um lugar só para cada
     dado); o e-mail administrativo é da gestão — pode não ser o de contato
     do site — e, vazio, usa o de contato. */
  const emailAdministrativo = () => getS("g_email_admin") || getS("contact_email") || "";
  const rodapeContrato = () => {
    const c = contatoPublico(), email = emailAdministrativo();
    return [c.site && `Site: ${c.site}`, email && `E-mail: ${email}`,
      c.instagram && `Instagram: ${c.instagram}`, c.whatsapp && `WhatsApp: ${c.whatsapp}`].filter(Boolean);
  };

  const diasAula = () => {
    try {
      const v = JSON.parse(getS("g_dias_aula") || "[]");
      return Array.isArray(v) ? v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    } catch { return []; }
  };
  const rotuloTurma = (t) => (t ? `${t.atividade_nome || "?"} — ${t.horario}${t.horario_fim ? "–" + t.horario_fim : ""}` : "");
  /* O nome do professor da turma sai SEMPRE do cadastro (1.23.0). Vem depois
     de `t.*` de propósito: a coluna antiga g_turmas.professor (o texto de
     antes) tem o mesmo nome, e nos dois drivers a última coluna vence — assim
     nenhuma tela lê o texto velho por engano. */
  const PROF_TURMA = "(SELECT nome FROM g_professores WHERE id=t.professor_id) AS professor";
  const turmaCompleta = (id) => (id ? um(`SELECT t.*, a.nome AS atividade_nome, a.ativo AS atividade_ativa, ${PROF_TURMA}
    FROM g_turmas t JOIN g_atividades a ON a.id=t.atividade_id WHERE t.id=?`, id) : null);

  /* O próximo código continua a numeração antiga. Quem cadastrar à mão um
     aluno antigo com o código dele (3879, por exemplo) não empurra a
     sequência para trás: ela segue do maior entre 4148 e o maior existente. */
  const proximoCodigo = () => {
    const m = um("SELECT MAX(codigo) AS m FROM g_alunos").m || 0;
    return Math.max(CODIGO_INICIAL - 1, m) + 1;
  };

  /* ==========================================================================
     MATRÍCULAS — as turmas de cada aluno (1.22.0)

     Um aluno pode fazer natação às 06h e hidroginástica às 07h. Cada turma é
     uma linha em g_matriculas, com a mensalidade dela; o TOTAL fica em
     g_alunos.mensalidade, que é o valor do contrato.

     Turma com vagas pode receber aluno além do limite — a academia decide, o
     sistema só AVISA (`avisosDeVagas`). Recusar travaria a secretaria no
     balcão por causa de um número que ela mesma cadastrou.
     ========================================================================== */
  const lerDias = (txt) => {
    try { const v = JSON.parse(txt || "[]"); return Array.isArray(v) ? v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : []; }
    catch { return []; }
  };
  const matriculasDo = (alunoId) => todos(`SELECT m.id, m.turma_id, m.mensalidade, m.dias, m.professor_id, t.horario, t.horario_fim,
      t.vagas, t.ativo AS turma_ativa, a.id AS atividade_id, a.nome AS atividade_nome, a.mensalidade AS mensalidade_padrao,
      (SELECT nome FROM g_professores WHERE id=t.professor_id) AS professor_turma,
      COALESCE((SELECT nome FROM g_professores WHERE id=m.professor_id), (SELECT nome FROM g_professores WHERE id=t.professor_id), '') AS professor
    FROM g_matriculas m JOIN g_turmas t ON t.id=m.turma_id JOIN g_atividades a ON a.id=t.atividade_id
    WHERE m.aluno_id=? ORDER BY t.horario, a.nome`, alunoId).map((x) => ({ ...x, dias: lerDias(x.dias), rotulo: rotuloTurma(x) }));

  const contaMatriculas = (alunoId) => um("SELECT COUNT(*) AS n FROM g_matriculas WHERE aluno_id=?", alunoId).n;

  /* Quantos alunos ATIVOS a turma tem. Pré-matrícula não ocupa vaga: ainda
     não é aluno, e pode nunca vir a ser. */
  const ocupacao = (turmaId) => um(`SELECT COUNT(*) AS n FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id
    WHERE m.turma_id=? AND al.status='ativo'`, turmaId).n;

  /* A lista que a tela manda: [{ turma_id, dias, mensalidade }]. Linha sem
     turma é ignorada (é a linha em branco que a tela oferece); a mesma turma
     duas vezes é recusada. Mensalidade vazia usa a da atividade; dias vazios
     usam os dias de aula da academia — como na ficha antiga, em que cada
     atividade do aluno tinha os dias marcados. */
  function normalizarMatriculas(lista, alunoId = 0) {
    if (!Array.isArray(lista)) throw new Recusa(400, "Lista de atividades inválida.");
    if (lista.length > 12) throw new Recusa(400, "Atividades demais para um aluno só.");
    const jaTinha = new Set(alunoId ? todos("SELECT turma_id FROM g_matriculas WHERE aluno_id=?", alunoId).map((x) => x.turma_id) : []);
    const vistas = new Set();
    const saida = [];
    for (const item of lista) {
      const turma_id = Number(item && item.turma_id) || 0;
      if (!turma_id) continue;
      if (vistas.has(turma_id)) throw new Recusa(400, "A mesma turma aparece duas vezes nas atividades.");
      vistas.add(turma_id);
      const turma = turmaCompleta(turma_id);
      if (!turma) throw new Recusa(400, "Turma não encontrada.");
      /* Turma encerrada fica se o aluno JÁ estava nela: abrir o cadastro e
         salvar sem mexer não pode tirá-lo de lá sem ninguém ver. */
      if ((!turma.ativo || !turma.atividade_ativa) && !jaTinha.has(turma_id))
        throw new Recusa(400, `A turma ${rotuloTurma(turma)} não está ativa.`);
      const bruto = item.mensalidade;
      const mensalidade = bruto === undefined || bruto === null || String(bruto).trim() === ""
        ? (um("SELECT mensalidade FROM g_atividades WHERE id=?", turma.atividade_id)?.mensalidade || 0)
        : U.paraCentavos(bruto);
      if (mensalidade === null || mensalidade < 0) throw new Recusa(400, `Mensalidade inválida em ${rotuloTurma(turma)} (use, por exemplo, 110,00).`);
      let dias = Array.isArray(item.dias) ? [...new Set(item.dias.map(Number))] : [];
      if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Recusa(400, `Dia da semana inválido em ${rotuloTurma(turma)}.`);
      if (!dias.length) dias = diasAula();
      /* Professor desta matrícula: vazio = o da turma. Inativo só fica se já
         era o desta matrícula. */
      const professor_id = Number(item.professor_id) || null;
      if (professor_id) {
        const prof = um("SELECT ativo FROM g_professores WHERE id=?", professor_id);
        if (!prof) throw new Recusa(400, `Professor não encontrado em ${rotuloTurma(turma)}.`);
        const jaEra = alunoId && um("SELECT 1 AS s FROM g_matriculas WHERE aluno_id=? AND turma_id=? AND professor_id=?", alunoId, turma_id, professor_id);
        if (!prof.ativo && !jaEra) throw new Recusa(400, `O professor escolhido em ${rotuloTurma(turma)} está inativo.`);
      }
      saida.push({ turma_id, mensalidade, dias: dias.sort((x, y) => x - y), professor_id });
    }
    return saida;
  }

  /* Grava por DIFERENÇA, e não apagando tudo e recriando: a data em que o
     aluno entrou em cada turma (criado_em) sobrevive a uma edição qualquer. */
  function gravarMatriculas(alunoId, lista) {
    db.exec("BEGIN");
    try {
      const atuais = todos("SELECT id, turma_id FROM g_matriculas WHERE aluno_id=?", alunoId);
      const novas = new Map(lista.map((x) => [x.turma_id, x]));
      for (const m of atuais) if (!novas.has(m.turma_id)) roda("DELETE FROM g_matriculas WHERE id=?", m.id);
      for (const x of lista) {
        const existe = atuais.find((m) => m.turma_id === x.turma_id);
        if (existe) roda("UPDATE g_matriculas SET mensalidade=?, dias=?, professor_id=? WHERE id=?", x.mensalidade, JSON.stringify(x.dias), x.professor_id, existe.id);
        else roda("INSERT INTO g_matriculas(aluno_id,turma_id,mensalidade,dias,professor_id,criado_em) VALUES(?,?,?,?,?,?)",
          alunoId, x.turma_id, x.mensalidade, JSON.stringify(x.dias), x.professor_id, agora());
      }
      roda("UPDATE g_alunos SET mensalidade=? WHERE id=?", lista.reduce((s, x) => s + x.mensalidade, 0), alunoId);
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
  }

  /* O que a tela deve avisar depois de salvar. Aluno ativo acima do limite:
     "passou do limite". Pré-matrícula numa turma já cheia: avisa que, ao
     efetivar, vai passar. */
  function avisosDeVagas(alunoId) {
    const aluno = um("SELECT status FROM g_alunos WHERE id=?", alunoId);
    if (!aluno || aluno.status === "inativo") return [];
    const avisos = [];
    for (const m of matriculasDo(alunoId)) {
      if (!m.vagas) continue;
      const n = ocupacao(m.turma_id);
      if (aluno.status === "ativo" && n > m.vagas)
        avisos.push(`A turma ${m.rotulo} passou do limite: ${n} alunos para ${m.vagas} ${m.vagas === 1 ? "vaga" : "vagas"}.`);
      else if (aluno.status === "pendente" && n >= m.vagas)
        avisos.push(`A turma ${m.rotulo} já está completa (${n} de ${m.vagas}): ao efetivar, passará do limite.`);
    }
    return avisos;
  }

  /* As matrículas que vieram no corpo. `matriculas` é o formato da tela;
     `turma_id` solto é o de antes da 1.22 (cliente antigo, scripts), e vira
     uma lista de uma turma. Sem nenhum dos dois: não mexe nas matrículas. */
  function matriculasDoCorpo(b, alunoId) {
    if (Array.isArray(b.matriculas)) return normalizarMatriculas(b.matriculas, alunoId);
    if ("turma_id" in b) return normalizarMatriculas(b.turma_id ? [{ turma_id: b.turma_id, mensalidade: b.mensalidade }] : [], alunoId);
    return null;
  }

  /* O rótulo das atividades de vários alunos de uma vez (listas e
     relatórios), numa consulta só. */
  function atividadesPorAluno() {
    const mapa = new Map();
    for (const l of todos(`SELECT m.aluno_id, t.horario, t.horario_fim, a.nome AS atividade_nome
        FROM g_matriculas m JOIN g_turmas t ON t.id=m.turma_id JOIN g_atividades a ON a.id=t.atividade_id
        ORDER BY t.horario, a.nome`)) {
      if (!mapa.has(l.aluno_id)) mapa.set(l.aluno_id, []);
      mapa.get(l.aluno_id).push(rotuloTurma(l));
    }
    return (id) => (mapa.get(id) || []).join(" · ");
  }

  /* ==========================================================================
     NORMALIZAR UM CADASTRO

     Serve às duas portas (gestão e site). `rigoroso` liga as exigências do
     formulário público — onde quem digita é o próprio titular, e um CPF com
     número trocado não tem desculpa. Na gestão a secretaria pode estar
     copiando uma ficha antiga incompleta, e travar o cadastro por falta do
     RG do pai só a faria desistir do sistema.
     ========================================================================== */
  function normalizarAluno(b, { rigoroso = false } = {}) {
    const a = {};
    for (const [campo, max] of Object.entries(TEXTO_ALUNO)) if (campo in b) a[campo] = limpar(b[campo], max);

    const erros = [];
    if ("nome" in a && a.nome.length < 3) erros.push("Informe o nome completo.");
    for (const campo of ["nascimento", "resp_nascimento", "data_matricula"])
      if (a[campo] && !dataValida(a[campo])) erros.push(`Data inválida em ${campo.replace("_", " ")}.`);
    if (a.nascimento && U.idade(a.nascimento) === null) erros.push("A data de nascimento não parece certa.");
    if (a.uf) a.uf = a.uf.toUpperCase();
    if (a.uf && !UFS.includes(a.uf)) erros.push("Estado (UF) inválido.");
    if (a.estado_civil && !ESTADOS_CIVIS.includes(a.estado_civil)) erros.push("Estado civil inválido.");
    if (a.resp_estado_civil && !ESTADOS_CIVIS.includes(a.resp_estado_civil)) erros.push("Estado civil do responsável inválido.");
    if (a.sexo && !SEXOS.includes(a.sexo)) erros.push("Sexo inválido.");
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a.email)) erros.push("E-mail inválido.");
    for (const campo of ["cpf", "resp_cpf"]) if (a[campo]) a[campo] = U.formatarCpf(a[campo]);

    /* Dia de vencimento do boleto (1.26.0). Vazio = 0 = "o da matrícula". */
    if ("dia_vencimento" in b) {
      const d = String(b.dia_vencimento ?? "").trim();
      if (d === "" || d === "0") a.dia_vencimento = 0;
      else if (/^\d{1,2}$/.test(d) && Number(d) >= 1 && Number(d) <= 31) a.dia_vencimento = Number(d);
      else erros.push("Dia de vencimento inválido (use de 1 a 31).");
    }

    if ("mensalidade" in b) {
      const c = U.paraCentavos(b.mensalidade);
      if (c === null || c < 0) erros.push("Mensalidade inválida (use, por exemplo, 110,00).");
      else a.mensalidade = c;
    }

    if (rigoroso) {
      const menor = U.ehMenor(a.nascimento);
      const faltam = [];
      for (const [c, rot] of [["nome", "nome"], ["nascimento", "data de nascimento"], ["sexo", "sexo"],
        ["mae", "nome da mãe"], ["fone1", "WhatsApp"], ["logradouro", "rua"], ["numero", "número"],
        ["bairro", "bairro"], ["cidade", "cidade"], ["uf", "estado"], ["cep", "CEP"]])
        if (!a[c]) faltam.push(rot);
      if (menor) {
        for (const [c, rot] of [["resp_nome", "nome do responsável"], ["resp_cpf", "CPF do responsável"],
          ["resp_rg", "RG do responsável"], ["resp_fone", "telefone do responsável"]])
          if (!a[c]) faltam.push(rot);
        if (a.resp_cpf && !U.cpfValido(a.resp_cpf)) erros.push("O CPF do responsável não confere. Verifique os números.");
      } else if (a.nascimento) {
        if (!a.cpf) faltam.push("CPF");
        else if (!U.cpfValido(a.cpf)) erros.push("O CPF não confere. Verifique os números.");
      }
      if (faltam.length) erros.unshift(`Faltou preencher: ${faltam.join(", ")}.`);
      if (a.cep && !/^\d{5}-?\d{3}$/.test(a.cep)) erros.push("CEP inválido.");
    }
    if (erros.length) throw new Recusa(400, erros[0], { erros });
    return a;
  }

  function conferirTurma(id, { soPublica = false } = {}) {
    if (!id) return;
    const t = turmaCompleta(id);
    if (!t || !t.ativo || !t.atividade_ativa || (soPublica && !t.publica))
      throw new Recusa(400, "A turma escolhida não está disponível.");
  }

  /* ==========================================================================
     IMAGENS — pelo conteúdo, não pelo nome

     O navegador diz "image/jpeg" no dataURL, mas quem controla o dataURL
     controla o que ele diz. A assinatura dos bytes é o que decide: um HTML
     renomeado nunca começa com FF D8 FF.
     ========================================================================== */
  function lerImagem(dataUrl, maxBytes) {
    const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m) throw new Recusa(400, "Envie uma imagem JPG, PNG ou WEBP.");
    const b = Buffer.from(m[1], "base64");
    if (b.length > maxBytes) throw new Recusa(413, `Imagem grande demais (máx. ${Math.round(maxBytes / 1024)} KB).`);
    let mime = "";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = "image/jpeg";
    else if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = "image/png";
    else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
    if (!mime) throw new Recusa(400, "O arquivo não é uma imagem JPG, PNG ou WEBP.");
    return { mime, dados: b };
  }

  /* (1.27.0) O COMPROVANTE aceita mais que imagem: o do aplicativo do banco
     costuma ser PDF, e obrigar a pessoa a printar o PDF para depois fotografar
     a tela é o tipo de exigência que faz desistir da matrícula. A assinatura
     dos bytes continua sendo quem decide — "%PDF-" no começo, e não a extensão
     nem o que o navegador afirmou. */
  function lerAnexo(dataUrl, maxBytes) {
    const m = /^data:(image\/[a-z+]+|application\/pdf);base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ""));
    if (!m) throw new Recusa(400, "Envie uma imagem (JPG, PNG, WEBP) ou um PDF.");
    const b = Buffer.from(m[2], "base64");
    if (b.length > maxBytes) throw new Recusa(413, `Arquivo grande demais (máx. ${Math.round(maxBytes / 1024 / 1024)} MB).`);
    if (b.toString("ascii", 0, 5) === "%PDF-") return { mime: "application/pdf", dados: b };
    return lerImagem(dataUrl, maxBytes);
  }

  /* ==========================================================================
     PORTA 1 — O FORMULÁRIO DO SITE (sem login)
     ========================================================================== */

  /* Freio próprio do formulário: 5 envios por hora por endereço. É um site de
     academia, não um cadastro de massa — quem precisa de mais que isso é robô.
     O limitador de senha não serve aqui: ele conta ERROS, e um robô de
     cadastro acerta todas as vezes. */
  const envios = new Map();
  const LIMITE_ENVIOS = 5, JANELA = 3600_000;
  /* Cada anexo, já decodificado. A foto sai do navegador reduzida a 1024 px;
     2 MB é folga para o celular que não conseguiu reduzir. O comprovante tem
     mais porque PDF de banco com logotipo passa fácil de 1 MB. */
  const FOTO_MAX = 2 * 1024 * 1024, COMPROVANTE_MAX = 4 * 1024 * 1024;
  setInterval(() => {
    const corte = Date.now() - JANELA;
    for (const [ip, lista] of envios) {
      const vivos = lista.filter((t) => t > corte);
      if (vivos.length) envios.set(ip, vivos); else envios.delete(ip);
    }
  }, 10 * 60_000).unref();

  /* Corpo pequeno: os CAMPOS do cadastro cabem em poucos KB. O leitor genérico
     do servidor aceita 25 MB (é o do upload de foto) — aberto ao público, seria
     um convite para encher a memória.

     (1.27.0) A matrícula passou a trazer a foto do aluno e o comprovante, então
     o corpo dela cresceu — mas com teto próprio (ver ANEXO_MAX): o navegador já
     reduz a foto antes de subir, e o limite de 5 envios por hora por endereço
     continua valendo. Quem chega perto deste teto é PDF de banco, não foto. */
  const lerPequeno = (req, max = 32 * 1024) => new Promise((ok, falha) => {
    let d = "", n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > max) { falha(new Recusa(413, "Envio grande demais.")); req.destroy(); return; }
      d += c;
    });
    req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { falha(new Recusa(400, "Envio inválido.")); } });
    req.on("error", falha);
  });

  async function publico(req, res, p) {
    if (p === "/api/publico/turmas" && req.method === "GET") {
      const lista = todos(`SELECT t.id, t.horario, t.horario_fim, a.nome AS atividade_nome
        FROM g_turmas t JOIN g_atividades a ON a.id=t.atividade_id
        WHERE t.ativo=1 AND t.publica=1 AND a.ativo=1 ORDER BY a.nome, t.horario`);
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { turmas: lista.map((t) => ({ id: t.id, rotulo: rotuloTurma(t) })),
        dias: U.diasPorExtenso(diasAula()) });
      return true;
    }

    if (p === "/api/publico/matricula" && req.method === "POST") {
      try {
        const ip = ipDoCliente(req);
        const corte = Date.now() - JANELA;
        const minhas = (envios.get(ip) || []).filter((t) => t > corte);
        if (minhas.length >= LIMITE_ENVIOS) {
          res.setHeader("Retry-After", "3600");
          throw new Recusa(429, "Muitos envios deste endereço. Tente de novo mais tarde ou fale conosco pelo WhatsApp.");
        }
        const b = await lerPequeno(req, 10 * 1024 * 1024);

        /* O campo-isca fica escondido por CSS: gente não vê e não preenche;
           robô de formulário preenche tudo o que encontra. Resposta de
           SUCESSO para ele — um erro ensinaria o robô a desviar. */
        if (b.site_url) { json(res, 200, { ok: true }); return true; }

        if (!b.aceite_termos || !b.aceite_dados)
          throw new Recusa(400, "Para enviar, marque as autorizações do fim do formulário.");

        const a = normalizarAluno(b, { rigoroso: true });
        /* Desde a 1.21.0 o site só oferece os horários CADASTRADOS: texto
           livre ("terça às 10h, se tiver") não vira turma, e a secretaria
           tinha de adivinhar. Sem turma aberta, não há matrícula online. */
        delete a.horario_desejado;
        const turmaId = Number(b.turma_id) || 0;
        if (!turmaId) throw new Recusa(400, "Escolha o horário da turma.");
        conferirTurma(turmaId, { soPublica: true });
        const mats = normalizarMatriculas([{ turma_id: turmaId }]);
        delete a.mensalidade;

        /* O consentimento fica gravado junto do cadastro: o que foi aceito e
           quando. A LGPD pede consentimento específico de quem responde por
           uma criança — e consentimento que não se consegue mostrar depois
           não existe. O IP NÃO é guardado: não é necessário para a matrícula. */
        a.consentimento = JSON.stringify({
          em: agora(), termos: true, dados: true,
          menor: U.ehMenor(a.nascimento), por: U.ehMenor(a.nascimento) ? "responsável legal" : "o próprio aluno",
        });
        /* (1.27.0) Foto e comprovante são OBRIGATÓRIOS, e são conferidos aqui,
           antes de o cadastro existir: uma pré-matrícula sem os dois documentos
           é trabalho que a secretaria teria de correr atrás por fora, que é o
           que esta mudança veio acabar. Decodificar antes de gravar também
           garante que um arquivo recusado não deixe cadastro pela metade. */
        if (!b.foto) throw new Recusa(400, "Envie a foto do aluno.");
        if (!b.comprovante) throw new Recusa(400, "Envie o comprovante de pagamento.");
        const fotoArq = lerImagem(b.foto, FOTO_MAX);
        const compArq = lerAnexo(b.comprovante, COMPROVANTE_MAX);

        a.status = "pendente";
        a.origem = "site";
        a.criado_em = agora();
        a.criado_por = "formulário do site";
        /* Os três INSERTs numa transação: pré-matrícula sem documento, ou
           documento sem dono, seria lixo que ninguém encontra para apagar. */
        const guardar = db.transaction(() => {
          const foto = roda("INSERT INTO g_arquivos(tipo,mime,dados,criado_em,criado_por) VALUES('foto',?,?,?,?)",
            fotoArq.mime, fotoArq.dados, agora(), "formulário do site");
          const comp = roda("INSERT INTO g_arquivos(tipo,mime,dados,criado_em,criado_por) VALUES('comprovante',?,?,?,?)",
            compArq.mime, compArq.dados, agora(), "formulário do site");
          a.foto_id = Number(foto.lastInsertRowid);
          a.comprovante_id = Number(comp.lastInsertRowid);
          const campos = Object.keys(a);
          return roda(`INSERT INTO g_alunos(${campos.join(",")}) VALUES(${campos.map(() => "?").join(",")})`,
            ...campos.map((c) => a[c]));
        });
        const novo = guardar();
        gravarMatriculas(Number(novo.lastInsertRowid), mats);

        minhas.push(Date.now()); envios.set(ip, minhas);
        /* Na auditoria, SEM o IP e SEM o nome: a política de privacidade
           promete que o endereço de quem envia não é guardado, e que a
           pré-matrícula que não se confirma é apagada. A auditoria não se
           apaga — com o nome da criança nela, a promessa viraria mentira.
           O número basta para cruzar com o cadastro enquanto ele existir. */
        auditoria.registrar({ usuario: { login: "formulário do site" }, acao: "Pré-matrícula recebida pelo site",
          alvo: `pré-matrícula nº ${Number(novo.lastInsertRowid)}`, metodo: "POST", rota: p, status: 200 });
        console.log(`  · pré-matrícula recebida pelo site: ${a.nome}`);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, e.status || 500, { error: e.status ? e.message : "Não foi possível enviar agora.", erros: e.extra?.erros });
        if (!e.status) console.error("  ✖ matrícula pública:", e.message);
      }
      return true;
    }
    return false;
  }

  /* ==========================================================================
     PORTA 2 — A API DA GESTÃO (com login)
     ========================================================================== */
  async function api(req, res, p, usuario) {
    if (!p.startsWith("/api/gestao/")) return false;
    const rota = p.slice("/api/gestao".length);
    const m = (re) => re.exec(rota);
    const corpo = () => readBody(req);
    const quem = usuario.nome;
    const q = new URL(req.url, "http://x").searchParams;
    let r;
    if (req.method !== "GET") res.auditoria = { alvo: alvoDaRota(rota) };

    try {
      /* ------------------------------------------------------------ resumo */
      if (rota === "/resumo") return json(res, 200, {
        pendentes: um("SELECT COUNT(*) AS n FROM g_alunos WHERE status='pendente'").n,
        ativos: um("SELECT COUNT(*) AS n FROM g_alunos WHERE status='ativo'").n,
        inativos: um("SELECT COUNT(*) AS n FROM g_alunos WHERE status='inativo'").n,
        proximo_codigo: proximoCodigo(), dias_aula: diasAula(),
        estados_civis: ESTADOS_CIVIS, sexos: SEXOS, ufs: UFS,
        usuario: { id: usuario.id, nome: usuario.nome, login: usuario.login, admin: !!usuario.admin },
      }), true;

      /* --------------------------------------------------------------- CEP
         (1.26.0) O painel digita o CEP e recebe rua, bairro, cidade e UF. Só
         GET e só com login: aberto, isto viraria um repasse gratuito de
         consultas para quem quisesse usar o nosso servidor. Ver gestao/cep.js. */
      if ((r = m(/^\/cep\/(\d{5}-?\d{3})$/)) && req.method === "GET") {
        try {
          const achado = await buscarCep(r[1]);
          return achado ? json(res, 200, achado) : json(res, 404, { error: "CEP não encontrado." }), true;
        } catch (e) {
          if (e.indisponivel) return json(res, 503, { error: e.message }), true;
          throw e;
        }
      }

      /* ------------------------------------------------------------ alunos */
      if (rota === "/alunos" && req.method === "GET") {
        const status = q.get("status") || "";
        const busca = limpar(q.get("q"), 80);
        const onde = [], args = [];
        if (["ativo", "inativo", "pendente"].includes(status)) { onde.push("al.status=?"); args.push(status); }
        if (busca) {
          const dig = busca.replace(/\D/g, "");
          const partes = ["al.nome LIKE ?", "al.resp_nome LIKE ?"];
          args.push(`%${busca}%`, `%${busca}%`);
          if (dig) {
            partes.push("CAST(al.codigo AS TEXT) = ?", "REPLACE(REPLACE(al.cpf,'.',''),'-','') LIKE ?",
              "REPLACE(REPLACE(al.resp_cpf,'.',''),'-','') LIKE ?");
            args.push(String(Number(dig)), `%${dig}%`, `%${dig}%`);
          }
          onde.push(`(${partes.join(" OR ")})`);
        }
        /* Em PÁGINAS quando a tela pede (`pagina` e `por`): a academia tem
           milhares de alunos no histórico, e a lista antiga cortava em 500
           sem avisar. Sem `pagina`, devolve todos (a tela de relatórios
           precisa da lista inteira para o select da ficha). `al.id` no fim da
           ordem deixa a página estável entre dois nomes iguais. */
        const where = onde.length ? "WHERE " + onde.join(" AND ") : "";
        const total = um(`SELECT COUNT(*) AS n FROM g_alunos al ${where}`, ...args).n;
        const paginado = q.has("pagina");
        const por = Math.min(Math.max(Number(q.get("por")) || 20, 1), 200);
        const pagina = Math.max(1, Math.min(Number(q.get("pagina")) || 1, Math.max(1, Math.ceil(total / por))));
        const linhas = todos(`SELECT al.id, al.codigo, al.nome, al.nascimento, al.status, al.origem, al.fone1,
            al.resp_nome, al.resp_fone, al.criado_em, al.horario_desejado,
            (SELECT COUNT(*) FROM g_contratos c WHERE c.aluno_id=al.id) AS contratos
          FROM g_alunos al ${where}
          ORDER BY CASE al.status WHEN 'pendente' THEN 0 ELSE 1 END, al.nome COLLATE NOCASE, al.id
          ${paginado ? "LIMIT ? OFFSET ?" : ""}`, ...args, ...(paginado ? [por, (pagina - 1) * por] : []));
        const atividadesDe = atividadesPorAluno();
        return json(res, 200, { total, ...(paginado ? { pagina, por } : {}), alunos: linhas.map((l) => ({
          ...l, idade: U.idade(l.nascimento), menor: U.ehMenor(l.nascimento),
          turma: atividadesDe(l.id) || (l.horario_desejado ? `desejado: ${l.horario_desejado}` : ""),
          codigo_fmt: U.codigoFormatado(l.codigo),
        })) }), true;
      }

      if (rota === "/alunos" && req.method === "POST") {
        const b = await corpo();
        const a = normalizarAluno(b);
        if (!a.nome) throw new Recusa(400, "Informe o nome completo.");
        const mats = matriculasDoCorpo(b, 0);
        if (mats) delete a.mensalidade;
        a.codigo = await definirCodigo(b.codigo);
        a.status = ["ativo", "inativo"].includes(b.status) ? b.status : "ativo";
        a.origem = "sistema";
        a.data_matricula = a.data_matricula || U.hojeLocal();
        a.criado_em = agora(); a.criado_por = quem;
        const campos = Object.keys(a);
        const info = roda(`INSERT INTO g_alunos(${campos.join(",")}) VALUES(${campos.map(() => "?").join(",")})`,
          ...campos.map((c) => a[c]));
        const novoId = Number(info.lastInsertRowid);
        if (mats) gravarMatriculas(novoId, mats);
        res.auditoria = { alvo: `${a.nome}${a.codigo ? ` (${U.codigoFormatado(a.codigo)})` : ""}` };
        return json(res, 200, { ok: true, id: novoId, codigo: a.codigo, avisos: avisosDeVagas(novoId),
          matriculas: contaMatriculas(novoId) }), true;
      }

      if ((r = m(/^\/alunos\/(\d+)$/))) {
        const id = Number(r[1]);
        const atual = um("SELECT * FROM g_alunos WHERE id=?", id);
        if (!atual) throw new Recusa(404, "Aluno não encontrado.");

        if (req.method === "GET") {
          /* (1.27.0) A tela precisa saber se o comprovante é PDF: imagem ela
             mostra, PDF ela oferece para abrir. O MIME mora no arquivo, e não
             no cadastro — perguntar aqui evita um segundo pedido só para isso. */
          const comp = atual.comprovante_id
            ? um("SELECT mime FROM g_arquivos WHERE id=?", atual.comprovante_id) : null;
          return json(res, 200, { aluno: { ...atual, codigo_fmt: U.codigoFormatado(atual.codigo),
            idade: U.idade(atual.nascimento), menor: U.ehMenor(atual.nascimento),
            matriculas: matriculasDo(id),
            comprovante_pdf: !!comp && comp.mime === "application/pdf",
            mensalidade_txt: atual.mensalidade ? U.reais(atual.mensalidade).replace("R$ ", "") : "" } }), true;
        }
        if (req.method === "PUT") {
          const b = await corpo();
          const a = normalizarAluno(b);
          if ("nome" in a && !a.nome) throw new Recusa(400, "Informe o nome completo.");
          const mats = matriculasDoCorpo(b, id);
          if (mats) delete a.mensalidade;
          else if ("mensalidade" in a) {
            /* Mensalidade solta (formato de antes da 1.22): vale se o aluno
               tem UMA atividade — é a dela. Com mais de uma, não há como
               saber de qual; a tela manda por atividade. */
            const atuais = todos("SELECT id FROM g_matriculas WHERE aluno_id=?", id);
            if (atuais.length > 1) throw new Recusa(400, "Este aluno tem mais de uma atividade: informe a mensalidade de cada uma.");
            if (atuais.length === 1) roda("UPDATE g_matriculas SET mensalidade=? WHERE id=?", a.mensalidade, atuais[0].id);
          }
          /* Status: ativo ↔ inativo à vontade. Pré-matrícula só sai pela
             efetivação, que é quem dá o código. */
          if (b.status !== undefined && atual.status !== "pendente") {
            if (!["ativo", "inativo"].includes(b.status)) throw new Recusa(400, "Status inválido.");
            a.status = b.status;
          }
          if (b.codigo !== undefined && atual.status !== "pendente" && String(b.codigo) !== String(atual.codigo))
            a.codigo = await definirCodigo(b.codigo, id);
          a.atualizado_em = agora(); a.atualizado_por = quem;
          const campos = Object.keys(a);
          roda(`UPDATE g_alunos SET ${campos.map((c) => c + "=?").join(",")} WHERE id=?`, ...campos.map((c) => a[c]), id);
          if (mats) gravarMatriculas(id, mats);
          /* Quantas atividades o aluno TEM depois de salvar: a tela confere
             com quantas mandou. É o que pega um servidor desatualizado que
             descarta a lista em silêncio (aconteceu na 1.22.0). */
          return json(res, 200, { ok: true, avisos: avisosDeVagas(id), matriculas: contaMatriculas(id) }), true;
        }
        if (req.method === "DELETE") {
          /* Só se apaga pré-matrícula sem contrato — é para limpar envio
             repetido ou spam do site. Aluno de verdade se INATIVA: o histórico
             dele (e o dos contratos) é da academia. */
          if (atual.status !== "pendente")
            throw new Recusa(409, "Aluno matriculado não é apagado. Marque como inativo.");
          if (um("SELECT COUNT(*) AS n FROM g_contratos WHERE aluno_id=?", id).n)
            throw new Recusa(409, "Este cadastro tem contrato gerado e não pode ser apagado.");
          if (atual.foto_id) roda("DELETE FROM g_arquivos WHERE id=? AND tipo='foto'", atual.foto_id);
          /* (1.27.0) O comprovante sai junto. A política de privacidade promete
             que a pré-matrícula que não se confirma é apagada — deixar para
             trás a foto ou o comprovante transformaria a promessa em mentira. */
          if (atual.comprovante_id) roda("DELETE FROM g_arquivos WHERE id=? AND tipo='comprovante'", atual.comprovante_id);
          roda("DELETE FROM g_matriculas WHERE aluno_id=?", id);
          roda("DELETE FROM g_alunos WHERE id=?", id);
          return json(res, 200, { ok: true }), true;
        }
      }

      if ((r = m(/^\/alunos\/(\d+)\/efetivar$/)) && req.method === "POST") {
        const id = Number(r[1]);
        const b = await corpo();
        const atual = um("SELECT * FROM g_alunos WHERE id=?", id);
        if (!atual) throw new Recusa(404, "Aluno não encontrado.");
        if (atual.status !== "pendente") throw new Recusa(409, "Esta matrícula já foi efetivada.");
        const codigo = await definirCodigo(b.codigo);
        roda(`UPDATE g_alunos SET codigo=?, status='ativo', data_matricula=?, atualizado_em=?, atualizado_por=? WHERE id=?`,
          codigo, atual.data_matricula || U.hojeLocal(), agora(), quem, id);
        res.auditoria = { alvo: `${atual.nome} (${U.codigoFormatado(codigo)}) — era a pré-matrícula nº ${id}` };
        return json(res, 200, { ok: true, codigo, codigo_fmt: U.codigoFormatado(codigo), avisos: avisosDeVagas(id) }), true;
      }

      if ((r = m(/^\/alunos\/(\d+)\/foto$/))) {
        const id = Number(r[1]);
        const atual = um("SELECT id, foto_id FROM g_alunos WHERE id=?", id);
        if (!atual) throw new Recusa(404, "Aluno não encontrado.");
        if (req.method === "POST") {
          const { mime, dados } = lerImagem((await corpo()).dataUrl, 1.5 * 1024 * 1024);
          const info = roda("INSERT INTO g_arquivos(tipo,mime,dados,criado_em,criado_por) VALUES('foto',?,?,?,?)",
            mime, dados, agora(), quem);
          roda("UPDATE g_alunos SET foto_id=?, atualizado_em=?, atualizado_por=? WHERE id=?",
            Number(info.lastInsertRowid), agora(), quem, id);
          /* A foto antiga sai: ela não aparece em documento nenhum guardado
             (contrato não leva foto), e foto de criança não se acumula. */
          if (atual.foto_id) roda("DELETE FROM g_arquivos WHERE id=? AND tipo='foto'", atual.foto_id);
          return json(res, 200, { ok: true, foto_id: Number(info.lastInsertRowid) }), true;
        }
        if (req.method === "DELETE") {
          roda("UPDATE g_alunos SET foto_id=NULL WHERE id=?", id);
          if (atual.foto_id) roda("DELETE FROM g_arquivos WHERE id=? AND tipo='foto'", atual.foto_id);
          return json(res, 200, { ok: true }), true;
        }
      }

      /* ------------------------------------------------- comprovante (1.27.0)
         O comprovante chega com a matrícula do site, mas a secretaria também
         precisa poder TROCAR (a pessoa mandou o print errado) e REMOVER (o
         pagamento foi conferido e não há razão para guardar o extrato de
         ninguém). Aceita PDF além de imagem, como o formulário. */
      if ((r = m(/^\/alunos\/(\d+)\/comprovante$/))) {
        const id = Number(r[1]);
        const atual = um("SELECT id, comprovante_id FROM g_alunos WHERE id=?", id);
        if (!atual) throw new Recusa(404, "Aluno não encontrado.");
        if (req.method === "POST") {
          const { mime, dados } = lerAnexo((await corpo()).dataUrl, 4 * 1024 * 1024);
          const info = roda("INSERT INTO g_arquivos(tipo,mime,dados,criado_em,criado_por) VALUES('comprovante',?,?,?,?)",
            mime, dados, agora(), quem);
          roda("UPDATE g_alunos SET comprovante_id=?, atualizado_em=?, atualizado_por=? WHERE id=?",
            Number(info.lastInsertRowid), agora(), quem, id);
          if (atual.comprovante_id) roda("DELETE FROM g_arquivos WHERE id=? AND tipo='comprovante'", atual.comprovante_id);
          return json(res, 200, { ok: true, comprovante_id: Number(info.lastInsertRowid), pdf: mime === "application/pdf" }), true;
        }
        if (req.method === "DELETE") {
          roda("UPDATE g_alunos SET comprovante_id=NULL WHERE id=?", id);
          if (atual.comprovante_id) roda("DELETE FROM g_arquivos WHERE id=? AND tipo='comprovante'", atual.comprovante_id);
          return json(res, 200, { ok: true }), true;
        }
      }

      /* --------------------------------------------------------- contratos */
      if ((r = m(/^\/alunos\/(\d+)\/contratos$/))) {
        const id = Number(r[1]);
        const aluno = um("SELECT * FROM g_alunos WHERE id=?", id);
        if (!aluno) throw new Recusa(404, "Aluno não encontrado.");
        if (req.method === "GET") {
          const lista = todos(`SELECT id, gerado_em, gerado_por, assinado, assinado_em, assinado_por, modelo_id
            FROM g_contratos WHERE aluno_id=? ORDER BY id DESC`, id)
            .map((c) => ({ ...c, gerado_txt: U.dataHoraBR(c.gerado_em), assinado_txt: U.dataHoraBR(c.assinado_em) }));
          const dados = D.dadosDoContrato({ aluno, matriculas: matriculasDo(id), diasAula: diasAula(), hoje: U.hojeLocal() });
          return json(res, 200, { contratos: lista, vazios: dados.vazios, menor: dados.menor,
            pode_gerar: aluno.status !== "pendente" }), true;
        }
        if (req.method === "POST") {
          if (aluno.status === "pendente")
            throw new Recusa(409, "Efetive a matrícula antes de gerar o contrato — ele leva o código do aluno.");
          const modelo = um("SELECT * FROM g_contrato_modelos ORDER BY id DESC LIMIT 1");
          const hoje = U.hojeLocal();
          const dados = D.dadosDoContrato({ aluno, matriculas: matriculasDo(id),
            diasAula: diasAula(), hoje, assinaturaId: Number(getS("g_assinatura_id")) || 0 });
          const html = D.contratoCorpo({ modelo: modelo.texto, dados, rodape: rodapeContrato() });
          const info = roda(`INSERT INTO g_contratos(aluno_id,modelo_id,html,gerado_em,gerado_por) VALUES(?,?,?,?,?)`,
            id, modelo.id, html, agora(), quem);
          return json(res, 200, { ok: true, id: Number(info.lastInsertRowid), vazios: dados.vazios }), true;
        }
      }

      /* ============================================================ boletos
         (1.26.0) O carnê do aluno no Sicredi. As regras moram em
         gestao/cobranca.js; aqui só a porta.

         Erro do banco sai como 502, e não com o status que o banco devolveu:
         um 401 do Sicredi (credencial errada) chegando à tela como 401 faria o
         painel achar que a SESSÃO da secretaria caiu e mandá-la para o login. */
      const doBanco = async (fn) => {
        try { return await fn(); }
        catch (e) {
          if (e instanceof Recusa) throw e;
          if (e.name === "Error" && e.status && !("incerto" in e)) throw new Recusa(e.status, e.message);
          if ("incerto" in e) throw new Recusa(502, e.message);
          throw e;
        }
      };

      if ((r = m(/^\/alunos\/(\d+)\/boletos(\/atualizar)?$/))) {
        const aluno = um("SELECT * FROM g_alunos WHERE id=?", Number(r[1]));
        if (!aluno) throw new Recusa(404, "Aluno não encontrado.");
        if (req.method === "GET" && !r[2]) {
          const pag = cobranca.pagadorDe(aluno);
          return json(res, 200, {
            configurado: cfgSicredi.configurado, ambiente: cfgSicredi.ambiente, faltam: cfgSicredi.faltam,
            dia: cobranca.diaDe(aluno), dia_do_cadastro: aluno.dia_vencimento || 0,
            pagador: { nome: pag.nome, cpf: U.formatarCpf(pag.documento), menor: pag.menor,
              bloqueios: pag.bloqueios, avisos: pag.avisos },
            previa: aluno.status === "pendente" ? [] : cobranca.previa(aluno),
            boletos: cobranca.listar(aluno.id),
          }), true;
        }
        if (req.method === "POST" && !r[2]) {
          if (!sicredi) throw semSicredi();
          if (aluno.status === "pendente") throw new Recusa(409, "Efetive a matrícula antes de gerar boletos.");
          const b = await corpo();
          const comps = Array.isArray(b.competencias) ? b.competencias.map(String).filter((c) => /^\d{4}-\d{2}$/.test(c)) : null;
          const feitos = await doBanco(() => cobranca.gerar(aluno, comps, quem));
          return json(res, 200, { ok: true, resultado: feitos, boletos: cobranca.listar(aluno.id) }), true;
        }
        if (req.method === "POST" && r[2]) {
          if (!sicredi) throw semSicredi();
          const lista = await doBanco(() => cobranca.atualizar(aluno.id));
          return json(res, 200, { ok: true, boletos: lista }), true;
        }
      }

      if ((r = m(/^\/boletos\/(\d+)\/baixa$/)) && req.method === "POST") {
        if (!sicredi) throw semSicredi();
        const feito = await doBanco(() => cobranca.baixar(Number(r[1]), quem));
        return json(res, 200, { ok: true, boleto: feito }), true;
      }

      if ((r = m(/^\/contratos\/(\d+)\/assinatura$/)) && req.method === "PUT") {
        const id = Number(r[1]);
        const c = um("SELECT id FROM g_contratos WHERE id=?", id);
        if (!c) throw new Recusa(404, "Contrato não encontrado.");
        const { assinado } = await corpo();
        roda("UPDATE g_contratos SET assinado=?, assinado_em=?, assinado_por=? WHERE id=?",
          assinado ? 1 : 0, assinado ? agora() : "", assinado ? quem : "", id);
        return json(res, 200, { ok: true }), true;
      }

      /* ------------------------------------------------ modelo do contrato */
      if (rota === "/contrato/modelo" && req.method === "GET") {
        const versoes = todos("SELECT id, criado_em, criado_por FROM g_contrato_modelos ORDER BY id DESC LIMIT 30")
          .map((v) => ({ ...v, criado_txt: U.dataHoraBR(v.criado_em) }));
        const atual = um("SELECT * FROM g_contrato_modelos ORDER BY id DESC LIMIT 1");
        return json(res, 200, { texto: atual.texto, versao_id: atual.id, versoes,
          marcadores: D.MARCADORES, blocos: D.BLOCOS,
          assinatura_id: Number(getS("g_assinatura_id")) || 0,
          contratos_gerados: um("SELECT COUNT(*) AS n FROM g_contratos").n }), true;
      }
      if (rota === "/contrato/modelo" && req.method === "POST") {
        const texto = htmlLimpo(String((await corpo()).texto || "")).trim();
        if (texto.replace(/<[^>]+>/g, "").trim().length < 50) throw new Recusa(400, "O contrato ficou vazio.");
        const desconhecidos = D.marcadoresDesconhecidos(texto);
        if (desconhecidos.length)
          throw new Recusa(400, `Marcador desconhecido: ${desconhecidos.join(", ")}. Corrija antes de salvar — ele sairia impresso assim no contrato.`, { desconhecidos });
        const atual = um("SELECT texto FROM g_contrato_modelos ORDER BY id DESC LIMIT 1");
        if (atual && atual.texto === texto) return json(res, 200, { ok: true, igual: true }), true;
        const info = roda("INSERT INTO g_contrato_modelos(texto,criado_em,criado_por) VALUES(?,?,?)", texto, agora(), quem);
        return json(res, 200, { ok: true, versao_id: Number(info.lastInsertRowid) }), true;
      }
      if ((r = m(/^\/contrato\/modelo\/(\d+)$/)) && req.method === "GET") {
        const v = um("SELECT * FROM g_contrato_modelos WHERE id=?", Number(r[1]));
        if (!v) throw new Recusa(404, "Versão não encontrada.");
        return json(res, 200, { texto: v.texto, criado_txt: U.dataHoraBR(v.criado_em), criado_por: v.criado_por }), true;
      }
      if (rota === "/contrato/previa" && req.method === "POST") {
        const b = await corpo();
        const texto = htmlLimpo(String(b.texto || ""));
        let aluno = b.aluno_id ? um("SELECT * FROM g_alunos WHERE id=?", Number(b.aluno_id)) : null;
        let matriculas = aluno ? matriculasDo(aluno.id) : [];
        if (!aluno) aluno = ALUNO_EXEMPLO;
        if (!matriculas.length) matriculas = [{ horario: "10:00",
          atividade_nome: (um("SELECT nome FROM g_atividades WHERE ativo=1 ORDER BY id LIMIT 1") || {}).nome || "Natação" }];
        const dados = D.dadosDoContrato({ aluno, matriculas,
          diasAula: diasAula(), hoje: U.hojeLocal(), assinaturaId: Number(getS("g_assinatura_id")) || 0 });
        return json(res, 200, { html: D.contratoCorpo({ modelo: texto, dados, rodape: rodapeContrato() }),
          desconhecidos: D.marcadoresDesconhecidos(texto), vazios: dados.vazios }), true;
      }
      if (rota === "/contrato/assinatura") {
        if (req.method === "POST") {
          const { mime, dados } = lerImagem((await corpo()).dataUrl, 3 * 1024 * 1024);
          /* Nunca se sobrescreve nem se apaga uma imagem de assinatura: os
             contratos já gerados apontam para a que existia no dia. Trocar
             cria uma nova, e o passado continua mostrando a antiga. */
          const info = roda("INSERT INTO g_arquivos(tipo,mime,dados,criado_em,criado_por) VALUES('assinatura',?,?,?,?)",
            mime, dados, agora(), quem);
          setS("g_assinatura_id", String(Number(info.lastInsertRowid)));
          return json(res, 200, { ok: true, assinatura_id: Number(info.lastInsertRowid) }), true;
        }
        if (req.method === "DELETE") { setS("g_assinatura_id", ""); return json(res, 200, { ok: true }), true; }
      }

      /* -------------------------------------------------------- atividades */
      if (rota === "/atividades" && req.method === "GET") return json(res, 200, { atividades: todos(`
        SELECT a.*, (SELECT COUNT(*) FROM g_turmas t WHERE t.atividade_id=a.id) AS turmas
        FROM g_atividades a ORDER BY a.ativo DESC, a.nome COLLATE NOCASE`).map((a) => ({
          ...a, mensalidade_txt: a.mensalidade ? U.reais(a.mensalidade) : "" })) }), true;
      if (rota === "/atividades" && req.method === "POST") {
        const a = normalizarAtividade(await corpo());
        const info = roda("INSERT INTO g_atividades(nome,descricao,mensalidade,ativo,criado_em) VALUES(?,?,?,?,?)",
          a.nome, a.descricao, a.mensalidade, a.ativo, agora());
        res.auditoria = { alvo: a.nome };
        return json(res, 200, { ok: true, id: Number(info.lastInsertRowid) }), true;
      }
      if ((r = m(/^\/atividades\/(\d+)$/))) {
        const id = Number(r[1]);
        if (!um("SELECT id FROM g_atividades WHERE id=?", id)) throw new Recusa(404, "Atividade não encontrada.");
        if (req.method === "PUT") {
          const a = normalizarAtividade(await corpo());
          roda("UPDATE g_atividades SET nome=?, descricao=?, mensalidade=?, ativo=? WHERE id=?",
            a.nome, a.descricao, a.mensalidade, a.ativo, id);
          return json(res, 200, { ok: true }), true;
        }
        if (req.method === "DELETE") {
          if (um("SELECT COUNT(*) AS n FROM g_turmas WHERE atividade_id=?", id).n)
            throw new Recusa(409, "Esta atividade tem turmas. Marque como inativa em vez de apagar.");
          roda("DELETE FROM g_atividades WHERE id=?", id);
          return json(res, 200, { ok: true }), true;
        }
      }

      /* ------------------------------------------------------- professores */
      if (rota === "/professores" && req.method === "GET") return json(res, 200, { professores: todos(`
        SELECT p.*, (SELECT COUNT(*) FROM g_turmas t WHERE t.professor_id=p.id AND t.ativo=1) AS turmas,
          (SELECT COUNT(*) FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id JOIN g_turmas t ON t.id=m.turma_id
            WHERE al.status='ativo' AND COALESCE(m.professor_id, t.professor_id)=p.id) AS alunos
        FROM g_professores p ORDER BY p.ativo DESC, p.nome COLLATE NOCASE`) }), true;
      if (rota === "/professores" && req.method === "POST") {
        const pr = normalizarProfessor(await corpo());
        const info = roda("INSERT INTO g_professores(nome,cref,telefone,email,observacao,ativo,criado_em) VALUES(?,?,?,?,?,?,?)",
          pr.nome, pr.cref, pr.telefone, pr.email, pr.observacao, pr.ativo, agora());
        res.auditoria = { alvo: pr.nome };
        return json(res, 200, { ok: true, id: Number(info.lastInsertRowid) }), true;
      }
      if ((r = m(/^\/professores\/(\d+)$/))) {
        const id = Number(r[1]);
        if (!um("SELECT id FROM g_professores WHERE id=?", id)) throw new Recusa(404, "Professor não encontrado.");
        if (req.method === "PUT") {
          const pr = normalizarProfessor(await corpo(), id);
          roda("UPDATE g_professores SET nome=?, cref=?, telefone=?, email=?, observacao=?, ativo=? WHERE id=?",
            pr.nome, pr.cref, pr.telefone, pr.email, pr.observacao, pr.ativo, id);
          return json(res, 200, { ok: true }), true;
        }
        if (req.method === "DELETE") {
          /* Professor com turma ou aluno não se apaga: os documentos e as
             listas antigas perderiam o nome. Inativa. */
          if (um("SELECT COUNT(*) AS n FROM g_turmas WHERE professor_id=?", id).n ||
              um("SELECT COUNT(*) AS n FROM g_matriculas WHERE professor_id=?", id).n)
            throw new Recusa(409, "Este professor está numa turma ou numa matrícula. Marque como inativo em vez de apagar.");
          roda("DELETE FROM g_professores WHERE id=?", id);
          return json(res, 200, { ok: true }), true;
        }
      }

      /* ------------------------------------------------------------ turmas */
      if (rota === "/turmas" && req.method === "GET") return json(res, 200, { turmas: todos(`
        SELECT t.*, a.nome AS atividade_nome, a.ativo AS atividade_ativa, ${PROF_TURMA},
          (SELECT COUNT(*) FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id WHERE m.turma_id=t.id AND al.status='ativo') AS alunos_ativos,
          (SELECT COUNT(*) FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id WHERE m.turma_id=t.id AND al.status='pendente') AS pendentes
        FROM g_turmas t JOIN g_atividades a ON a.id=t.atividade_id
        ORDER BY t.ativo DESC, a.nome COLLATE NOCASE, t.horario`).map((t) => ({ ...t, rotulo: rotuloTurma(t),
          excedente: t.vagas ? Math.max(0, t.alunos_ativos - t.vagas) : 0 })) }), true;
      if (rota === "/turmas" && req.method === "POST") {
        const t = normalizarTurma(await corpo());
        const info = roda(`INSERT INTO g_turmas(atividade_id,horario,horario_fim,vagas,professor_id,observacao,publica,ativo,criado_em)
          VALUES(?,?,?,?,?,?,?,?,?)`, t.atividade_id, t.horario, t.horario_fim, t.vagas, t.professor_id, t.observacao, t.publica, t.ativo, agora());
        res.auditoria = { alvo: rotuloTurma(turmaCompleta(Number(info.lastInsertRowid))) };
        return json(res, 200, { ok: true, id: Number(info.lastInsertRowid) }), true;
      }
      if ((r = m(/^\/turmas\/(\d+)$/))) {
        const id = Number(r[1]);
        if (!um("SELECT id FROM g_turmas WHERE id=?", id)) throw new Recusa(404, "Turma não encontrada.");
        if (req.method === "PUT") {
          const t = normalizarTurma(await corpo(), id);
          roda(`UPDATE g_turmas SET atividade_id=?, horario=?, horario_fim=?, vagas=?, professor_id=?, observacao=?, publica=?, ativo=? WHERE id=?`,
            t.atividade_id, t.horario, t.horario_fim, t.vagas, t.professor_id, t.observacao, t.publica, t.ativo, id);
          return json(res, 200, { ok: true }), true;
        }
        if (req.method === "DELETE") {
          if (um("SELECT COUNT(*) AS n FROM g_matriculas WHERE turma_id=?", id).n)
            throw new Recusa(409, "Há alunos nesta turma. Marque como inativa em vez de apagar.");
          roda("DELETE FROM g_turmas WHERE id=?", id);
          return json(res, 200, { ok: true }), true;
        }
      }

      /* -------------------------------------------------------- indicadores
         Os números da tela de gráficos: alunos por turma (com o limite de
         vagas) e por atividade. Só turmas ativas — encerrada não recebe
         aluno, e só confundiria a leitura. */
      if (rota === "/indicadores" && req.method === "GET") {
        const turmas = todos(`SELECT t.id, t.horario, t.horario_fim, t.vagas, ${PROF_TURMA}, a.nome AS atividade_nome,
            (SELECT COUNT(*) FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id WHERE m.turma_id=t.id AND al.status='ativo') AS ativos,
            (SELECT COUNT(*) FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id WHERE m.turma_id=t.id AND al.status='pendente') AS pendentes
          FROM g_turmas t JOIN g_atividades a ON a.id=t.atividade_id
          WHERE t.ativo=1 AND a.ativo=1 ORDER BY a.nome COLLATE NOCASE, t.horario`)
          .map((t) => ({ ...t, rotulo: rotuloTurma(t), excedente: t.vagas ? Math.max(0, t.ativos - t.vagas) : 0 }));
        /* Por atividade conta ALUNOS, não matrículas: quem faz duas turmas de
           natação é um aluno de natação. */
        const atividades = todos(`SELECT a.id, a.nome,
            (SELECT COUNT(DISTINCT m.aluno_id) FROM g_matriculas m JOIN g_turmas t ON t.id=m.turma_id
              JOIN g_alunos al ON al.id=m.aluno_id WHERE t.atividade_id=a.id AND al.status='ativo') AS ativos
          FROM g_atividades a WHERE a.ativo=1 ORDER BY a.nome COLLATE NOCASE`);
        const conta = (st) => um("SELECT COUNT(*) AS n FROM g_alunos WHERE status=?", st).n;
        return json(res, 200, { turmas, atividades,
          ativos: conta("ativo"), pendentes: conta("pendente"), inativos: conta("inativo"),
          sem_atividade: um(`SELECT COUNT(*) AS n FROM g_alunos al WHERE al.status='ativo'
            AND NOT EXISTS (SELECT 1 FROM g_matriculas m WHERE m.aluno_id=al.id)`).n,
          acima_do_limite: turmas.filter((t) => t.excedente > 0).length }), true;
      }

      /* ------------------------------------------------------ configurações */
      if (rota === "/config" && req.method === "GET")
        return json(res, 200, { dias_aula: diasAula(), condicoes: getS("g_condicoes") || "",
          email_admin: getS("g_email_admin") || "", email_contato: getS("contact_email") || "",
          rodape: rodapeContrato() }), true;
      if (rota === "/config" && req.method === "PUT") {
        const b = await corpo();
        if (b.dias_aula !== undefined) {
          const dias = [...new Set((Array.isArray(b.dias_aula) ? b.dias_aula : []).map(Number))]
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
          if (!dias.length) throw new Recusa(400, "Marque pelo menos um dia de aula.");
          setS("g_dias_aula", JSON.stringify(dias));
        }
        if (b.condicoes !== undefined) setS("g_condicoes", htmlLimpo(String(b.condicoes || "")));
        if (b.email_admin !== undefined) {
          const email = limpar(b.email_admin, 120);
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Recusa(400, "E-mail administrativo inválido.");
          setS("g_email_admin", email);
        }
        return json(res, 200, { ok: true }), true;
      }

      /* ----------------------------------------------------------- feriados */
      if (rota === "/feriados" && req.method === "GET") {
        const ano = Number(q.get("ano")) || Number(U.hojeLocal().slice(0, 4));
        /* Datas de uma vez só primeiro, da mais nova para a mais velha — são
           as que a secretaria acabou de cadastrar e quer ver; depois as que
           se repetem, na ordem do ano. */
        const regras = todos(`SELECT * FROM g_feriados
          ORDER BY (tipo='data') DESC, CASE WHEN tipo='data' THEN data END DESC, COALESCE(mes, 99), COALESCE(dia, 99), nome`);
        const datas = U.datasDoAno(regras, ano);
        /* Pelo ID, e não pelo nome: duas datas com o mesmo nome ("Exame de
           pele" em março e em setembro) confundiam a coluna "Em 2026". */
        const quando = new Map();
        for (const [data, lista] of datas) for (const x of lista) if (!quando.has(x.id)) quando.set(x.id, data);
        return json(res, 200, { ano, feriados: regras.map((f) => ({ ...f, data_no_ano: U.dataBR(quando.get(f.id) || "") })) }), true;
      }
      if (rota === "/feriados" && req.method === "POST") {
        const f = normalizarFeriado(await corpo());
        const info = roda("INSERT INTO g_feriados(nome,categoria,esfera,tipo,dia,mes,data,pascoa,criado_em) VALUES(?,?,?,?,?,?,?,?,?)",
          f.nome, f.categoria, f.esfera, f.tipo, f.dia, f.mes, f.data, f.pascoa, agora());
        res.auditoria = { alvo: f.nome };
        return json(res, 200, { ok: true, id: Number(info.lastInsertRowid) }), true;
      }
      if ((r = m(/^\/feriados\/(\d+)$/))) {
        const id = Number(r[1]);
        if (!um("SELECT id FROM g_feriados WHERE id=?", id)) throw new Recusa(404, "Data não encontrada.");
        if (req.method === "PUT") {
          const f = normalizarFeriado(await corpo());
          roda("UPDATE g_feriados SET nome=?, categoria=?, esfera=?, tipo=?, dia=?, mes=?, data=?, pascoa=? WHERE id=?",
            f.nome, f.categoria, f.esfera, f.tipo, f.dia, f.mes, f.data, f.pascoa, id);
          return json(res, 200, { ok: true }), true;
        }
        if (req.method === "DELETE") { roda("DELETE FROM g_feriados WHERE id=?", id); return json(res, 200, { ok: true }), true; }
      }

      /* ------------------------------------------------------------- agenda */
      if (rota === "/agenda" && req.method === "GET") {
        const hoje = U.hojeLocal();
        const ano = Number(q.get("ano")) || Number(hoje.slice(0, 4));
        const mes = Number(q.get("mes")) || Number(hoje.slice(5, 7));
        if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12) throw new Recusa(400, "Mês inválido.");
        const regras = todos("SELECT * FROM g_feriados");
        return json(res, 200, { ano, mes, hoje, dias_aula: diasAula(), dias_txt: U.diasPorExtenso(diasAula()),
          contato: contatoPublico(), dias: U.mesDaAgenda(regras, diasAula(), ano, mes) }), true;
      }

      /* ---------------------------------------------------------- auditoria
         Só administrador: é o histórico do que CADA pessoa fez, inclusive o
         endereço de onde entrou. */
      if (rota === "/auditoria" && req.method === "GET") {
        if (!usuario.admin) throw new Recusa(403, "Só um administrador vê a auditoria.");
        const pagina = auditoria.listar({ usuario_id: q.get("usuario"), de: q.get("de"), ate: q.get("ate"),
          q: limpar(q.get("q"), 80), antes: q.get("antes"), limite: q.get("limite"),
          pagina: q.get("pagina"), por: q.get("por") });
        return json(res, 200, { ...pagina,
          usuarios: todos("SELECT id, nome, login FROM usuarios ORDER BY nome COLLATE NOCASE") }), true;
      }

      /* -------------------------------------------------------------- sobre */
      if (rota === "/sobre" && req.method === "GET") {
        return json(res, 200, {
          sistema: "Forms Fitness — site e gestão da academia",
          versao: ctx.versao, node: process.version, banco: ctx.driver,
          no_ar_desde: U.dataHoraBR(ctx.iniciadoEm),
          versoes: lerVersoes(path.join(__dirname, "..", "CHANGELOG.md")),
        }), true;
      }

      /* ----------------------------------------------------------- usuários */
      if (rota === "/usuarios" || /^\/usuarios\//.test(rota)) {
        if (!usuario.admin) throw new Recusa(403, "Só um administrador gerencia usuários.");
        if (rota === "/usuarios" && req.method === "GET")
          return json(res, 200, { usuarios: todos("SELECT id,nome,login,admin,ativo,criado_em FROM usuarios ORDER BY ativo DESC, nome COLLATE NOCASE")
            .map((u) => ({ ...u, criado_txt: U.dataHoraBR(u.criado_em) })) }), true;
        if (rota === "/usuarios" && req.method === "POST") {
          const b = await corpo();
          const nome = limpar(b.nome, 80), login = limpar(b.login, 40).toLowerCase();
          if (nome.length < 2) throw new Recusa(400, "Informe o nome.");
          if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw new Recusa(400, "Usuário: de 3 a 40 letras minúsculas, números, ponto, traço.");
          if (String(b.senha || "").length < 8) throw new Recusa(400, "A senha precisa de ao menos 8 caracteres.");
          if (um("SELECT id FROM usuarios WHERE login=?", login)) throw new Recusa(409, "Já existe um usuário com esse login.");
          res.auditoria = { alvo: `${nome} (${login})` };
          const info = roda("INSERT INTO usuarios(nome,login,senha,admin,ativo,criado_em) VALUES(?,?,?,?,1,?)",
            nome, login, hashSenha(String(b.senha)), b.admin ? 1 : 0, agora());
          return json(res, 200, { ok: true, id: Number(info.lastInsertRowid) }), true;
        }
        if ((r = m(/^\/usuarios\/(\d+)$/)) && req.method === "PUT") {
          const id = Number(r[1]);
          const alvo = um("SELECT * FROM usuarios WHERE id=?", id);
          if (!alvo) throw new Recusa(404, "Usuário não encontrado.");
          const b = await corpo();
          const nome = b.nome !== undefined ? limpar(b.nome, 80) : alvo.nome;
          const admin = b.admin !== undefined ? (b.admin ? 1 : 0) : alvo.admin;
          const ativo = b.ativo !== undefined ? (b.ativo ? 1 : 0) : alvo.ativo;
          if (id === usuario.id && (!ativo || !admin))
            throw new Recusa(409, "Você não pode desativar nem tirar o acesso de administrador da sua própria conta.");
          /* O último administrador ativo não pode deixar de ser: sem ele,
             ninguém mais consegue criar usuário nem trocar senha esquecida. */
          if (alvo.admin && alvo.ativo && (!admin || !ativo) &&
              um("SELECT COUNT(*) AS n FROM usuarios WHERE admin=1 AND ativo=1").n <= 1)
            throw new Recusa(409, "Este é o último administrador ativo.");
          roda("UPDATE usuarios SET nome=?, admin=?, ativo=? WHERE id=?", nome, admin, ativo, id);
          if (!ativo) ctx.derrubarSessoes(id);
          return json(res, 200, { ok: true }), true;
        }
        if ((r = m(/^\/usuarios\/(\d+)\/senha$/)) && req.method === "POST") {
          const id = Number(r[1]);
          if (!um("SELECT id FROM usuarios WHERE id=?", id)) throw new Recusa(404, "Usuário não encontrado.");
          const { senha } = await corpo();
          if (String(senha || "").length < 8) throw new Recusa(400, "A senha precisa de ao menos 8 caracteres.");
          roda("UPDATE usuarios SET senha=? WHERE id=?", hashSenha(String(senha)), id);
          /* Senha trocada pelo administrador derruba as sessões daquele
             usuário: é o caso da senha que vazou. */
          if (id !== usuario.id) ctx.derrubarSessoes(id);
          return json(res, 200, { ok: true }), true;
        }
      }

      return json(res, 404, { error: "Rota não encontrada" }), true;
    } catch (e) {
      if (e.status) return json(res, e.status, { error: e.message, ...(e.extra || {}) }), true;
      /* O erro do gatilho de imutabilidade chega aqui como erro do SQLite:
         vira 409 com a frase dele, que já explica. */
      if (/não pode ser (alterado|apagado|alterada|apagada)/.test(e.message)) return json(res, 409, { error: e.message }), true;
      if (/UNIQUE constraint failed: g_alunos.codigo/.test(e.message))
        return json(res, 409, { error: "Esse código de matrícula já está em uso." }), true;
      console.error("  ✖ gestão:", rota, e.message);
      return json(res, 500, { error: "Erro interno." }), true;
    }

    /* ------------------------------------------------------------ auxiliares */
    async function definirCodigo(pedido, idAtual = 0) {
      if (pedido === undefined || pedido === null || String(pedido).trim() === "") return proximoCodigo();
      const n = Number(String(pedido).replace(/\D/g, ""));
      if (!Number.isInteger(n) || n <= 0 || n > 9999999) throw new Recusa(400, "Código de matrícula inválido.");
      const dono = um("SELECT id, nome FROM g_alunos WHERE codigo=?", n);
      if (dono && dono.id !== idAtual) throw new Recusa(409, `O código ${U.codigoFormatado(n)} já é de ${dono.nome}.`);
      return n;
    }
  }

  function normalizarAtividade(b) {
    const nome = limpar(b.nome, 60);
    if (nome.length < 2) throw new Recusa(400, "Informe o nome da atividade.");
    const mensalidade = U.paraCentavos(b.mensalidade);
    if (mensalidade === null || mensalidade < 0) throw new Recusa(400, "Mensalidade inválida (use, por exemplo, 110,00).");
    return { nome, descricao: limpar(b.descricao, 400), mensalidade, ativo: b.ativo === false || b.ativo === 0 ? 0 : 1 };
  }
  function normalizarTurma(b, idAtual = 0) {
    const atividade_id = Number(b.atividade_id);
    if (!um("SELECT id FROM g_atividades WHERE id=?", atividade_id)) throw new Recusa(400, "Escolha a atividade.");
    const horario = limpar(b.horario, 5);
    if (!horaValida(horario)) throw new Recusa(400, "Horário inválido (use HH:MM, ex.: 10:00).");
    const horario_fim = limpar(b.horario_fim, 5);
    if (horario_fim && !horaValida(horario_fim)) throw new Recusa(400, "Horário de término inválido.");
    if (horario_fim && horario_fim <= horario) throw new Recusa(400, "O término tem de ser depois do início.");
    const vagas = Math.max(0, Math.min(999, Number(b.vagas) || 0));
    /* O professor é do cadastro. Inativo só fica se já era o desta turma —
       inativar um professor não pode tirá-lo das turmas sem ninguém ver. */
    const professor_id = Number(b.professor_id) || null;
    if (professor_id) {
      const prof = um("SELECT ativo FROM g_professores WHERE id=?", professor_id);
      if (!prof) throw new Recusa(400, "Professor não encontrado.");
      if (!prof.ativo && !(idAtual && um("SELECT 1 AS s FROM g_turmas WHERE id=? AND professor_id=?", idAtual, professor_id)))
        throw new Recusa(400, "Este professor está inativo.");
    }
    return { atividade_id, horario, horario_fim, vagas, professor_id,
      observacao: limpar(b.observacao, 300), publica: b.publica === false || b.publica === 0 ? 0 : 1,
      ativo: b.ativo === false || b.ativo === 0 ? 0 : 1 };
  }
  function normalizarProfessor(b, idAtual = 0) {
    const nome = limpar(b.nome, 80).replace(/\s+/g, " ");
    if (nome.length < 2) throw new Recusa(400, "Informe o nome do professor.");
    /* Nome repetido é recusado: dois "Ronaldo" no select e ninguém sabe qual
       escolher. Um é o outro com o CREF, ou um apelido na observação. */
    const dono = um("SELECT id FROM g_professores WHERE nome=? COLLATE NOCASE", nome);
    if (dono && dono.id !== idAtual) throw new Recusa(409, "Já existe um professor com esse nome.");
    const email = limpar(b.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Recusa(400, "E-mail inválido.");
    return { nome, cref: limpar(b.cref, 30), telefone: limpar(b.telefone, 20), email, observacao: limpar(b.observacao, 300),
      ativo: b.ativo === false || b.ativo === 0 ? 0 : 1 };
  }
  function normalizarFeriado(b) {
    const nome = limpar(b.nome, 80);
    if (nome.length < 2) throw new Recusa(400, "Informe o nome da data.");
    /* Sem categoria (cliente antigo, script) é feriado — o que toda linha era
       antes da 1.21.0. Categoria desconhecida é recusada, e não trocada por
       feriado em silêncio: pintar de vermelho um dia que era para ser aula
       fecharia a academia na agenda sem ninguém ter pedido. */
    const categoria = b.categoria === undefined || b.categoria === "" ? "feriado" : b.categoria;
    if (!U.CATEGORIAS.includes(categoria)) throw new Recusa(400, "Tipo do dia inválido.");
    /* Esfera (nacional, estadual…) só faz sentido para feriado. */
    const esfera = categoria === "feriado" && ["nacional", "estadual", "municipal", "academia"].includes(b.esfera) ? b.esfera : "academia";
    const f = { nome, categoria, esfera, tipo: b.tipo, dia: null, mes: null, data: null, pascoa: null };
    if (b.tipo === "anual") {
      f.dia = Number(b.dia); f.mes = Number(b.mes);
      /* 2024 é bissexto: 29/02 passa, 30/02 e 31/04 não. */
      if (!dataValida(`2024-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`))
        throw new Recusa(400, "Dia e mês não formam uma data válida.");
    } else if (b.tipo === "data") {
      if (!dataValida(b.data)) throw new Recusa(400, "Data inválida.");
      f.data = b.data;
    } else if (b.tipo === "pascoa") {
      f.pascoa = Number(b.pascoa);
      if (!Number.isInteger(f.pascoa) || Math.abs(f.pascoa) > 120) throw new Recusa(400, "Informe quantos dias antes (−) ou depois (+) da Páscoa.");
    } else throw new Recusa(400, "Escolha como a data se repete.");
    return f;
  }

  /* ==========================================================================
     PORTA 3 — PÁGINAS IMPRESSAS E IMAGENS (com login)
     ========================================================================== */
  function enviarHtml(res, html) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": CSP_IMPRESSAO });
    res.end(html);
  }

  function imprimir(req, res, p, usuario) {
    if (!p.startsWith("/admin/imprimir/") && !p.startsWith("/admin/arquivo/")) return false;
    if (!usuario) {
      /* Link aberto numa aba sem sessão: manda para o login em vez de um
         401 cru — a pessoa entra e reabre. */
      res.writeHead(302, { Location: "/admin/", "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    const q = new URL(req.url, "http://x").searchParams;
    let r;

    if ((r = /^\/admin\/arquivo\/(\d+)$/.exec(p))) {
      const a = um("SELECT mime, dados FROM g_arquivos WHERE id=?", Number(r[1]));
      if (!a) { res.writeHead(404); res.end(); return true; }
      /* `private`: nenhum proxy ou CDN no meio do caminho guarda a foto de
         um aluno para servir a outra pessoa.

         (1.27.0) O comprovante pode ser PDF, e PDF não é imagem: ele desce como
         ANEXO, para ser aberto no leitor do sistema, e não dentro de uma aba do
         próprio painel. PDF é formato com script, e abri-lo na nossa origem
         seria dar a um arquivo que veio de fora um lugar dentro de casa.
         `nosniff` fecha o outro lado: o navegador não pode "descobrir" que
         aquele JPEG é outra coisa. */
      const ehImagem = String(a.mime || "").startsWith("image/");
      res.writeHead(200, { "Content-Type": a.mime, "Cache-Control": "private, max-age=300",
        "Content-Disposition": ehImagem ? "inline" : `attachment; filename="comprovante-${Number(r[1])}.pdf"`,
        "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" });
      res.end(Buffer.from(a.dados));
      return true;
    }

    if ((r = /^\/admin\/imprimir\/ficha\/(\d+)$/.exec(p))) {
      const aluno = um("SELECT * FROM g_alunos WHERE id=?", Number(r[1]));
      if (!aluno) { enviarHtml(res, D.pagina({ titulo: "Ficha", corpo: "<p>Aluno não encontrado.</p>" })); return true; }
      res.auditoria = { alvo: aluno.status === "pendente" ? `pré-matrícula nº ${aluno.id}` : `${aluno.nome} (${U.codigoFormatado(aluno.codigo)})` };
      enviarHtml(res, D.fichaHTML({ aluno, matriculas: matriculasDo(aluno.id),
        condicoes: getS("g_condicoes") || "", agora: agora(), temFoto: !!aluno.foto_id }));
      return true;
    }

    /* O carnê (1.26.0): as parcelas em aberto do aluno, três por folha.
       `?ids=` limita às escolhidas na tela. */
    if ((r = /^\/admin\/imprimir\/carne\/(\d+)$/.exec(p))) {
      const aluno = um("SELECT * FROM g_alunos WHERE id=?", Number(r[1]));
      if (!aluno) { enviarHtml(res, D.pagina({ titulo: "Carnê", corpo: "<p>Aluno não encontrado.</p>" })); return true; }
      const ids = (q.get("ids") || "").split(",").map(Number).filter((n) => n > 0);
      const boletos = cobranca.paraCarne(aluno.id, ids.length ? ids : null);
      res.auditoria = { alvo: `carnê de ${aluno.nome} (${U.codigoFormatado(aluno.codigo)}) — ${boletos.length} parcela(s)` };
      const end = [aluno.logradouro && `${aluno.logradouro}, ${aluno.numero}`, aluno.bairro,
        aluno.cidade && `${aluno.cidade}/${aluno.uf}`, aluno.cep && `CEP ${aluno.cep}`].filter(Boolean).join(" — ");
      enviarHtml(res, carneHTML({ aluno, boletos, cfg: cfgSicredi, beneficiario: beneficiario(), endereco: end }));
      return true;
    }

    /* A 2ª via OFICIAL, o PDF gerado pelo próprio Sicredi. */
    if ((r = /^\/admin\/imprimir\/boleto\/(\d+)\.pdf$/.exec(p))) {
      const b = um("SELECT b.*, al.nome FROM g_boletos b JOIN g_alunos al ON al.id=b.aluno_id WHERE b.id=?", Number(r[1]));
      if (!b || !b.linha_digitavel || !sicredi) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(!sicredi ? "Boletos não configurados no servidor." : "Boleto não encontrado ou ainda não registrado.");
        return true;
      }
      res.auditoria = { alvo: `2ª via do boleto de ${b.competencia} — ${b.nome}` };
      sicredi.pdf(b.linha_digitavel).then((pdf) => {
        res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="boleto-${b.competencia}.pdf"`, "X-Robots-Tag": "noindex, nofollow" });
        res.end(pdf);
      }).catch((e) => {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Não foi possível baixar o PDF do Sicredi: ${e.message}`);
      });
      return true;
    }

    if ((r = /^\/admin\/imprimir\/contrato\/(\d+)$/.exec(p))) {
      const c = um(`SELECT c.html, c.gerado_em, a.nome FROM g_contratos c JOIN g_alunos a ON a.id=c.aluno_id WHERE c.id=?`, Number(r[1]));
      if (!c) { enviarHtml(res, D.pagina({ titulo: "Contrato", corpo: "<p>Contrato não encontrado.</p>" })); return true; }
      res.auditoria = { alvo: `contrato nº ${Number(r[1])} — ${c.nome}` };
      enviarHtml(res, D.contratoPagina(c.html, `Contrato — ${c.nome} (${U.dataHoraBR(c.gerado_em)})`));
      return true;
    }

    if (p === "/admin/imprimir/agenda") {
      const hoje = U.hojeLocal();
      const ano = Number(q.get("ano")) || Number(hoje.slice(0, 4));
      const mes = Number(q.get("mes")) || Number(hoje.slice(5, 7));
      if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12) { res.writeHead(400); res.end("Mês inválido."); return true; }
      res.auditoria = { alvo: `${U.MESES[mes - 1]} de ${ano}` };
      enviarHtml(res, D.agendaHTML({ ano, mes, diasAula: diasAula(), contato: contatoPublico(), agora: agora(),
        dias: U.mesDaAgenda(todos("SELECT * FROM g_feriados"), diasAula(), ano, mes) }));
      return true;
    }

    if ((r = /^\/admin\/imprimir\/relatorio\/([a-z]+)$/.exec(p))) {
      const tipo = r[1];
      const status = q.get("status") === "inativo" ? "inativo" : "ativo";
      const ts = agora();

      if (tipo === "alunos") {
        const atividadesDe = atividadesPorAluno();
        const linhas = todos(`SELECT al.* FROM g_alunos al WHERE al.status=? ORDER BY al.nome COLLATE NOCASE`, status)
          .map((l) => ({ codigo: U.codigoFormatado(l.codigo), nome: l.nome, idade: U.idade(l.nascimento) ?? "",
            turma: atividadesDe(l.id), fone: l.fone1 || l.resp_fone,
            resp: U.ehMenor(l.nascimento) ? l.resp_nome : "", matricula: U.dataBR(l.data_matricula) }));
        enviarHtml(res, D.relatorioHTML({ titulo: `Alunos ${status === "ativo" ? "ativos" : "inativos"}`,
          info: `${linhas.length} aluno(s).`, agora: ts, paisagem: true, linhas,
          colunas: [["Código", "codigo"], ["Nome", "nome"], ["Idade", "idade", true], ["Atividades", "turma"],
            ["Telefone", "fone"], ["Responsável (menor)", "resp"], ["Matrícula", "matricula"]] }));
        return true;
      }
      if (tipo === "turmas") {
        const linhas = todos(`SELECT t.*, a.nome AS atividade_nome, ${PROF_TURMA},
            (SELECT COUNT(*) FROM g_matriculas m JOIN g_alunos al ON al.id=m.aluno_id WHERE m.turma_id=t.id AND al.status='ativo') AS alunos
          FROM g_turmas t JOIN g_atividades a ON a.id=t.atividade_id WHERE t.ativo=? ORDER BY a.nome, t.horario`,
          status === "ativo" ? 1 : 0)
          .map((t) => ({ atividade: t.atividade_nome, horario: `${t.horario}${t.horario_fim ? "–" + t.horario_fim : ""}`,
            professor: t.professor, vagas: t.vagas || "sem limite",
            alunos: t.vagas && t.alunos > t.vagas ? `${t.alunos} (excedente: +${t.alunos - t.vagas})` : t.alunos,
            site: t.publica ? "sim" : "não" }));
        enviarHtml(res, D.relatorioHTML({ titulo: `Turmas ${status === "ativo" ? "ativas" : "inativas"}`,
          info: `${linhas.length} turma(s). Dias de aula: ${U.diasPorExtenso(diasAula())}.`, agora: ts, linhas,
          colunas: [["Atividade", "atividade"], ["Horário", "horario"], ["Professor", "professor"],
            ["Vagas", "vagas", true], ["Alunos ativos", "alunos", true], ["No site", "site"]] }));
        return true;
      }
      if (tipo === "aniversariantes") {
        const hoje = U.hojeLocal();
        const mes = Math.min(12, Math.max(1, Number(q.get("mes")) || Number(hoje.slice(5, 7))));
        const ano = Number(hoje.slice(0, 4));
        const atividadesDe = atividadesPorAluno();
        const linhas = todos(`SELECT al.* FROM g_alunos al
          WHERE al.status='ativo' AND al.nascimento<>'' AND CAST(substr(al.nascimento,6,2) AS INTEGER)=?
          ORDER BY substr(al.nascimento,9,2), al.nome COLLATE NOCASE`, mes)
          .map((l) => ({ dia: l.nascimento.slice(8, 10), codigo: U.codigoFormatado(l.codigo), nome: l.nome,
            completa: ano - Number(l.nascimento.slice(0, 4)), turma: atividadesDe(l.id),
            fone: l.fone1 || l.resp_fone }));
        enviarHtml(res, D.relatorioHTML({ titulo: `Aniversariantes de ${U.MESES[mes - 1]}`,
          info: `${linhas.length} aluno(s) ativo(s) fazem aniversário em ${U.MESES[mes - 1]}.`, agora: ts, linhas,
          colunas: [["Dia", "dia"], ["Código", "codigo"], ["Nome", "nome"], ["Completa", "completa", true],
            ["Atividades", "turma"], ["Telefone", "fone"]] }));
        return true;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404");
    return true;
  }

  return { publico, api, imprimir, proximoCodigo, auditoria };
}

/* O aluno fictício da pré-visualização do contrato. Menor de idade de
   propósito: é o caso que exercita o bloco {{#SE_MENOR}} e os dados do
   responsável — o que mais tem chance de sair errado. */
const ALUNO_EXEMPLO = {
  codigo: 4149, nome: "ALUNO DE EXEMPLO", nascimento: "2016-03-10", nacionalidade: "Brasileira",
  resp_nome: "RESPONSÁVEL DE EXEMPLO", resp_nacionalidade: "Brasileira", resp_rg: "0000000",
  resp_rg_emissor: "SDS/PE", resp_cpf: "000.000.000-00", logradouro: "Rua de Exemplo", numero: "100",
  bairro: "Centro", cep: "55000-000", cidade: "Caruaru", uf: "PE", mensalidade: 11000,
  data_matricula: "2026-01-01",
};

module.exports = { criar, ESTADOS_CIVIS, SEXOS, UFS };
