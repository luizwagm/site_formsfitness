/* ==========================================================================
   testar-gestao.js — provas da gestão da academia

       node testar-gestao.js

   SOBE O PRÓPRIO SERVIDOR, numa porta própria (5311) e num banco TEMPORÁRIO
   que é apagado no fim. Diferente da suíte antiga (testar.js, que conversa
   com o servidor da 5186 e o banco de desenvolvimento), esta nunca encosta em
   dado de ninguém — pode rodar em qualquer máquina, a qualquer hora.

   Cada bloco prova uma regra que a TELA não consegue garantir sozinha: código
   que não pula, contrato que não muda depois de gerado, foto que não vaza,
   secretaria que não vira administradora por um fetch.
   ========================================================================== */
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORTA = Number(process.env.PORTA_PROVA) || 5311;
const BASE = `http://127.0.0.1:${PORTA}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-gestao-"));

let ok = 0; const falhas = [];
const certo = (nome, cond, detalhe = "") => {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? "\n         " + detalhe : ""}`); }
};

async function pedir(metodo, caminho, { corpo, cookie, bruto = false } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo, redirect: "manual",
    headers: { ...(corpo ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let j = null; try { j = JSON.parse(texto); } catch {}
  return { status: r.status, j: j || {}, texto, cab: r.headers };
}
async function entrar(usuario, senha) {
  const r = await pedir("POST", "/api/login", { corpo: usuario ? { usuario, password: senha } : { password: senha } });
  const c = (r.cab.get("set-cookie") || "").split(";")[0];
  return { status: r.status, cookie: c, erro: r.j.error };
}

/* Um cadastro público válido de criança. CPF gerado pelo algoritmo, sem dono. */
const PUB_MENOR = (extra = {}) => ({
  nome: "Zz Qa Criança Teste", nascimento: "2019-05-03", sexo: "Masculino", mae: "Zz Qa Mãe",
  fone1: "(81) 99999-0000", logradouro: "Avenida Caruaru", numero: "579", bairro: "Maria Auxiliadora",
  cidade: "Caruaru", uf: "PE", cep: "55038-270",
  resp_nome: "Zz Qa Responsável", resp_cpf: "529.982.247-25", resp_rg: "9172964", resp_fone: "(81) 99999-0001",
  aceite_termos: true, aceite_dados: true, ...extra,
});

(async () => {
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));

  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + "/")).status) break; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }

    console.log("\n— contas");
    const sem = await entrar(null, "forms-admin");
    certo("login SEM usuário continua funcionando (vira admin)", sem.status === 200 && sem.cookie);
    const adm = await entrar("admin", "forms-admin");
    certo("login com usuário admin", adm.status === 200);
    const A = adm.cookie;
    const errado = await entrar("ninguem", "forms-admin");
    const senhaErrada = await entrar("admin", "errada-123");
    certo("usuário inexistente e senha errada dão a MESMA mensagem",
      errado.status === 401 && errado.erro === senhaErrada.erro, `${errado.erro} × ${senhaErrada.erro}`);
    const me = await pedir("GET", "/api/me", { cookie: A });
    certo("/api/me diz quem está logado", me.j.usuario && me.j.usuario.login === "admin" && me.j.usuario.admin);

    /* Antes de existir qualquer turma: desde a 1.21.0 o site não aceita
       horário em texto livre — sem turma aberta, não há matrícula online. */
    const semNenhuma = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ horario_desejado: "terça às 10h" }) });
    certo("sem turma cadastrada, o site NÃO aceita horário em texto livre", semNenhuma.status === 400 && /horário/i.test(semNenhuma.j.error), JSON.stringify(semNenhuma.j));

    console.log("\n— atividade, turma e numeração");
    const res0 = await pedir("GET", "/api/gestao/resumo", { cookie: A });
    certo("o primeiro código é 4148", res0.j.proximo_codigo === 4148, String(res0.j.proximo_codigo));
    const ativs = (await pedir("GET", "/api/gestao/atividades", { cookie: A })).j.atividades;
    const natacao = ativs.find((a) => a.nome === "Natação");
    certo("Natação semeada com R$ 110,00", natacao && natacao.mensalidade === 11000);
    const t1 = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: natacao.id, horario: "10:00", publica: true } });
    certo("cria turma das 10:00", t1.status === 200 && t1.j.id);
    const tRuim = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: natacao.id, horario: "25:00" } });
    certo("recusa horário 25:00", tRuim.status === 400);
    const pub = await pedir("GET", "/api/publico/turmas");
    certo("a turma aparece para o site, sem login", pub.status === 200 && pub.j.turmas.some((t) => t.id === t1.j.id));
    certo("o site recebe os dias de aula por extenso", pub.j.dias === "terças, quartas e sextas", pub.j.dias);

    console.log("\n— formulário público");
    const faltando = await pedir("POST", "/api/publico/matricula", { corpo: { nome: "Zz", aceite_termos: true, aceite_dados: true } });
    certo("recusa cadastro incompleto", faltando.status === 400 && /Faltou/.test(faltando.j.error));
    const semAceite = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, aceite_dados: false }) });
    certo("recusa sem a autorização de dados (LGPD)", semAceite.status === 400);
    const semTurma = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR() });
    certo("com turma no site, exige escolher a turma", semTurma.status === 400 && /turma/i.test(semTurma.j.error));
    const cpfRuim = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, resp_cpf: "529.982.247-24" }) });
    certo("recusa CPF do responsável com dígito errado", cpfRuim.status === 400 && /CPF/.test(cpfRuim.j.error));
    const menorSemResp = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, resp_nome: "" }) });
    certo("criança sem responsável é recusada", menorSemResp.status === 400 && /responsável/.test(menorSemResp.j.error));
    const isca = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, site_url: "http://spam" }) });
    const antes = (await pedir("GET", "/api/gestao/alunos?status=pendente", { cookie: A })).j.alunos.length;
    certo("robô que preenche o campo-isca recebe 200 e NADA é gravado", isca.status === 200 && antes === 0, `pendentes: ${antes}`);
    const bom = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, horario_desejado: "zz-livre" }) });
    certo("cadastro válido de criança é aceito", bom.status === 200 && bom.j.ok, JSON.stringify(bom.j));
    const pend = (await pedir("GET", "/api/gestao/alunos?status=pendente", { cookie: A })).j.alunos;
    certo("entra como PRÉ-MATRÍCULA, sem código", pend.length === 1 && pend[0].codigo === null && pend[0].origem === "site");
    const pId = pend[0].id;
    const pCompleto = (await pedir("GET", `/api/gestao/alunos/${pId}`, { cookie: A })).j.aluno;
    const consent = JSON.parse(pCompleto.consentimento || "{}");
    certo("o consentimento fica gravado, dado pelo responsável", consent.dados === true && consent.por === "responsável legal");
    certo("o IP de quem enviou NÃO é guardado", !/127\.0\.0\.1|::1/.test(pCompleto.consentimento));
    certo("texto livre de horário enviado junto é descartado (vale a turma)",
      pCompleto.horario_desejado === "" && pCompleto.matriculas.length === 1 && pCompleto.matriculas[0].turma_id === t1.j.id);
    certo("a turma do site vira matrícula com os dias da academia e a mensalidade da atividade",
      JSON.stringify(pCompleto.matriculas[0].dias) === "[2,3,5]" && pCompleto.matriculas[0].mensalidade === 11000 && pCompleto.mensalidade === 11000,
      JSON.stringify(pCompleto.matriculas[0]));

    console.log("\n— efetivação e código");
    const ctrPend = await pedir("POST", `/api/gestao/alunos/${pId}/contratos`, { cookie: A });
    certo("pré-matrícula NÃO gera contrato (não tem código)", ctrPend.status === 409);
    const ef = await pedir("POST", `/api/gestao/alunos/${pId}/efetivar`, { cookie: A, corpo: {} });
    certo("efetivar dá o código 4148", ef.status === 200 && ef.j.codigo === 4148 && ef.j.codigo_fmt === "004148");
    const ef2 = await pedir("POST", `/api/gestao/alunos/${pId}/efetivar`, { cookie: A, corpo: {} });
    certo("efetivar duas vezes é recusado", ef2.status === 409);
    const antigo = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Aluno Antigo", codigo: "003879", nascimento: "1990-02-10", turma_id: t1.j.id, mensalidade: "110,00" } });
    certo("aluno antigo entra com o código dele (3879)", antigo.status === 200 && antigo.j.codigo === 3879);
    const novo = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Adulto Novo", nascimento: "1985-09-11", cpf: "529.982.247-25", turma_id: t1.j.id, mensalidade: "110,00" } });
    certo("o código antigo NÃO puxa a sequência para trás: o próximo é 4149", novo.j.codigo === 4149, String(novo.j.codigo));
    const dup = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Duplicado", codigo: "4149" } });
    certo("código repetido é recusado, dizendo de quem é", dup.status === 409 && /Adulto Novo/.test(dup.j.error));
    const apagarAtivo = await pedir("DELETE", `/api/gestao/alunos/${novo.j.id}`, { cookie: A });
    certo("aluno matriculado não se apaga — inativa", apagarAtivo.status === 409);

    /* A tela manda o valor com a máscara de real ("R$ 1.234,56"). */
    await pedir("PUT", `/api/gestao/alunos/${novo.j.id}`, { cookie: A, corpo: { mensalidade: "R$ 1.234,56" } });
    const comMascara = (await pedir("GET", `/api/gestao/alunos/${novo.j.id}`, { cookie: A })).j.aluno;
    certo('mensalidade com máscara "R$ 1.234,56" vira 123456 centavos', comMascara.mensalidade === 123456, String(comMascara.mensalidade));
    const moedaRuim = await pedir("PUT", `/api/gestao/alunos/${novo.j.id}`, { cookie: A, corpo: { mensalidade: "R$ 12,3,4" } });
    certo("valor de moeda sem sentido é recusado", moedaRuim.status === 400);

    console.log("\n— contrato");
    await pedir("PUT", `/api/gestao/alunos/${pId}`, { cookie: A, corpo: { mensalidade: "R$ 110,00", resp_rg_emissor: "SDS/PE" } });
    await pedir("PUT", `/api/gestao/alunos/${novo.j.id}`, { cookie: A, corpo: { mensalidade: "R$ 110,00" } });
    const c1 = await pedir("POST", `/api/gestao/alunos/${pId}/contratos`, { cookie: A });
    certo("gera o contrato do aluno efetivado", c1.status === 200 && c1.j.id);
    const imp1 = await pedir("GET", `/admin/imprimir/contrato/${c1.j.id}`, { cookie: A });
    const h1 = imp1.texto;
    certo("menor: quem assina é o RESPONSÁVEL", /CONTRATANTE:<\/b> Zz Qa Responsável - 004148/.test(h1));
    certo("menor: sai o parágrafo do aluno menor de idade", /por nome de <b>Zz Qa Criança Teste<\/b>/.test(h1));
    certo("mensalidade por extenso", /R\$ 110,00 \(CENTO E DEZ REAIS\)/.test(h1));
    certo("dias de aula vêm da configuração", /nos dias de terças, quartas e sextas/.test(h1));
    certo("horário vem da turma", /das 10:00h/.test(h1));
    certo("nenhum marcador sobra no papel", !/\{\{/.test(h1));
    const c2adulto = await pedir("POST", `/api/gestao/alunos/${novo.j.id}/contratos`, { cookie: A });
    const h2 = (await pedir("GET", `/admin/imprimir/contrato/${c2adulto.j.id}`, { cookie: A })).texto;
    certo("adulto: assina ele mesmo, e o parágrafo do menor NÃO sai",
      /CONTRATANTE:<\/b> Zz Qa Adulto Novo - 004149/.test(h2) && !/menor de idade: a contratante/.test(h2));

    const modelo = (await pedir("GET", "/api/gestao/contrato/modelo", { cookie: A })).j;
    const typo = await pedir("POST", "/api/gestao/contrato/modelo", { cookie: A, corpo: { texto: modelo.texto + "<p>{{ENDERECOO}}</p>" } });
    certo("modelo com marcador escrito errado é RECUSADO", typo.status === 400 && /ENDERECOO/.test(typo.j.error));
    const script = await pedir("POST", "/api/gestao/contrato/modelo", { cookie: A, corpo: { texto: modelo.texto.replace("DO FORO", "DO FORO ZZQA-EDITADO") + '<script>alert(1)</script><p onclick="x">y</p>' } });
    certo("modelo editado vira nova versão", script.status === 200 && script.j.versao_id > modelo.versao_id);
    const modelo2 = (await pedir("GET", "/api/gestao/contrato/modelo", { cookie: A })).j;
    certo("o saneador tira script e atributo do modelo", !/<script|onclick/.test(modelo2.texto) && /ZZQA-EDITADO/.test(modelo2.texto));
    const h1depois = (await pedir("GET", `/admin/imprimir/contrato/${c1.j.id}`, { cookie: A })).texto;
    certo("o contrato JÁ GERADO não muda com a edição do modelo", h1depois === h1 && !/ZZQA-EDITADO/.test(h1depois));
    const c3 = await pedir("POST", `/api/gestao/alunos/${pId}/contratos`, { cookie: A });
    const h3 = (await pedir("GET", `/admin/imprimir/contrato/${c3.j.id}`, { cookie: A })).texto;
    certo("o contrato gerado DEPOIS usa o modelo novo", /ZZQA-EDITADO/.test(h3));

    console.log("\n— professores");
    const pHidro = await pedir("POST", "/api/gestao/professores", { cookie: A, corpo: { nome: "Zz Prof Hidro", cref: "001234-G/PE", telefone: "(81) 98888-0000" } });
    const pOutro = await pedir("POST", "/api/gestao/professores", { cookie: A, corpo: { nome: "Zz Prof Substituta" } });
    certo("cadastra professor", pHidro.status === 200 && pHidro.j.id && pOutro.j.id);
    const pDup = await pedir("POST", "/api/gestao/professores", { cookie: A, corpo: { nome: "zz prof hidro" } });
    certo("nome de professor repetido (sem diferença de maiúsculas) é recusado", pDup.status === 409);
    const pMail = await pedir("POST", "/api/gestao/professores", { cookie: A, corpo: { nome: "Zz Prof Email", email: "sem-arroba" } });
    certo("e-mail de professor inválido é recusado", pMail.status === 400);
    const tFantasma = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: natacao.id, horario: "08:00", professor_id: 99999 } });
    certo("turma com professor inexistente é recusada", tFantasma.status === 400);

    console.log("\n— várias atividades por aluno, dias de cada uma e vagas");
    const hidro = await pedir("POST", "/api/gestao/atividades", { cookie: A, corpo: { nome: "Hidroginástica", mensalidade: "R$ 90,00" } });
    const tHidro = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: hidro.j.id, horario: "07:00", vagas: 1, professor_id: pHidro.j.id } });
    const tNat6 = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: natacao.id, horario: "06:00" } });
    const multi = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Duas Atividades", nascimento: "1980-01-15",
      cpf: "529.982.247-25", matriculas: [
        { turma_id: tNat6.j.id, dias: [2, 5], mensalidade: "R$ 110,00" },
        { turma_id: tHidro.j.id, dias: [], mensalidade: "" },
        { turma_id: 0 } ] } });
    const mA = (await pedir("GET", `/api/gestao/alunos/${multi.j.id}`, { cookie: A })).j.aluno;
    certo("aluno com duas atividades (linha em branco ignorada)", multi.status === 200 && mA.matriculas.length === 2, JSON.stringify(multi.j));
    /* A tela confere este número com quantas atividades mandou: é o que
       denuncia um servidor desatualizado que descarta a lista calado. */
    certo("o servidor responde quantas atividades o aluno ficou tendo", multi.j.matriculas === 2, String(multi.j.matriculas));
    const nat6 = mA.matriculas.find((x) => x.turma_id === tNat6.j.id), hid = mA.matriculas.find((x) => x.turma_id === tHidro.j.id);
    certo("cada atividade guarda os SEUS dias (vazio = dias da academia)",
      JSON.stringify(nat6.dias) === "[2,5]" && JSON.stringify(hid.dias) === "[2,3,5]");
    certo("mensalidade vazia usa a da atividade; o total é a soma", hid.mensalidade === 9000 && mA.mensalidade === 20000, `${hid.mensalidade} / ${mA.mensalidade}`);
    certo("o professor da turma vem junto (pelo cadastro)", hid.professor === "Zz Prof Hidro" && hid.professor_id === null);
    const lTurmas = (await pedir("GET", "/api/gestao/turmas", { cookie: A })).j.turmas;
    certo("a lista de turmas mostra o nome do professor cadastrado", lTurmas.find((x) => x.id === tHidro.j.id).professor === "Zz Prof Hidro");
    /* O nome sai sempre do cadastro: renomear o professor aparece na hora em
       todas as turmas, sem cópia velha em lugar nenhum. */
    await pedir("PUT", `/api/gestao/professores/${pHidro.j.id}`, { cookie: A, corpo: { nome: "Zz Profa Ana Hidro", cref: "001234-G/PE" } });
    const renomeada = (await pedir("GET", `/api/gestao/alunos/${multi.j.id}`, { cookie: A })).j.aluno.matriculas.find((x) => x.turma_id === tHidro.j.id);
    certo("renomear o professor muda o nome em todo lugar", renomeada.professor === "Zz Profa Ana Hidro", renomeada.professor);
    await pedir("PUT", `/api/gestao/professores/${pHidro.j.id}`, { cookie: A, corpo: { nome: "Zz Prof Hidro", cref: "001234-G/PE" } });
    /* Outro professor só para ESTE aluno nesta atividade. */
    const trocaProf = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [
      { turma_id: tNat6.j.id, dias: [2, 5], mensalidade: "R$ 110,00" },
      { turma_id: tHidro.j.id, mensalidade: "R$ 90,00", professor_id: pOutro.j.id } ] } });
    const comOutro = (await pedir("GET", `/api/gestao/alunos/${multi.j.id}`, { cookie: A })).j.aluno.matriculas.find((x) => x.turma_id === tHidro.j.id);
    certo("a atividade do aluno pode ter outro professor, só para ele",
      trocaProf.status === 200 && comOutro.professor === "Zz Prof Substituta" && comOutro.professor_turma === "Zz Prof Hidro");
    const fComOutro = (await pedir("GET", `/admin/imprimir/ficha/${multi.j.id}`, { cookie: A })).texto;
    certo("a ficha mostra o professor da atividade do aluno", /Zz Prof Substituta/.test(fComOutro));
    const profInexistente = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [{ turma_id: tHidro.j.id, professor_id: 88888 }] } });
    certo("professor inexistente na atividade do aluno é recusado", profInexistente.status === 400);
    const apagaUsado = await pedir("DELETE", `/api/gestao/professores/${pOutro.j.id}`, { cookie: A });
    certo("professor em uso não se apaga (inativa)", apagaUsado.status === 409);
    await pedir("PUT", `/api/gestao/professores/${pOutro.j.id}`, { cookie: A, corpo: { nome: "Zz Prof Substituta", ativo: false } });
    const mantem = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [
      { turma_id: tNat6.j.id, dias: [2, 5], mensalidade: "R$ 110,00" },
      { turma_id: tHidro.j.id, mensalidade: "R$ 90,00", professor_id: pOutro.j.id } ] } });
    certo("professor inativado continua onde já estava (salvar sem mexer não o tira)", mantem.status === 200);
    const novoComInativo = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: natacao.id, horario: "09:00", professor_id: pOutro.j.id } });
    certo("mas professor inativo não entra numa turma nova", novoComInativo.status === 400);
    const lProf = (await pedir("GET", "/api/gestao/professores", { cookie: A })).j.professores;
    certo("a lista de professores conta turmas e alunos de cada um",
      lProf.find((x) => x.id === pHidro.j.id).turmas === 1 && lProf.find((x) => x.id === pOutro.j.id).alunos === 1,
      JSON.stringify(lProf.map((x) => [x.nome, x.turmas, x.alunos])));
    const semUso = await pedir("POST", "/api/gestao/professores", { cookie: A, corpo: { nome: "Zz Prof Sem Uso" } });
    certo("professor sem uso se apaga", (await pedir("DELETE", `/api/gestao/professores/${semUso.j.id}`, { cookie: A })).status === 200);
    await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [
      { turma_id: tNat6.j.id, dias: [2, 5], mensalidade: "R$ 110,00" }, { turma_id: tHidro.j.id, mensalidade: "R$ 90,00" } ] } });
    const repetida = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [{ turma_id: tHidro.j.id }, { turma_id: tHidro.j.id }] } });
    certo("a mesma turma duas vezes é recusada", repetida.status === 400);
    const diaRuim = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [{ turma_id: tHidro.j.id, dias: [9] }] } });
    certo("dia da semana inexistente é recusado", diaRuim.status === 400);
    const soltaComDuas = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { mensalidade: "R$ 50,00" } });
    certo("mensalidade solta num aluno de duas atividades é recusada (não dá para saber de qual)", soltaComDuas.status === 400);

    const cMulti = await pedir("POST", `/api/gestao/alunos/${multi.j.id}/contratos`, { cookie: A });
    const hMulti = (await pedir("GET", `/admin/imprimir/contrato/${cMulti.j.id}`, { cookie: A })).texto;
    certo("contrato com duas atividades: \"de Hidroginástica e Natação … das 06:00h e das 07:00h\"",
      /atividade física de (Natação e Hidroginástica|Hidroginástica e Natação)/.test(hMulti) && /das 06:00h e das 07:00h\./.test(hMulti),
      (hMulti.match(/atividade física de[^.]*\./) || [""])[0]);
    certo("o contrato leva o TOTAL das mensalidades", /R\$ 200,00 \(DUZENTOS REAIS\)/.test(hMulti));
    const fMulti = (await pedir("GET", `/admin/imprimir/ficha/${multi.j.id}`, { cookie: A })).texto;
    certo("a ficha traz a grade de atividades com os dias marcados",
      /class="f-ativ"/.test(fMulti) && /Hidroginástica/.test(fMulti) && /Zz Prof Hidro/.test(fMulti) && (fMulti.match(/<td class="d">X<\/td>/g) || []).length === 5);

    /* Vaga excedida: permitido, com aviso. A turma das 07h tem 1 vaga e o
       aluno acima já a ocupa. */
    const excede = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Excedente", nascimento: "1979-04-02",
      matriculas: [{ turma_id: tHidro.j.id }] } });
    certo("aluno além do limite de vagas É cadastrado", excede.status === 200 && excede.j.id);
    certo("…e o sistema avisa que a turma passou do limite", (excede.j.avisos || []).some((a) => /passou do limite: 2 alunos para 1 vaga\./.test(a)), JSON.stringify(excede.j.avisos));
    const tl = (await pedir("GET", "/api/gestao/turmas", { cookie: A })).j.turmas.find((t) => t.id === tHidro.j.id);
    certo("a turma aparece como excedente (+1)", tl.alunos_ativos === 2 && tl.excedente === 1);
    const ind = (await pedir("GET", "/api/gestao/indicadores", { cookie: A })).j;
    const indH = ind.turmas.find((t) => t.id === tHidro.j.id);
    certo("indicadores: alunos por turma, com o limite e o excedente", indH && indH.ativos === 2 && indH.vagas === 1 && indH.excedente === 1 && ind.acima_do_limite >= 1);
    const indNat = ind.atividades.find((a) => a.nome === "Natação");
    const natReal = (await pedir("GET", "/api/gestao/alunos?status=ativo", { cookie: A })).j.alunos.filter((x) => /Natação/.test(x.turma)).length;
    certo("indicadores: por atividade conta ALUNOS (quem faz duas turmas conta uma vez)", indNat.ativos === natReal, `${indNat.ativos} × ${natReal}`);
    const relT = (await pedir("GET", "/admin/imprimir/relatorio/turmas?status=ativo", { cookie: A })).texto;
    certo("o relatório de turmas mostra o excedente", /2 \(excedente: \+1\)/.test(relT));
    const tirar = await pedir("PUT", `/api/gestao/alunos/${multi.j.id}`, { cookie: A, corpo: { matriculas: [{ turma_id: tNat6.j.id, dias: [2, 5], mensalidade: "R$ 110,00" }] } });
    const mB = (await pedir("GET", `/api/gestao/alunos/${multi.j.id}`, { cookie: A })).j.aluno;
    certo("tirar uma atividade mantém a outra — com a data em que o aluno entrou nela",
      tirar.status === 200 && tirar.j.matriculas === 1 && mB.matriculas.length === 1 && mB.matriculas[0].id === nat6.id && mB.mensalidade === 11000);
    const apagarTurma = await pedir("DELETE", `/api/gestao/turmas/${tHidro.j.id}`, { cookie: A });
    certo("turma com aluno matriculado não se apaga", apagarTurma.status === 409);

    const hist = (await pedir("GET", `/api/gestao/alunos/${pId}/contratos`, { cookie: A })).j.contratos;
    certo("histórico com os dois contratos, mais novo primeiro", hist.length === 2 && hist[0].id === c3.j.id);
    certo("histórico registra quem gerou", hist.every((c) => c.gerado_por === "Administrador"));
    const ass = await pedir("PUT", `/api/gestao/contratos/${c1.j.id}/assinatura`, { cookie: A, corpo: { assinado: true } });
    const hist2 = (await pedir("GET", `/api/gestao/alunos/${pId}/contratos`, { cookie: A })).j.contratos;
    const assinado = hist2.find((c) => c.id === c1.j.id);
    certo("marcar como assinado registra quando e quem", ass.status === 200 && assinado.assinado === 1 && assinado.assinado_por === "Administrador" && assinado.assinado_txt);

    /* A trava de verdade é no banco. Abre o arquivo temporário por fora do
       servidor e tenta o que a tela não oferece. */
    let banco;
    try { banco = new (require("better-sqlite3"))(path.join(TMP, "data", "site.db")); }
    catch { const { DatabaseSync } = require("node:sqlite"); banco = new DatabaseSync(path.join(TMP, "data", "site.db")); }
    let alterou = true, apagou = true;
    try { banco.prepare("UPDATE g_contratos SET html='ADULTERADO' WHERE id=?").run(c1.j.id); } catch { alterou = false; }
    try { banco.prepare("DELETE FROM g_contratos WHERE id=?").run(c1.j.id); } catch { apagou = false; }
    let modeloAlterou = true;
    try { banco.prepare("UPDATE g_contrato_modelos SET texto='x' WHERE id=?").run(modelo.versao_id); } catch { modeloAlterou = false; }
    const linhasAud = banco.prepare("SELECT COUNT(*) AS n FROM g_auditoria").get().n;
    let audAlterou = true, audApagou = true;
    try { banco.prepare("UPDATE g_auditoria SET acao='nada aconteceu' WHERE id=1").run(); } catch { audAlterou = false; }
    try { banco.prepare("DELETE FROM g_auditoria").run(); } catch { audApagou = false; }
    banco.close();
    certo("o BANCO recusa alterar o texto de um contrato gerado", !alterou);
    certo("o BANCO recusa apagar um contrato gerado", !apagou);
    certo("o BANCO recusa alterar uma versão antiga do modelo", !modeloAlterou);
    certo("a auditoria já tem registros a esta altura", linhasAud > 5, String(linhasAud));
    certo("o BANCO recusa alterar um registro da auditoria", !audAlterou);
    certo("o BANCO recusa apagar a auditoria", !audApagou);

    console.log("\n— foto do aluno e imagens privadas");
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    const fotoFalsa = await pedir("POST", `/api/gestao/alunos/${pId}/foto`, { cookie: A, corpo: { dataUrl: `data:image/png;base64,${html}` } });
    certo("HTML disfarçado de PNG é recusado pelo conteúdo", fotoFalsa.status === 400);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const foto = await pedir("POST", `/api/gestao/alunos/${pId}/foto`, { cookie: A, corpo: { dataUrl: `data:image/png;base64,${png}` } });
    certo("foto PNG de verdade é aceita", foto.status === 200 && foto.j.foto_id);
    const semLogin = await pedir("GET", `/admin/arquivo/${foto.j.foto_id}`);
    certo("a foto SEM login não sai (manda para o login)", semLogin.status === 302 && semLogin.cab.get("location") === "/admin/");
    const comLogin = await pedir("GET", `/admin/arquivo/${foto.j.foto_id}`, { cookie: A });
    certo("a foto com login sai como imagem, sem cache compartilhado",
      comLogin.status === 200 && comLogin.cab.get("content-type") === "image/png" && /private/.test(comLogin.cab.get("cache-control")));
    certo("nenhuma foto de aluno foi parar na pasta pública", !fs.readdirSync(path.join(__dirname, "assets", "img", "uploads")).some((f) => /zz-qa/i.test(f)));

    console.log("\n— impressos");
    const ficha = await pedir("GET", `/admin/imprimir/ficha/${pId}`, { cookie: A });
    certo("a ficha abre com o nome, o código e as condições",
      ficha.status === 200 && /Zz Qa Criança Teste/.test(ficha.texto) && /004148/.test(ficha.texto) && /CONDIÇÕES DA MATRÍCULA/.test(ficha.texto));
    certo("a ficha tem o ajuste de uma folha", /data-uma-folha/.test(ficha.texto));
    certo("a página impressa tem CSP própria", /default-src 'none'/.test(ficha.cab.get("content-security-policy") || ""));
    const fichaSem = await pedir("GET", `/admin/imprimir/ficha/${pId}`);
    certo("a ficha SEM login não abre", fichaSem.status === 302);
    const relA = await pedir("GET", "/admin/imprimir/relatorio/alunos?status=ativo", { cookie: A });
    const nAtivos = (await pedir("GET", "/api/gestao/alunos?status=ativo", { cookie: A })).j.alunos.length;
    certo("relatório de alunos ativos lista todos os ativos", relA.status === 200 && nAtivos >= 5 && relA.texto.includes(`${nAtivos} aluno(s)`),
      (relA.texto.match(/\d+ aluno\(s\)/) || [])[0] + ` × ${nAtivos}`);
    certo("o relatório de alunos mostra as atividades de cada um", /Natação — 06:00/.test(relA.texto) && /<th>Atividades<\/th>/.test(relA.texto));
    await pedir("PUT", `/api/gestao/alunos/${antigo.j.id}`, { cookie: A, corpo: { status: "inativo" } });
    const relI = await pedir("GET", "/admin/imprimir/relatorio/alunos?status=inativo", { cookie: A });
    certo("inativar move o aluno para o relatório de inativos", /1 aluno\(s\)/.test(relI.texto) && /Aluno Antigo/.test(relI.texto));
    const aniv = await pedir("GET", "/admin/imprimir/relatorio/aniversariantes?mes=5", { cookie: A });
    certo("aniversariantes de maio encontra a criança (03/05)", /Criança Teste/.test(aniv.texto));
    const turmasRel = await pedir("GET", "/admin/imprimir/relatorio/turmas?status=ativo", { cookie: A });
    certo("relatório de turmas ativas lista as turmas", /3 turma\(s\)/.test(turmasRel.texto), (turmasRel.texto.match(/\d+ turma\(s\)/) || [])[0]);

    console.log("\n— configurações, feriados e agenda");
    const semDia = await pedir("PUT", "/api/gestao/config", { cookie: A, corpo: { dias_aula: [] } });
    certo("não deixa ficar sem nenhum dia de aula", semDia.status === 400);
    const cfg = (await pedir("GET", "/api/gestao/config", { cookie: A })).j;
    certo("terça, quarta e sexta vêm marcados", JSON.stringify(cfg.dias_aula) === "[2,3,5]");
    const fer = (await pedir("GET", "/api/gestao/feriados?ano=2026", { cookie: A })).j.feriados;
    certo("feriados semeados: nacionais, Pernambuco e Caruaru", fer.length === 15 &&
      fer.some((f) => f.esfera === "estadual") && fer.filter((f) => f.esfera === "municipal").length === 4);
    certo("Sexta-feira Santa de 2026 cai em 03/04", fer.find((f) => f.nome === "Sexta-feira Santa").data_no_ano === "03/04/2026");
    const f30 = await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Zz", tipo: "anual", dia: 30, mes: 2 } });
    certo("recusa 30 de fevereiro", f30.status === 400);
    const carnaval = await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Carnaval", tipo: "pascoa", pascoa: -47, esfera: "academia" } });
    certo("aceita feriado relativo à Páscoa", carnaval.status === 200);
    const fev = (await pedir("GET", "/api/gestao/agenda?ano=2026&mes=2", { cookie: A })).j.dias;
    certo("Carnaval 2026 (17/02, terça) aparece como feriado e não como aula",
      fev[16].feriado === "Carnaval" && fev[16].aula === false && fev[16].semana === 2 && fev[16].cor === "feriado");
    const set = (await pedir("GET", "/api/gestao/agenda?ano=2026&mes=9", { cookie: A })).j.dias;
    certo("15/09 (padroeira, terça) é feriado; 16/09 (quarta) é aula", /Dores/.test(set[14].feriado) && set[15].aula === true);
    await pedir("DELETE", `/api/gestao/feriados/${fer.find((f) => f.nome === "Tiradentes").id}`, { cookie: A });

    console.log("\n— calendário: dia de aula, outra atividade e quem vence");
    certo("os feriados semeados e os antigos ficam como FERIADO", fer.every((f) => f.categoria === "feriado"));
    const catRuim = await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Zz", categoria: "festa", tipo: "data", data: "2026-09-22" } });
    certo("tipo de dia desconhecido é recusado (não vira feriado em silêncio)", catRuim.status === 400);
    const exame = await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Zz Exame de pele", categoria: "atividade", tipo: "data", data: "2026-09-22" } });
    await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Zz Exame de pele", categoria: "atividade", tipo: "data", data: "2026-03-10" } });
    const capac = await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Zz Capacitação da equipe", categoria: "atividade", tipo: "data", data: "2026-09-15", esfera: "nacional" } });
    const repos = await pedir("POST", "/api/gestao/feriados", { cookie: A, corpo: { nome: "Zz Aula no São João", categoria: "aula", tipo: "data", data: "2026-06-24" } });
    certo("cadastra outra atividade e dia de aula numa data só", exame.status === 200 && capac.status === 200 && repos.status === 200);
    const set2 = (await pedir("GET", "/api/gestao/agenda?ano=2026&mes=9", { cookie: A })).j.dias;
    certo("22/09 (terça) com exame de pele fica AMARELO e continua tendo aula",
      set2[21].cor === "atividade" && set2[21].aula === true && set2[21].eventos.some((v) => v.nome === "Zz Exame de pele"), JSON.stringify(set2[21]));
    certo("data só daquele dia vence a que se repete: 15/09 vira atividade, e o feriado aparece como vencido",
      set2[14].cor === "atividade" && set2[14].eventos.some((v) => /Dores/.test(v.nome) && v.vale === false), JSON.stringify(set2[14].eventos));
    certo("atividade num feriado NÃO abre aula", set2[14].aula === false);
    const jun26 = (await pedir("GET", "/api/gestao/agenda?ano=2026&mes=6", { cookie: A })).j.dias;
    const jun27 = (await pedir("GET", "/api/gestao/agenda?ano=2027&mes=6", { cookie: A })).j.dias;
    certo("dia de aula cadastrado em 24/06/2026 fica AZUL, com aula", jun26[23].cor === "aula" && jun26[23].aula === true);
    certo("e o São João de 2027 continua feriado (a regra anual não mudou)", jun27[23].cor === "feriado" && jun27[23].aula === false);
    const lista = (await pedir("GET", "/api/gestao/feriados?ano=2026", { cookie: A })).j.feriados;
    const exames = lista.filter((f) => f.nome === "Zz Exame de pele").map((f) => f.data_no_ano).sort();
    certo('duas datas com o mesmo nome mostram, cada uma, a SUA data em "Em 2026"',
      JSON.stringify(exames) === JSON.stringify(["10/03/2026", "22/09/2026"]), JSON.stringify(exames));
    certo("atividade não guarda esfera de feriado", lista.find((f) => f.nome === "Zz Capacitação da equipe").esfera === "academia");

    console.log("\n— impressão e agenda do mês");
    const agImp = await pedir("GET", "/admin/imprimir/agenda?ano=2026&mes=9", { cookie: A });
    certo("a agenda do mês sai para imprimir, com os dias de aula e as datas",
      agImp.status === 200 && /Agenda de setembro de 2026/.test(agImp.texto) && /Aulas às terças, quartas e sextas/.test(agImp.texto)
      && /Zz Exame de pele/.test(agImp.texto) && /ag-dia atividade/.test(agImp.texto));
    certo("na agenda impressa, a data vencida no mesmo dia NÃO aparece (15/09: só a capacitação)",
      /Zz Capacitação da equipe/.test(agImp.texto) && !/15\/09<\/b> — Nossa Senhora das Dores/.test(agImp.texto));
    certo("a agenda impressa não sai sem login", (await pedir("GET", "/admin/imprimir/agenda?ano=2026&mes=9")).status === 302);
    certo("mês inválido na agenda impressa é recusado", (await pedir("GET", "/admin/imprimir/agenda?ano=2026&mes=13", { cookie: A })).status === 400);
    /* Sem margem de página não há onde o navegador pôr data, título e
       endereço — é assim que o cabeçalho e o rodapé dele somem. */
    for (const [nome, h] of [["ficha", ficha.texto], ["agenda", agImp.texto], ["relatório", relI.texto]]) {
      certo(`${nome}: página sem margem (sem cabeçalho/rodapé do navegador) e com Vertical/Horizontal`,
        /@page\{size:A4 (portrait|landscape);margin:0\}/.test(h) && /data-orient="v"/.test(h) && /data-orient="h"/.test(h) && /class="moldura"/.test(h));
    }
    certo("o cabeçalho do documento não diz mais \"Página 1\"", !/Página 1/.test(relI.texto));
    const agApi = (await pedir("GET", "/api/gestao/agenda?ano=2026&mes=9", { cookie: A })).j;
    certo("a agenda leva o contato público para a imagem de rede social",
      agApi.contato && agApi.contato.site === "formsfitness.com" && typeof agApi.contato.whatsapp === "string" && agApi.dias_txt === "terças, quartas e sextas");

    /* A migração da turma única (até a 1.21) para matrícula, num banco na
       memória: o aluno antigo ganha a matrícula uma vez só, com a mensalidade
       e os dias da academia — e rodar de novo não recria o que foi tirado. */
    {
      let mem;
      try { mem = new (require("better-sqlite3"))(":memory:"); }
      catch { const { DatabaseSync } = require("node:sqlite"); mem = new DatabaseSync(":memory:"); }
      const cfg = new Map();
      const instalar = () => require("./gestao/esquema").instalar({ db: mem, getS: (k) => cfg.get(k), setS: (k, v) => cfg.set(k, String(v)), hashSenha: () => "x" });
      instalar();
      mem.prepare("INSERT INTO g_turmas(atividade_id,horario,criado_em) VALUES(1,'06:00','x')").run();
      mem.prepare("INSERT INTO g_alunos(nome,turma_id,mensalidade,criado_em) VALUES('Zz Antigo',1,9900,'x')").run();
      cfg.delete("g_migracao_matriculas");
      instalar();
      const migradas = mem.prepare("SELECT * FROM g_matriculas").all();
      certo("migração: a turma do aluno antigo vira matrícula, com a mensalidade e os dias da academia",
        migradas.length === 1 && migradas[0].mensalidade === 9900 && migradas[0].dias === "[2,3,5]", JSON.stringify(migradas));
      mem.prepare("DELETE FROM g_matriculas").run();
      instalar();
      certo("migração: roda uma vez só (a matrícula tirada não volta)", mem.prepare("SELECT COUNT(*) AS n FROM g_matriculas").get().n === 0);
      /* O professor digitado em cada turma (até a 1.22) vira cadastro: um
         por nome, sem diferença de maiúsculas nem espaço sobrando. */
      mem.prepare("INSERT INTO g_turmas(atividade_id,horario,professor,criado_em) VALUES(1,'07:00','Ronaldo','x')").run();
      mem.prepare("INSERT INTO g_turmas(atividade_id,horario,professor,criado_em) VALUES(1,'08:00','  ronaldo ','x')").run();
      mem.prepare("INSERT INTO g_turmas(atividade_id,horario,professor,criado_em) VALUES(1,'09:00','Ana Paula','x')").run();
      mem.prepare("UPDATE g_turmas SET professor='' WHERE horario='06:00'").run();
      cfg.delete("g_migracao_professores");
      instalar();
      const profs = mem.prepare("SELECT nome FROM g_professores ORDER BY nome").all().map((x) => x.nome);
      const ligadas = mem.prepare("SELECT horario, professor_id FROM g_turmas ORDER BY horario").all();
      certo("migração: o nome digitado vira professor, um por pessoa (Ronaldo = ronaldo)",
        JSON.stringify(profs) === '["Ana Paula","Ronaldo"]' && ligadas[1].professor_id === ligadas[2].professor_id && ligadas[0].professor_id === null,
        JSON.stringify({ profs, ligadas }));
      mem.close();
    }

    console.log("\n— usuários e permissões");
    const nova = await pedir("POST", "/api/gestao/usuarios", { cookie: A, corpo: { nome: "Zz Qa Secretária", login: "zzqa.secretaria", senha: "senha-zzqa-1" } });
    certo("administrador cria usuária", nova.status === 200);
    /* Os dois logins errados do começo deixaram este endereço sob a espera
       progressiva do limitador (1s depois do 2º erro). A suíte corre mais
       rápido que isso — então espera, em vez de esconder o freio. */
    await new Promise((r) => setTimeout(r, 1200));
    const sec = await entrar("zzqa.secretaria", "senha-zzqa-1");
    certo("a secretária entra com o login dela", sec.status === 200, `status ${sec.status}: ${sec.erro}`);
    const S = sec.cookie;
    const vendoUsuarios = await pedir("GET", "/api/gestao/usuarios", { cookie: S });
    certo("secretária NÃO gerencia usuários, nem por fetch", vendoUsuarios.status === 403);
    const virarAdmin = await pedir("PUT", `/api/gestao/usuarios/${nova.j.id}`, { cookie: S, corpo: { admin: true } });
    certo("secretária NÃO se promove a administradora", virarAdmin.status === 403);
    const audSec = await pedir("GET", "/api/gestao/auditoria", { cookie: S });
    certo("secretária NÃO vê a auditoria", audSec.status === 403);
    const sobreSec = await pedir("GET", "/api/gestao/sobre", { cookie: S });
    const versaoPacote = require("./package.json").version;
    certo("qualquer usuário vê Sobre o sistema, com a versão do pacote", sobreSec.status === 200 && sobreSec.j.versao === versaoPacote,
      `${sobreSec.status} ${sobreSec.j.versao} × ${versaoPacote}`);
    certo("o histórico de versões começa pela versão atual", sobreSec.j.versoes?.[0]?.versao === versaoPacote, sobreSec.j.versoes?.[0]?.versao);
    certo("o histórico vem sem HTML escrito no arquivo (só o do conversor)",
      sobreSec.j.versoes.length > 3 && sobreSec.j.versoes.every((v) => !/<script|<a |onclick/i.test(v.html)));
    const cSec = await pedir("POST", `/api/gestao/alunos/${novo.j.id}/contratos`, { cookie: S });
    const histSec = (await pedir("GET", `/api/gestao/alunos/${novo.j.id}/contratos`, { cookie: S })).j.contratos;
    certo("o contrato gerado por ela sai com o NOME dela", cSec.status === 200 && histSec[0].gerado_por === "Zz Qa Secretária");
    const eu = (await pedir("GET", "/api/me", { cookie: A })).j.usuario.id;
    const meDesativar = await pedir("PUT", `/api/gestao/usuarios/${eu}`, { cookie: A, corpo: { ativo: false } });
    certo("ninguém desativa a própria conta", meDesativar.status === 409);
    /* Esta prova passava VAZIA na primeira versão: a secretária nem tinha
       conseguido entrar, então o 401 depois da desativação provava nada. Agora
       ela precisa ter acesso ANTES para a prova valer. */
    const antesDeDesativar = await pedir("GET", "/api/gestao/resumo", { cookie: S });
    await pedir("PUT", `/api/gestao/usuarios/${nova.j.id}`, { cookie: A, corpo: { ativo: false } });
    const depois = await pedir("GET", "/api/gestao/resumo", { cookie: S });
    certo("desativar a usuária derruba a sessão dela NA HORA",
      S && antesDeDesativar.status === 200 && depois.status === 401, `antes ${antesDeDesativar.status}, depois ${depois.status}`);

    console.log("\n— auditoria");
    const aud = (await pedir("GET", "/api/gestao/auditoria?limite=500", { cookie: A })).j;
    const acha = (fn) => aud.itens.find(fn);
    certo("registra a entrada no sistema, com quem e de onde",
      acha((l) => l.acao === "Entrou no sistema" && /admin/.test(l.usuario) && l.ip));
    certo("registra a tentativa de entrar recusada, com o usuário digitado",
      acha((l) => l.acao === "Tentativa de entrar recusada" && /ninguem/.test(l.alvo) && l.status === 401));
    const pre = acha((l) => l.acao === "Pré-matrícula recebida pelo site");
    certo("registra a pré-matrícula do site SEM o IP e SEM o nome (a privacidade promete apagar)",
      pre && pre.ip === "" && /^pré-matrícula nº \d+$/.test(pre.alvo) && !aud.itens.some((l) => /Repetido 0/.test(l.alvo)), JSON.stringify(pre));
    certo("registra a efetivação, dizendo de qual aluno (a partir daqui, com nome e código)",
      acha((l) => l.acao === "Efetivou matrícula" && /Criança Teste \(004148\)/.test(l.alvo)));
    certo("registra o contrato gerado pela secretária, no nome dela",
      acha((l) => l.acao === "Gerou contrato" && /zzqa\.secretaria/.test(l.usuario)));
    certo("registra também o que foi RECUSADO (a secretária tentando se promover)",
      acha((l) => l.acao === "Editou usuário" && /zzqa\.secretaria/.test(l.usuario) && l.status === 403));
    certo("registra a impressão da ficha", acha((l) => l.acao === "Imprimiu a ficha do aluno" && /Criança Teste/.test(l.alvo)));
    certo("o que foi APAGADO aparece com o nome de antes de apagar", acha((l) => l.acao === "Apagou data do calendário" && l.alvo === "Tiradentes"));
    certo("leitura comum (listas, telas) não entra na auditoria", !aud.itens.some((l) => l.metodo === "GET" && !/imprimir/.test(l.rota)));
    const secId = aud.usuarios.find((u) => u.login === "zzqa.secretaria").id;
    const soDela = (await pedir("GET", `/api/gestao/auditoria?usuario=${secId}`, { cookie: A })).j.itens;
    certo("o filtro por pessoa traz só o que ela fez", soDela.length > 0 && soDela.every((l) => l.usuario_id === secId));
    /* Paginação no servidor (1.24.0): alunos e auditoria em páginas
       numeradas, com o total — a lista antiga de alunos cortava em 500. */
    const tudo = (await pedir("GET", "/api/gestao/alunos", { cookie: A })).j;
    const pg1 = (await pedir("GET", "/api/gestao/alunos?pagina=1&por=2", { cookie: A })).j;
    const pg2 = (await pedir("GET", "/api/gestao/alunos?pagina=2&por=2", { cookie: A })).j;
    certo("alunos em páginas: 2 por página, com o total de todos",
      pg1.alunos.length === 2 && pg1.total === tudo.alunos.length && pg1.pagina === 1 && pg1.por === 2, JSON.stringify({ t: pg1.total, n: pg1.alunos.length }));
    certo("a página 2 continua de onde a 1 parou, sem repetir", pg2.alunos.every((a) => !pg1.alunos.some((b) => b.id === a.id))
      && JSON.stringify([...pg1.alunos, ...pg2.alunos].map((a) => a.id)) === JSON.stringify(tudo.alunos.slice(0, 4).map((a) => a.id)));
    const pgLonge = (await pedir("GET", "/api/gestao/alunos?pagina=999&por=2", { cookie: A })).j;
    certo("página além do fim cai na última (não numa lista vazia)", pgLonge.pagina === Math.ceil(tudo.alunos.length / 2) && pgLonge.alunos.length > 0);
    certo("sem pedir página, a lista vem inteira (a tela de relatórios precisa)", tudo.alunos.length === tudo.total && tudo.pagina === undefined);
    const filtrado = (await pedir("GET", "/api/gestao/alunos?status=inativo&pagina=1&por=20", { cookie: A })).j;
    certo("o total da página respeita o filtro", filtrado.total === filtrado.alunos.length && filtrado.alunos.every((a) => a.status === "inativo"));
    const ap1 = (await pedir("GET", "/api/gestao/auditoria?pagina=1&por=5", { cookie: A })).j;
    const ap2 = (await pedir("GET", "/api/gestao/auditoria?pagina=2&por=5", { cookie: A })).j;
    certo("auditoria em páginas numeradas, com o total", ap1.itens.length === 5 && ap1.total > 10 && ap2.itens[0].id < ap1.itens[4].id);
    const p1 = (await pedir("GET", "/api/gestao/auditoria?limite=3", { cookie: A })).j;
    const p2 = (await pedir("GET", `/api/gestao/auditoria?limite=3&antes=${p1.itens[2].id}`, { cookie: A })).j;
    certo("a lista vem em páginas, sem repetir linha", p1.mais && p1.itens.length === 3 && p2.itens.every((l) => l.id < p1.itens[2].id));

    console.log("\n— o que não pode escapar");
    const codigo = await pedir("GET", "/gestao/rotas.js");
    certo("o código da gestão não é servido pela web", codigo.status === 404);
    const internos = await Promise.all(["/testar-gestao.js", "/backup.js", "/docs/documentacao-tecnica.pdf", "/ci/sudoers-forms"]
      .map(async (u) => [u, (await pedir("GET", u)).status]));
    certo("nada fora dos lugares públicos sai pela web (esta suíte, backup, docs, ci)",
      internos.every(([, s]) => s === 404), JSON.stringify(internos));
    const apiSem = await pedir("GET", "/api/gestao/alunos");
    certo("a API da gestão sem login é 401", apiSem.status === 401);
    for (let i = 0; i < 4; i++) await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, nome: `Zz Qa Repetido ${i}` }) });
    const excesso = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, nome: "Zz Qa Sexto" }) });
    certo("o 6º envio na mesma hora é freado (429)", excesso.status === 429, String(excesso.status));
    const gordo = await pedir("POST", "/api/publico/matricula", { corpo: { ...PUB_MENOR({ turma_id: t1.j.id }), observacao: "x".repeat(40000) } });
    certo("envio público gigante é recusado", gordo.status === 413 || gordo.status === 429);
    const pendentes = (await pedir("GET", "/api/gestao/alunos?status=pendente", { cookie: A })).j.alunos;
    const apagar = await pedir("DELETE", `/api/gestao/alunos/${pendentes[0].id}`, { cookie: A });
    certo("pré-matrícula repetida pode ser apagada", apagar.status === 200);
    const apagouPre = (await pedir("GET", "/api/gestao/auditoria?q=Apagou", { cookie: A })).j.itens.find((l) => l.acao === "Apagou pré-matrícula");
    certo("apagar uma pré-matrícula não deixa o nome dela na auditoria",
      apagouPre && apagouPre.alvo === `pré-matrícula nº ${pendentes[0].id}` && !/Zz Qa/.test(apagouPre.alvo), JSON.stringify(apagouPre));
  } catch (e) {
    falhas.push("a suíte quebrou: " + e.message);
    console.log("  QUEBROU:", e.stack);
    console.log(log.split("\n").slice(-20).join("\n"));
  } finally {
    servidor.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n  ${ok} passaram, ${falhas.length} falharam`);
  if (falhas.length) { for (const f of falhas) console.log("   ✖ " + f); process.exitCode = 1; }
})();
