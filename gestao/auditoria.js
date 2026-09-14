/* ==========================================================================
   gestao/auditoria.js — quem fez o quê, e quando

   O registro nasce no SERVIDOR, num gancho que olha toda requisição que muda
   alguma coisa — e não numa linha escrita rota por rota. Uma lista de "lugares
   que registram" esquece a rota escrita amanhã; o gancho não esquece: rota
   nova sem descrição aparece como "POST /api/…", feia mas presente.

   A tabela é SÓ DE ACRÉSCIMO: o banco recusa alterar ou apagar uma linha
   (gatilhos em gestao/esquema.js). Uma auditoria que o próprio auditado pode
   editar não prova nada.

   O que NÃO entra:
   · leitura comum (listas, telas) — viraria milhares de linhas por dia e
     esconderia o que importa. Só entram as IMPRESSÕES (ficha, contrato,
     relatório), que é dado pessoal saindo do sistema em papel;
   · o IP de quem envia a matrícula pelo site — a política de privacidade
     promete que ele não é guardado. O IP da EQUIPE entra: é o que responde
     "foi daqui mesmo que entraram com a senha da Maria?".
   ========================================================================== */
"use strict";

const U = require("./util");

/* [método, rota, descrição]. A descrição é o que a tela mostra; `$1` vira o
   primeiro grupo da rota. Rotas da gestão sem o prefixo /api/gestao. */
const NOMES_LISTA = { services: "Modalidades", portfolio: "Estrutura (fotos)", testimonials: "Depoimentos",
  team: "Equipe", posts: "Blog" };
const ACOES = [
  ["POST", /^\/api\/logout$/, "Saiu do sistema"],
  ["POST", /^\/api\/password$/, "Trocou a própria senha"],
  ["POST", /^\/api\/manutencao$/, "Mexeu no modo manutenção"],
  ["PUT", /^\/api\/settings$/, "Editou textos do site"],
  ["POST", /^\/api\/(services|portfolio|testimonials|team|posts)$/, "Criou item — $1"],
  ["PUT", /^\/api\/(services|portfolio|testimonials|team|posts)\/\d+$/, "Editou item — $1"],
  ["DELETE", /^\/api\/(services|portfolio|testimonials|team|posts)\/\d+$/, "Apagou item — $1"],
  ["POST", /^\/api\/upload-video$/, "Enviou vídeo para o site"],
  ["POST", /^\/api\/upload$/, "Enviou imagem para o site"],
  ["POST", /^\/api\/publish$/, "Publicou o site"],

  ["POST", /^\/alunos$/, "Cadastrou aluno"],
  ["PUT", /^\/alunos\/\d+$/, "Editou cadastro de aluno"],
  ["DELETE", /^\/alunos\/\d+$/, "Apagou pré-matrícula"],
  ["POST", /^\/alunos\/\d+\/efetivar$/, "Efetivou matrícula"],
  ["POST", /^\/alunos\/\d+\/foto$/, "Enviou foto do aluno"],
  ["DELETE", /^\/alunos\/\d+\/foto$/, "Removeu foto do aluno"],
  ["POST", /^\/alunos\/\d+\/contratos$/, "Gerou contrato"],
  ["PUT", /^\/contratos\/\d+\/assinatura$/, "Mudou a situação de assinatura do contrato"],
  ["POST", /^\/contrato\/modelo$/, "Salvou nova versão do modelo de contrato"],
  ["POST", /^\/contrato\/assinatura$/, "Enviou a imagem das assinaturas"],
  ["DELETE", /^\/contrato\/assinatura$/, "Removeu a imagem das assinaturas"],
  ["POST", /^\/atividades$/, "Cadastrou atividade"],
  ["PUT", /^\/atividades\/\d+$/, "Editou atividade"],
  ["DELETE", /^\/atividades\/\d+$/, "Apagou atividade"],
  ["POST", /^\/professores$/, "Cadastrou professor"],
  ["PUT", /^\/professores\/\d+$/, "Editou professor"],
  ["DELETE", /^\/professores\/\d+$/, "Apagou professor"],
  ["POST", /^\/turmas$/, "Cadastrou turma"],
  ["PUT", /^\/turmas\/\d+$/, "Editou turma"],
  ["DELETE", /^\/turmas\/\d+$/, "Apagou turma"],
  ["PUT", /^\/config$/, "Alterou configurações"],
  ["POST", /^\/feriados$/, "Cadastrou data no calendário"],
  ["PUT", /^\/feriados\/\d+$/, "Editou data do calendário"],
  ["DELETE", /^\/feriados\/\d+$/, "Apagou data do calendário"],
  ["POST", /^\/usuarios$/, "Criou usuário"],
  ["PUT", /^\/usuarios\/\d+$/, "Editou usuário"],
  ["POST", /^\/usuarios\/\d+\/senha$/, "Redefiniu a senha de um usuário"],

  ["GET", /^\/admin\/imprimir\/ficha\/\d+$/, "Imprimiu a ficha do aluno"],
  ["GET", /^\/admin\/imprimir\/contrato\/\d+$/, "Abriu um contrato para imprimir"],
  ["GET", /^\/admin\/imprimir\/relatorio\/(\w+)$/, "Gerou relatório — $1"],
  ["GET", /^\/admin\/imprimir\/agenda$/, "Imprimiu a agenda"],
];

/* POST que não muda nada: a pré-visualização do contrato. Registrar seria
   ruído — a cada tecla de "ver como fica" uma linha nova. */
const IGNORAR = [/^\/api\/gestao\/contrato\/previa$/];

function descrever(metodo, caminho) {
  const rota = caminho.startsWith("/api/gestao/") ? caminho.slice("/api/gestao".length) : caminho;
  for (const [m, re, texto] of ACOES) {
    if (m !== metodo) continue;
    const r = re.exec(rota);
    if (r) return texto.replace("$1", NOMES_LISTA[r[1]] || r[1] || "");
  }
  return `${metodo} ${caminho}`;
}

function criarAuditoria(db) {
  const inserir = db.prepare(`INSERT INTO g_auditoria(em, usuario_id, usuario, acao, alvo, metodo, rota, status, ip)
    VALUES(?,?,?,?,?,?,?,?,?)`);

  /* Nunca derruba a requisição: se gravar a auditoria falhar (disco cheio,
     banco travado), o que a pessoa fez já aconteceu — perder a resposta por
     causa do registro seria o pior dos dois mundos. Vai para o log. */
  function registrar({ usuario, acao, alvo = "", metodo = "", rota = "", status = 200, ip = "" }) {
    try {
      inserir.run(new Date().toISOString(), usuario?.id ?? null,
        usuario ? (usuario.nome ? `${usuario.nome} (${usuario.login})` : String(usuario.login || usuario)) : "",
        String(acao).slice(0, 200), String(alvo || "").slice(0, 200), metodo, String(rota).slice(0, 200),
        Number(status) || 0, String(ip || "").slice(0, 64));
    } catch (e) { console.error("  ✖ auditoria:", e.message); }
  }

  /* Acompanha a requisição até o fim e grava com o status que ela teve de
     fato — 200, 403, 409. Um "tentou e foi recusado" também é informação. */
  function acompanhar(req, res, caminho, usuario, ip) {
    if (IGNORAR.some((re) => re.test(caminho))) return;
    res.on("finish", () => registrar({
      usuario, acao: descrever(req.method, caminho), alvo: res.auditoria?.alvo || "",
      metodo: req.method, rota: caminho, status: res.statusCode, ip,
    }));
  }

  /* Lista da mais nova para a mais velha, em páginas: `antes` é o id da
     última linha já mostrada. Filtros de período em datas do Recife. */
  function listar({ usuario_id, de, ate, q, antes, limite = 100, pagina, por }) {
    const onde = [], args = [];
    if (usuario_id) { onde.push("usuario_id=?"); args.push(Number(usuario_id)); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(de || "")) { onde.push("em>=?"); args.push(new Date(`${de}T00:00:00-03:00`).toISOString()); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(ate || "")) { onde.push("em<?"); args.push(new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86400000).toISOString()); }
    if (q) { onde.push("(acao LIKE ? OR alvo LIKE ? OR usuario LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    /* Com `pagina`: páginas numeradas, com o total (é o que a tela usa).
       Sem ela: o cursor `antes` (a última linha já vista) e o teto `limite`. */
    if (pagina) {
      const where = onde.length ? "WHERE " + onde.join(" AND ") : "";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM g_auditoria ${where}`).get(...args).n;
      const tam = Math.min(Math.max(Number(por) || 20, 1), 200);
      const pag = Math.max(1, Math.min(Number(pagina) || 1, Math.max(1, Math.ceil(total / tam))));
      const itens = db.prepare(`SELECT * FROM g_auditoria ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, tam, (pag - 1) * tam);
      return { itens: itens.map((l) => ({ ...l, em_txt: U.dataHoraBR(l.em) })), total, pagina: pag, por: tam };
    }
    if (Number(antes) > 0) { onde.push("id<?"); args.push(Number(antes)); }
    const n = Math.min(Math.max(Number(limite) || 100, 1), 500);
    const linhas = db.prepare(`SELECT * FROM g_auditoria ${onde.length ? "WHERE " + onde.join(" AND ") : ""}
      ORDER BY id DESC LIMIT ?`).all(...args, n + 1);
    const mais = linhas.length > n;
    return { itens: linhas.slice(0, n).map((l) => ({ ...l, em_txt: U.dataHoraBR(l.em) })), mais };
  }

  return { registrar, acompanhar, listar, descrever };
}

module.exports = { criarAuditoria, descrever };
