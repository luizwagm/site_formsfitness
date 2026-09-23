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
/* ==========================================================================
   OS ARQUIVOS DA MATRÍCULA, DE MENTIRA (1.27.0)
   O servidor decide o tipo pela ASSINATURA dos bytes, então a prova não pode
   mandar "uma string qualquer" e dizer que é JPEG: monta o cabeçalho de
   verdade. São os mesmos bytes que um arquivo real começa.
   ========================================================================== */
const b64 = (buf) => buf.toString("base64");
const JPEG = (enchimento = 64) =>
  "data:image/jpeg;base64," + b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(enchimento, 7)]));
const PNG = () => "data:image/png;base64," +
  b64(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]));
const PDF = (enchimento = 64) =>
  "data:application/pdf;base64," + b64(Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(enchimento, 32)]));
/* Um HTML com nome de imagem: é o ataque que a conferência por bytes pega. */
const FALSO = "data:image/jpeg;base64," + b64(Buffer.from("<html><script>alert(1)</script>"));

const PUB_MENOR = (extra = {}) => ({
  nome: "Zz Qa Criança Teste", nascimento: "2019-05-03", sexo: "Masculino", mae: "Zz Qa Mãe",
  fone1: "(81) 99999-0000", logradouro: "Avenida Caruaru", numero: "579", bairro: "Maria Auxiliadora",
  cidade: "Caruaru", uf: "PE", cep: "55038-270",
  resp_nome: "Zz Qa Responsável", resp_cpf: "529.982.247-25", resp_rg: "9172964", resp_fone: "(81) 99999-0001",
  aceite_termos: true, aceite_dados: true,
  foto: JPEG(), comprovante: PDF(), ...extra,
});

/* ==========================================================================
   OS SERVIÇOS DE CEP, DE MENTIRA (1.26.0)
   A suíte não sai na internet: numa rede sem saída ela ficaria pendurada e o
   defeito pareceria do código. Este servidor responde no formato do ViaCEP
   (/via/...) e da BrasilAPI (/brasil/...), com um caso para cada caminho.
   ========================================================================== */
const PORTA_CEP = PORTA + 7;
const pedidosCep = [];
const servidorCep = require("node:http").createServer((req, res) => {
  pedidosCep.push(req.url);
  const via = /^\/via\/ws\/(\d{8})\/json\/$/.exec(req.url);
  const bra = /^\/brasil\/api\/cep\/v1\/(\d{8})$/.exec(req.url);
  const cep = (via || bra || [])[1];
  const manda = (st, obj) => { res.writeHead(st, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (via) {
    if (cep === "55038270") return manda(200, { cep: "55038-270", logradouro: "Avenida Caruaru", bairro: "Maria Auxiliadora", localidade: "Caruaru", uf: "PE" });
    if (cep === "55120000") return manda(200, { cep: "55120-000", logradouro: "", bairro: "", localidade: "Riacho das Almas", uf: "PE" });
    if (cep === "55038999") return manda(200, { logradouro: "<img src=x onerror=alert(1)>Rua Zz", bairro: "Zz", localidade: "Caruaru", uf: "PE" });
    if (cep === "55555555" || cep === "56666666") return manda(500, {});
    return manda(200, { erro: true });
  }
  if (bra) {
    if (cep === "55555555") return manda(200, { cep, street: "Rua Zz da Reserva", neighborhood: "Centro", city: "Caruaru", state: "PE" });
    if (cep === "56666666") return manda(503, {});
    return manda(404, { message: "CEP não encontrado" });
  }
  manda(404, {});
});

/* ==========================================================================
   O SICREDI, DE MENTIRA (1.26.0)

   Confere o que o manual exige (chave, contexto, token, cooperativa e posto)
   e devolve boletos com código de barras VÁLIDO — montado aqui com a mesma
   conta do banco, para a conferência do carnê ter o que conferir.

   As alavancas (`SB.perderProxima`, `SB.colidirProxima`, `SB.recusarProxima`,
   `SB.invalidarToken`) simulam os acidentes que causariam cobrança dobrada
   ou carnê errado.
   ========================================================================== */
const Bol = require("./gestao/boleto");
const PORTA_SB = PORTA + 8;
const SB = { tokens: 0, registros: [], boletos: new Map(), baixas: [], pdfs: 0, chamadas401: 0,
  perderProxima: false, colidirProxima: false, recusarProxima: false, tokenValido: "" };
function codigoBarrasFalso(nosso, valorCentavos) {
  const livre = ("11" + nosso + "678903123451").padEnd(25, "0").slice(0, 25);
  const semDv = "7489" + "1234" + String(valorCentavos).padStart(10, "0") + livre;
  for (let dv = 1; dv <= 9; dv++) {
    const c = semDv.slice(0, 4) + dv + semDv.slice(4);
    if (Bol.codigoBarrasValido(c)) return c;
  }
  throw new Error("sem DV");
}
const servidorSB = require("node:http").createServer((req, res) => {
  let bruto = "";
  req.on("data", (d) => (bruto += d));
  req.on("end", () => {
    const manda = (st, obj, tipo = "application/json") => {
      res.writeHead(st, { "Content-Type": tipo });
      res.end(tipo === "application/json" ? JSON.stringify(obj) : obj);
    };
    const url = new URL(req.url, "http://x");
    if (req.headers["x-api-key"] !== "chave-de-teste") return manda(401, { message: "Could not find a required Access Token" });
    if (url.pathname === "/auth/openapi/token") {
      const f = new URLSearchParams(bruto);
      if (req.headers.context !== "COBRANCA") return manda(401, { error: "sem contexto" });
      if (f.get("grant_type") !== "password" || f.get("username") !== "123450512" || f.get("password") !== "codigo-de-teste"
        || f.get("scope") !== "cobranca") return manda(401, { error_description: "Invalid user credentials" });
      SB.tokens++;
      SB.tokenValido = `tok-${SB.tokens}`;
      return manda(200, { access_token: SB.tokenValido, expires_in: 300, refresh_token: "ref", refresh_expires_in: 1800, token_type: "Bearer" });
    }
    if (req.headers.authorization !== `Bearer ${SB.tokenValido}`) { SB.chamadas401++; return manda(401, { message: "UNAUTHORIZED" }); }
    if (req.headers.cooperativa !== "0512" || req.headers.posto !== "03") return manda(401, { message: "Cooperativa diferente" });

    if (url.pathname === "/cobranca/boleto/v1/boletos" && req.method === "POST") {
      const b = JSON.parse(bruto);
      SB.registros.push(b);
      if (SB.recusarProxima) { SB.recusarProxima = false; return manda(400, { message: "CEP do pagador invalido" }); }
      if (SB.colidirProxima) {
        SB.colidirProxima = false;
        SB.boletos.set(b.nossoNumero, { seuNumero: "OUTRO", valorNominal: 999, situacao: "EM CARTEIRA", nossoNumero: b.nossoNumero });
        return manda(422, { message: "Nosso numero ja cadastrado" });
      }
      if (SB.boletos.has(b.nossoNumero)) return manda(422, { message: "Nosso numero ja cadastrado" });
      const codigoBarras = codigoBarrasFalso(b.nossoNumero, Math.round(b.valor * 100));
      const salvo = { ...b, valorNominal: b.valor, situacao: "EM CARTEIRA PIX", codigoBarras,
        linhaDigitavel: Bol.linhaDoCodigo(codigoBarras), txId: "tx" + b.nossoNumero,
        codigoQrCode: `00020101021226930014br.gov.bcb.pix2571pix-qrcode-h.sicredi.com.br/qr/v2/cobv/${b.nossoNumero}5204000053039865802BR6304ABCD` };
      SB.boletos.set(b.nossoNumero, salvo);
      if (SB.perderProxima) { SB.perderProxima = false; return req.socket.destroy(); }   /* registrou e a resposta se perdeu */
      return manda(201, { txid: salvo.txId, qrCode: salvo.codigoQrCode, linhaDigitavel: salvo.linhaDigitavel,
        codigoBarras, cooperativa: "0512", posto: "03", nossoNumero: b.nossoNumero });
    }
    if (url.pathname === "/cobranca/boleto/v1/boletos" && req.method === "GET") {
      if (url.searchParams.get("codigoBeneficiario") !== "12345") return manda(401, { message: "beneficiario diferente" });
      const b = SB.boletos.get(url.searchParams.get("nossoNumero"));
      return b ? manda(200, b) : manda(404, { message: "Titulo nao encontrado" });
    }
    let m;
    if ((m = /^\/cobranca\/boleto\/v1\/boletos\/(\d{9})\/baixa$/.exec(url.pathname)) && req.method === "PATCH") {
      const b = SB.boletos.get(m[1]);
      if (!b) return manda(400, { message: "Titulo nao encontrado" });
      SB.baixas.push(m[1]); b.situacao = "BAIXADO POR SOLICITACAO";
      return manda(202, { statusComando: "MOVIMENTO_ENVIADO", tipoMensagem: "BAIXA", nossoNumero: m[1] });
    }
    if (url.pathname === "/cobranca/boleto/v1/boletos/pdf") { SB.pdfs++; return manda(200, "%PDF-1.4 boleto de teste", "application/pdf"); }
    manda(404, { message: "rota" });
  });
});

(async () => {
  await new Promise((r) => servidorCep.listen(PORTA_CEP, "127.0.0.1", r));
  await new Promise((r) => servidorSB.listen(PORTA_SB, "127.0.0.1", r));
  /* As credenciais vão num .env de mentira, lido pelo servidor como o de
     verdade — é o que prova o carregador do .env. */
  const ENV = path.join(TMP, "servidor.env");
  fs.writeFileSync(ENV, [
    "# .env de prova",
    "SICREDI_AMBIENTE=producao",
    "SICREDI_API_KEY=chave-de-teste",
    'SICREDI_CODIGO_ACESSO="codigo-de-teste"',
    "SICREDI_COOPERATIVA=0512",
    "SICREDI_POSTO=03",
    "SICREDI_BENEFICIARIO=12345",
    `SICREDI_BASE_URL=http://127.0.0.1:${PORTA_SB}`,
  ].join("\n"));
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000",
      FF_CEP_BASES: `http://127.0.0.1:${PORTA_CEP}/via,http://127.0.0.1:${PORTA_CEP}/brasil`,
      FF_ENV: ENV,
      /* Nenhuma credencial de verdade da máquina entra na prova. */
      SICREDI_AMBIENTE: undefined, SICREDI_API_KEY: undefined, SICREDI_CODIGO_ACESSO: undefined,
      SICREDI_COOPERATIVA: undefined, SICREDI_POSTO: undefined, SICREDI_BENEFICIARIO: undefined, SICREDI_BASE_URL: undefined },
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
    certo("o primeiro código é 4149", res0.j.proximo_codigo === 4149, String(res0.j.proximo_codigo));
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
    /* ------------------------------------------- foto e comprovante (1.27.0) */
    const semFoto = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, foto: "" }) });
    certo("sem a foto do aluno, a matrícula é recusada", semFoto.status === 400 && /foto/i.test(semFoto.j.error), JSON.stringify(semFoto.j));
    const semComp = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, comprovante: "" }) });
    certo("sem o comprovante, a matrícula é recusada", semComp.status === 400 && /comprovante/i.test(semComp.j.error), JSON.stringify(semComp.j));
    const fotoDisfarcada = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, foto: FALSO }) });
    certo("HTML com nome de imagem NÃO passa por foto (conferência por bytes)", fotoDisfarcada.status === 400, JSON.stringify(fotoDisfarcada.j));
    const fotoPdf = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, foto: PDF() }) });
    certo("PDF não serve de FOTO do aluno (só o comprovante aceita PDF)", fotoPdf.status === 400, JSON.stringify(fotoPdf.j));
    const compFalso = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, comprovante: FALSO }) });
    certo("arquivo que não é imagem nem PDF não passa por comprovante", compFalso.status === 400, JSON.stringify(compFalso.j));
    const fotoGorda = await pedir("POST", "/api/publico/matricula", { corpo: PUB_MENOR({ turma_id: t1.j.id, foto: JPEG(3 * 1024 * 1024) }) });
    certo("foto acima do teto é recusada com 413", fotoGorda.status === 413, String(fotoGorda.status));
    /* O antes/depois é o que prova que a recusa não deixou cadastro pela
       metade: sete tentativas ruins e nenhum aluno novo. */
    const aposRecusas = (await pedir("GET", "/api/gestao/alunos?status=pendente", { cookie: A })).j.alunos.length;
    certo("nenhuma dessas recusas gravou pré-matrícula", aposRecusas === 0, String(aposRecusas));

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
    certo("a foto e o comprovante ficaram guardados no cadastro",
      !!pCompleto.foto_id && !!pCompleto.comprovante_id && pCompleto.comprovante_pdf === true,
      `foto ${pCompleto.foto_id} · comp ${pCompleto.comprovante_id}`);
    const verFoto = await pedir("GET", `/admin/arquivo/${pCompleto.foto_id}`, { cookie: A });
    certo("a foto da matrícula é servida ao painel como imagem, dentro da página",
      verFoto.status === 200 && String(verFoto.cab.get("content-type")).startsWith("image/")
      && /inline/.test(verFoto.cab.get("content-disposition") || ""),
      `${verFoto.status} ${verFoto.cab.get("content-type")}`);
    /* PDF é formato com script. Aberto "inline" ele rodaria dentro da nossa
       origem; como anexo, vai para o leitor do sistema. */
    const verComp = await pedir("GET", `/admin/arquivo/${pCompleto.comprovante_id}`, { cookie: A });
    certo("o comprovante em PDF desce como ANEXO, e não aberto na nossa origem",
      verComp.status === 200 && verComp.cab.get("content-type") === "application/pdf"
      && /attachment/.test(verComp.cab.get("content-disposition") || "")
      && verComp.cab.get("x-content-type-options") === "nosniff",
      `${verComp.cab.get("content-type")} ${verComp.cab.get("content-disposition")}`);

    certo("a turma do site vira matrícula com os dias da academia e a mensalidade da atividade",
      JSON.stringify(pCompleto.matriculas[0].dias) === "[2,3,5]" && pCompleto.matriculas[0].mensalidade === 11000 && pCompleto.mensalidade === 11000,
      JSON.stringify(pCompleto.matriculas[0]));

    console.log("\n— efetivação e código");
    const ctrPend = await pedir("POST", `/api/gestao/alunos/${pId}/contratos`, { cookie: A });
    certo("pré-matrícula NÃO gera contrato (não tem código)", ctrPend.status === 409);
    const ef = await pedir("POST", `/api/gestao/alunos/${pId}/efetivar`, { cookie: A, corpo: {} });
    certo("efetivar dá o código 4149", ef.status === 200 && ef.j.codigo === 4149 && ef.j.codigo_fmt === "004149");
    const ef2 = await pedir("POST", `/api/gestao/alunos/${pId}/efetivar`, { cookie: A, corpo: {} });
    certo("efetivar duas vezes é recusado", ef2.status === 409);
    const antigo = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Aluno Antigo", codigo: "003879", nascimento: "1990-02-10", turma_id: t1.j.id, mensalidade: "110,00" } });
    certo("aluno antigo entra com o código dele (3879)", antigo.status === 200 && antigo.j.codigo === 3879);
    const novo = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Adulto Novo", nascimento: "1985-09-11", cpf: "529.982.247-25", turma_id: t1.j.id, mensalidade: "110,00" } });
    certo("o código antigo NÃO puxa a sequência para trás: o próximo é 4150", novo.j.codigo === 4150, String(novo.j.codigo));
    const dup = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: { nome: "Zz Qa Duplicado", codigo: "4150" } });
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
    certo("menor: quem assina é o RESPONSÁVEL", /CONTRATANTE:<\/b> Zz Qa Responsável - 004149/.test(h1));
    certo("menor: sai o parágrafo do aluno menor de idade", /por nome de <b>Zz Qa Criança Teste<\/b>/.test(h1));
    certo("mensalidade por extenso", /R\$ 110,00 \(CENTO E DEZ REAIS\)/.test(h1));
    certo("dias de aula vêm da configuração", /nos dias de terças, quartas e sextas/.test(h1));
    certo("horário vem da turma", /das 10:00h/.test(h1));
    certo("nenhum marcador sobra no papel", !/\{\{/.test(h1));
    /* Rodapé (1.25.0): no lugar do endereço do Word, o contato de hoje. */
    certo("o contrato sai com o rodapé de site, e-mail, Instagram e WhatsApp",
      /class="rodape-contrato"/.test(h1) && /Site: formsfitness\.com/.test(h1) && /WhatsApp: /.test(h1) && !/Silvino/.test(h1),
      (h1.match(/<p class="rodape-contrato">[^<]*<\/p>/) || ["sem rodapé"])[0]);
    const emailRuim = await pedir("PUT", "/api/gestao/config", { cookie: A, corpo: { email_admin: "sem-arroba" } });
    certo("e-mail administrativo inválido é recusado", emailRuim.status === 400);
    await pedir("PUT", "/api/gestao/config", { cookie: A, corpo: { email_admin: "zzqa.admin@formsfitness.com" } });
    const cfgRod = (await pedir("GET", "/api/gestao/config", { cookie: A })).j;
    certo("o e-mail administrativo entra no rodapé", cfgRod.email_admin === "zzqa.admin@formsfitness.com"
      && cfgRod.rodape.includes("E-mail: zzqa.admin@formsfitness.com"), JSON.stringify(cfgRod.rodape));
    const textosIniciais = fs.readFileSync(path.join(__dirname, "gestao", "textos-iniciais.js"), "utf8");
    /* O repositório é PÚBLICO: a primeira transcrição do contrato levou para
       lá o RG, o CPF e o endereço do diretor. */
    certo("o modelo semente não tem CPF nem RG de ninguém (o repositório é público)",
      !/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(textosIniciais) && !/Identidade nº\s*\d/.test(textosIniciais));
    const c2adulto = await pedir("POST", `/api/gestao/alunos/${novo.j.id}/contratos`, { cookie: A });
    const h2 = (await pedir("GET", `/admin/imprimir/contrato/${c2adulto.j.id}`, { cookie: A })).texto;
    certo("adulto: assina ele mesmo, e o parágrafo do menor NÃO sai",
      /CONTRATANTE:<\/b> Zz Qa Adulto Novo - 004150/.test(h2) && !/menor de idade: a contratante/.test(h2));

    /* Assinaturas da contratada (1.25.1). Sem imagem: três linhas em branco. */
    certo("sem imagem de assinaturas: local/data ao lado do aluno e três linhas em branco",
      /class="ass-linha1"/.test(h2) && (h2.match(/<span class="traco"><\/span>/g) || []).length === 3 && !/<img class="ass-img"/.test(h2),
      (h2.match(/<div class="assinaturas[\s\S]{0,600}/) || ["sem bloco"])[0]);
    /* PNG 1×1 TRANSPARENTE (tipo de cor 6, com alfa). */
    const pngAlfa = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const envAss = await pedir("POST", "/api/gestao/contrato/assinatura", { cookie: A, corpo: { dataUrl: "data:image/png;base64," + pngAlfa } });
    certo("envia a imagem das assinaturas da contratada", envAss.status === 200 && envAss.j.assinatura_id > 0, envAss.texto);
    const arqAss = await fetch(`${BASE}/admin/arquivo/${envAss.j.assinatura_id}`, { headers: { Cookie: A } });
    const bytesAss = Buffer.from(await arqAss.arrayBuffer());
    certo("a imagem volta como PNG, byte a byte — a transparência não se perde no servidor",
      arqAss.headers.get("content-type") === "image/png" && bytesAss.equals(Buffer.from(pngAlfa, "base64")));
    const cAss = await pedir("POST", `/api/gestao/alunos/${novo.j.id}/contratos`, { cookie: A });
    const hAss = (await pedir("GET", `/admin/imprimir/contrato/${cAss.j.id}`, { cookie: A })).texto;
    const blocoAss = (hAss.match(/<div class="assinaturas ass-lado">[\s\S]*?<\/div>\s*<\/div>/) || [""])[0];
    certo("com imagem: aluno à esquerda; à direita o local/data e, LOGO ABAIXO, a imagem",
      /class="ass-contratante"[\s\S]*class="ass-contratada">\s*<p class="local-data">Caruaru \(PE\),[\s\S]*<img class="ass-img" src="\/admin\/arquivo\/\d+"/.test(blocoAss)
      && !/ass-linha1|traco/.test(blocoAss), blocoAss.slice(0, 300) || "sem .ass-lado");
    /* O envio do painel passava a assinatura pelo redutor das FOTOS, que grava
       JPEG — e JPEG não tem transparência: o fundo virava um retângulo preto. */
    const painelJs = fs.readFileSync(path.join(__dirname, "admin", "gestao.js"), "utf8");
    certo("o painel envia a assinatura em PNG, sem passar pelo JPEG das fotos",
      /reduzirImagem\(arq, \d+, [\d.]+, \{ semPapel: true \}\)/.test(painelJs)
      && /if \(!semPapel\) return ok\(c\.toDataURL\("image\/jpeg"/.test(painelJs) && /ok\(c\.toDataURL\("image\/png"\)\)/.test(painelJs));
    /* O CSS é aplicado na hora de imprimir, o HTML do contrato é congelado:
       as classes das versões anteriores continuam valendo. */
    const cssContrato = fs.readFileSync(path.join(__dirname, "gestao", "documentos.js"), "utf8");
    certo("o CSS do contrato ainda veste as marcações antigas (.traco, .ass-linha1) e a nova (.ass-lado)",
      /\.ass-contratante \.traco\{/.test(cssContrato) && /\.ass-linha1\{/.test(cssContrato) && /\.ass-lado \.ass-img\{height:35mm/.test(cssContrato));
    await pedir("DELETE", "/api/gestao/contrato/assinatura", { cookie: A });

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

    /* ------------------------------------------- comprovante no painel (1.27.0)
       A secretaria precisa TROCAR (veio o print errado) e REMOVER (já conferiu).
       Trocar não pode deixar o arquivo velho no banco: seria o extrato de
       alguém guardado para sempre sem ninguém saber. */
    const compRuim = await pedir("POST", `/api/gestao/alunos/${pId}/comprovante`, { cookie: A, corpo: { dataUrl: `data:application/pdf;base64,${html}` } });
    certo("HTML disfarçado de PDF é recusado pelo conteúdo", compRuim.status === 400, JSON.stringify(compRuim.j));
    const compPng = await pedir("POST", `/api/gestao/alunos/${pId}/comprovante`, { cookie: A, corpo: { dataUrl: `data:image/png;base64,${png}` } });
    certo("comprovante em imagem é aceito pelo painel", compPng.status === 200 && compPng.j.comprovante_id && compPng.j.pdf === false);
    const compPdf = await pedir("POST", `/api/gestao/alunos/${pId}/comprovante`, { cookie: A, corpo: { dataUrl: PDF() } });
    certo("trocar por um PDF funciona, e a tela é avisada de que é PDF", compPdf.status === 200 && compPdf.j.pdf === true);
    const sobrou = await pedir("GET", `/admin/arquivo/${compPng.j.comprovante_id}`, { cookie: A });
    certo("o comprovante trocado SAI do banco (não fica sobrando)", sobrou.status === 404, String(sobrou.status));
    const semComprov = await pedir("DELETE", `/api/gestao/alunos/${pId}/comprovante`, { cookie: A });
    const depoisDeTirar = (await pedir("GET", `/api/gestao/alunos/${pId}`, { cookie: A })).j.aluno;
    certo("remover o comprovante limpa o cadastro e apaga o arquivo",
      semComprov.status === 200 && !depoisDeTirar.comprovante_id
      && (await pedir("GET", `/admin/arquivo/${compPdf.j.comprovante_id}`, { cookie: A })).status === 404);

    console.log("\n— impressos");
    const ficha = await pedir("GET", `/admin/imprimir/ficha/${pId}`, { cookie: A });
    certo("a ficha abre com o nome, o código e as condições",
      ficha.status === 200 && /Zz Qa Criança Teste/.test(ficha.texto) && /004149/.test(ficha.texto) && /CONDIÇÕES DA MATRÍCULA/.test(ficha.texto));
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

    /* Comando de linha NÃO escreve no banco (1.24.1). A entrega roda
       `--publicar` e `--backup` como o usuário `deploy`, que no servidor só
       LÊ o banco do serviço. Com a instalação da gestão no começo do
       server.js, a primeira atualização para a 1.20 morreu no --publicar.
       Aqui: um banco sem a gestão, somente-leitura, e o comando tem de passar
       sem criar tabela nenhuma. */
    {
      const { spawnSync } = require("node:child_process");
      const dirRo = path.join(TMP, "somente-leitura");
      fs.mkdirSync(dirRo, { recursive: true });
      const arq = path.join(dirRo, "site.db");
      let origem;
      try { origem = new (require("better-sqlite3"))(path.join(TMP, "data", "site.db"), { readonly: true }); }
      catch { const { DatabaseSync } = require("node:sqlite"); origem = new DatabaseSync(path.join(TMP, "data", "site.db"), { readOnly: true }); }
      origem.exec(`VACUUM INTO '${arq.replace(/'/g, "''")}'`);
      origem.close();
      let antigo;
      try { antigo = new (require("better-sqlite3"))(arq); }
      catch { const { DatabaseSync } = require("node:sqlite"); antigo = new DatabaseSync(arq); }
      antigo.exec("PRAGMA foreign_keys=OFF");
      const gestaoTabelas = antigo.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'g!_%' ESCAPE '!' OR name='usuarios')").all();
      for (const t of gestaoTabelas) antigo.exec(`DROP TABLE "${t.name}"`);
      antigo.prepare("DELETE FROM settings WHERE key LIKE 'g!_%' ESCAPE '!'").run();
      antigo.exec("PRAGMA journal_mode=DELETE");
      antigo.close();
      fs.chmodSync(arq, 0o444);
      const r = spawnSync(process.execPath, ["server.js", "--backup-status"], { cwd: __dirname, encoding: "utf8",
        env: { ...process.env, FF_DATA: dirRo, FF_BACKUPS: path.join(TMP, "bk-ro") } });
      let conf;
      try { conf = new (require("better-sqlite3"))(arq, { readonly: true }); }
      catch { const { DatabaseSync } = require("node:sqlite"); conf = new DatabaseSync(arq, { readOnly: true }); }
      const criou = !!conf.prepare("SELECT 1 AS s FROM sqlite_master WHERE name='g_alunos'").get();
      conf.close();
      fs.chmodSync(arq, 0o644);
      certo("comando de linha passa com o banco SOMENTE-LEITURA e sem a gestão (como o usuário deploy o vê)",
        r.status === 0, `código ${r.status}: ${(r.stderr || "").split("\n").slice(0, 3).join(" | ")}`);
      certo("…e não cria tabela nenhuma: quem instala a gestão é o serviço", !criou);
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
      acha((l) => l.acao === "Efetivou matrícula" && /Criança Teste \(004149\)/.test(l.alvo)));
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

    console.log("\n— CEP preenche o endereço (1.26.0)");
    {
      const cep = (c, cookie = A) => pedir("GET", `/api/gestao/cep/${c}`, { cookie });
      const cheio = await cep("55038-270");
      certo("CEP completo devolve rua, bairro, cidade e UF", cheio.status === 200
        && cheio.j.logradouro === "Avenida Caruaru" && cheio.j.bairro === "Maria Auxiliadora"
        && cheio.j.cidade === "Caruaru" && cheio.j.uf === "PE", JSON.stringify(cheio.j));
      const antes = pedidosCep.length;
      await cep("55038270");
      certo("a mesma consulta de novo não sai do servidor (guardada)", pedidosCep.length === antes);
      const cidade = await cep("55120000");
      certo("CEP de cidade inteira devolve cidade e UF, com rua vazia", cidade.status === 200
        && cidade.j.cidade === "Riacho das Almas" && cidade.j.logradouro === "", JSON.stringify(cidade.j));
      const reserva = await cep("55555555");
      certo("com o ViaCEP fora do ar, a BrasilAPI responde", reserva.status === 200 && reserva.j.logradouro === "Rua Zz da Reserva");
      const nenhum = await cep("01001999");
      certo("CEP que nenhum serviço conhece é 404 (e pergunta aos DOIS)", nenhum.status === 404
        && pedidosCep.some((u) => u.includes("/brasil/api/cep/v1/01001999")));
      const fora = await cep("56666666");
      certo("os dois fora do ar é 503, com recado para digitar à mão", fora.status === 503 && /à mão/.test(fora.j.error || ""));
      const sujo = await cep("55038999");
      certo("marcação vinda do serviço não chega à tela", sujo.status === 200 && !/[<>]/.test(JSON.stringify(sujo.j)));
      certo("sem login, a consulta de CEP é 401 (não é repasse aberto)", (await pedir("GET", "/api/gestao/cep/55038270")).status === 401);
      certo("CEP malformado não vira consulta", (await cep("5503")).status === 404 && !pedidosCep.some((u) => u.includes("/5503/")));

      /* ------------------------------------------ o CEP do site (1.28.0)
         O formulário de matrícula é aberto, então esta porta também é. O que
         a segura é um freio por endereço — e o cache, que atende a repetição
         sem sair para a internet. */
      const cepSite = (c) => pedir("GET", `/api/publico/cep/${c}`);
      const doSite = await cepSite("55038-270");
      certo("o site consulta CEP SEM login", doSite.status === 200 && doSite.j.cidade === "Caruaru", JSON.stringify(doSite.j));
      const torto = await cepSite("123");
      certo("CEP malformado no site é recusado na porta, sem virar consulta",
        torto.status === 400 && !pedidosCep.some((u) => u.includes("/123")), `${torto.status} ${JSON.stringify(torto.j)}`);
      const semRua = await cepSite("55120000");
      certo("CEP de cidade inteira chega ao site com a rua vazia", semRua.status === 200 && semRua.j.logradouro === "");
      /* O freio: 20 por hora por endereço. O cache não conta aqui — o freio é
         antes dele, senão bastaria repetir o mesmo CEP para passar por cima. */
      let travou = 0;
      for (let i = 0; i < 25; i++) {
        const r = await cepSite("55038270");
        if (r.status === 429) { travou = i; break; }
      }
      certo("o site tem freio de consultas de CEP por endereço", travou > 0 && travou <= 20, `travou na ${travou}ª`);
    }

    console.log("\n— boletos: a matemática (contra o manual do Sicredi)");
    {
      certo("nosso número do exemplo do manual (0100/02/00248, 18, byte 2, seq 1) = 182000011",
        Bol.nossoNumero({ cooperativa: "0100", posto: "02", beneficiario: "00248", ano: 18, byte: 2, sequencial: 1 }) === "182000011");
      /* O exemplo do manual sozinho é CEGO para peso errado: com pesos de 2 a 8
         (em vez de 2 a 9) ele dá o mesmo dígito, por coincidência — a sabotagem
         passou. Este vetor foi feito À MÃO: 0512 03 12345 26 2 00001, pesos
         2..9 da direita para a esquerda, soma 188, resto 1, 11 − 1 = 10 → 0. */
      certo("nosso número calculado à mão (0512/03/12345, 26, byte 2, seq 1) = 262000010",
        Bol.nossoNumero({ cooperativa: "0512", posto: "03", beneficiario: "12345", ano: 26, byte: 2, sequencial: 1 }) === "262000010");
      const cbManual = "74891886400000099901125100614205120315335103";
      certo("linha digitável do exemplo do manual sai do código de barras",
        Bol.linhaDoCodigo(cbManual) === "74891125110061420512803153351030188640000009990");
      const trocado = cbManual.slice(0, 20) + (cbManual[20] === "9" ? "8" : "9") + cbManual.slice(21);
      certo("um dígito trocado no código de barras é pego", !Bol.codigoBarrasValido(trocado));
      certo("valor diferente do registro é pego na conferência",
        Bol.conferirBoleto({ codigoBarras: cbManual, linhaDigitavel: Bol.linhaDoCodigo(cbManual), valor: 9991 }).length === 1);
      const svg = Bol.barrasSVG(cbManual);
      const largura = Number(/width="([\d.]+)mm"/.exec(svg)[1]) - 5;
      certo("código de barras com 114 barras e 102,9 mm (padrão FEBRABAN: até 103 mm)",
        (svg.match(/z/g) || []).length === 114 && Math.abs(largura - 102.87) < 0.01, `${largura} mm`);
      certo("vencimento dia 31 em novembro vira 30, e fevereiro bissexto 29",
        Bol.vencimentoNoMes(2026, 11, 31) === "2026-11-30" && Bol.vencimentoNoMes(2028, 2, 30) === "2028-02-29");
      const p = Bol.parcelasAteDezembro({ hoje: "2026-09-16", dia: 16 });
      certo("parcela que vence HOJE não entra no carnê", p[0].competencia === "2026-10" && p.length === 3);
      certo("juros de 1% ao mês por dia: R$ 110,00 → 4 centavos; mínimo de 1 centavo",
        Bol.jurosPorDiaCentavos(11000) === 4 && Bol.jurosPorDiaCentavos(200) === 1);
      const { lerConfig } = require("./gestao/sicredi");
      const vazio = lerConfig({});
      certo("sem credenciais, os boletos ficam desligados e dizem o que falta",
        !vazio.configurado && vazio.faltam.some((f) => /SICREDI_API_KEY/.test(f)));
    }

    console.log("\n— boletos no Sicredi (1.26.0)");
    {
      const U = require("./gestao/util");
      const Database = require("better-sqlite3");
      const banco = new Database(path.join(TMP, "data", "site.db"));
      const novoAluno = async (extra) => {
        const r = await pedir("POST", "/api/gestao/alunos", { cookie: A, corpo: {
          nome: "Zz Qa Boleto", nascimento: "1990-04-02", cpf: "529.982.247-25", mensalidade: "110,00", status: "ativo",
          logradouro: "Avenida Caruaru", numero: "579", bairro: "Maria Auxiliadora", cidade: "Caruaru", uf: "PE", cep: "55038-270",
          dia_vencimento: "28", ...extra } });
        return r.j.id;
      };
      const esperadas = Bol.parcelasAteDezembro({ hoje: U.hojeLocal(), dia: 28 });
      if (!esperadas.length) console.log("  (fim de dezembro: sem parcela até dezembro para provar o carnê)");

      /* dia de vencimento */
      const al = await novoAluno();
      certo("o dia de vencimento é gravado no cadastro", (await pedir("GET", `/api/gestao/alunos/${al}`, { cookie: A })).j.aluno.dia_vencimento === 28);
      const diaRuim = await pedir("PUT", `/api/gestao/alunos/${al}`, { cookie: A, corpo: { dia_vencimento: "32" } });
      certo("dia de vencimento 32 é recusado", diaRuim.status === 400, String(diaRuim.status));

      const tela = (await pedir("GET", `/api/gestao/alunos/${al}/boletos`, { cookie: A })).j;
      certo("o .env é lido: boletos configurados, em produção", tela.configurado === true && tela.ambiente === "producao", JSON.stringify(tela.faltam));
      certo("a prévia mostra os meses até dezembro, com a mensalidade",
        JSON.stringify(tela.previa.map((x) => [x.competencia, x.vencimento, x.valor])) === JSON.stringify(esperadas.map((x) => [x.competencia, x.vencimento, 11000])));
      certo("pagador adulto é o próprio aluno", tela.pagador.nome === "Zz Qa Boleto" && !tela.pagador.bloqueios.length);

      const menor = await novoAluno({ nome: "Zz Qa Criança Boleto", nascimento: "2018-01-01", cpf: "",
        resp_nome: "Zz Qa Mãe Pagadora", resp_cpf: "111.444.777-35" });
      const telaMenor = (await pedir("GET", `/api/gestao/alunos/${menor}/boletos`, { cookie: A })).j;
      certo("aluno menor: o boleto sai no nome e CPF do responsável", telaMenor.pagador.nome === "Zz Qa Mãe Pagadora" && telaMenor.pagador.menor);
      const semCpf = await novoAluno({ cpf: "123.456.789-00" });
      const recusaCpf = await pedir("POST", `/api/gestao/alunos/${semCpf}/boletos`, { cookie: A, corpo: {} });
      certo("CPF que não confere bloqueia a geração antes de ir ao banco", recusaCpf.status === 400 && /CPF/.test(recusaCpf.j.error || "") && SB.registros.length === 0);

      if (esperadas.length) {
        /* ------------------------------------------------ gerar */
        const g = await pedir("POST", `/api/gestao/alunos/${al}/boletos`, { cookie: A, corpo: {} });
        certo("gera o carnê: um boleto por mês, todos em aberto",
          g.status === 200 && g.j.resultado?.length === esperadas.length && g.j.resultado.every((b) => b.situacao === "aberto"), JSON.stringify(g.j).slice(0, 300));
        const corpo0 = SB.registros[0] || {};
        certo("boleto HÍBRIDO (com QR Code Pix), com multa de 2% e juros de R$ 0,04 ao dia",
          corpo0.tipoCobranca === "HIBRIDO" && corpo0.multa === 2 && corpo0.tipoJuros === "VALOR" && corpo0.juros === 0.04 && corpo0.valor === 110);
        certo("sem negativação nem protesto automáticos (decisão da academia)",
          SB.registros.every((b) => !("diasNegativacaoAuto" in b) && !("diasProtestoAuto" in b)));
        const nn = corpo0.nossoNumero || "";
        certo("nosso número gerado aqui, com o dígito do Sicredi",
          /^\d{9}$/.test(nn) && Bol.nossoNumero({ cooperativa: "0512", posto: "03", beneficiario: "12345",
            ano: Number(nn.slice(0, 2)), byte: 2, sequencial: Number(nn.slice(3, 8)) }) === nn, nn);
        certo("seu número e mensagens dentro dos limites do banco (10 e 80 caracteres, sem acento)",
          SB.registros.every((b) => b.seuNumero.length <= 10 && b.mensagens.every((m) => m.length <= 80 && /^[\x20-\x7E]*$/.test(m))));
        certo("vencimentos enviados = os da prévia", JSON.stringify(SB.registros.map((b) => b.dataVencimento)) === JSON.stringify(esperadas.map((x) => x.vencimento)));
        certo("o token é reaproveitado entre as chamadas (o banco limita pedidos)", SB.tokens === 1, String(SB.tokens));

        const antes = SB.registros.length;
        const de2 = await pedir("POST", `/api/gestao/alunos/${al}/boletos`, { cookie: A, corpo: {} });
        certo("gerar de novo não cobra nenhum mês duas vezes", de2.status === 200 && SB.registros.length === antes && de2.j.resultado?.length === 0);

        /* ---------------------------------------- dois cliques ao mesmo tempo */
        const al2 = await novoAluno();
        const antes2 = SB.registros.length;
        await Promise.all([
          pedir("POST", `/api/gestao/alunos/${al2}/boletos`, { cookie: A, corpo: {} }),
          pedir("POST", `/api/gestao/alunos/${al2}/boletos`, { cookie: A, corpo: {} }),
        ]);
        const vivos2 = banco.prepare("SELECT competencia, COUNT(*) n FROM g_boletos WHERE aluno_id=? AND situacao<>'baixado' GROUP BY competencia").all(al2);
        certo("dois pedidos simultâneos: um boleto por mês, e o banco recebeu cada mês uma vez só",
          vivos2.length === esperadas.length && vivos2.every((v) => v.n === 1) && SB.registros.length - antes2 === esperadas.length,
          `${SB.registros.length - antes2} registros`);

        /* -------------------------------------------- a resposta que se perde */
        const al3 = await novoAluno();
        SB.perderProxima = true;
        const perdeu = await pedir("POST", `/api/gestao/alunos/${al3}/boletos`, { cookie: A, corpo: { competencias: [esperadas[0].competencia] } });
        const b3 = perdeu.j.resultado?.[0] || {};
        certo("sem resposta do banco, o boleto fica 'sem resposta' (e não é dado como falho)", b3.situacao === "registrando", JSON.stringify(b3));
        const nn3 = SB.registros[SB.registros.length - 1]?.nossoNumero;
        const antes3 = SB.registros.length;
        const retoma = await pedir("POST", `/api/gestao/alunos/${al3}/boletos`, { cookie: A, corpo: { competencias: [esperadas[0].competencia] } });
        certo("a nova tentativa CONSULTA e adota o boleto que o banco já tinha — sem registrar de novo",
          retoma.j.resultado?.[0]?.situacao === "aberto" && SB.registros.length === antes3
          && banco.prepare("SELECT nosso_numero FROM g_boletos WHERE aluno_id=?").get(al3)?.nosso_numero === nn3);

        /* ------------------------ o nosso número já usado por outro boleto */
        const al4 = await novoAluno();
        SB.colidirProxima = true;
        const col = await pedir("POST", `/api/gestao/alunos/${al4}/boletos`, { cookie: A, corpo: { competencias: [esperadas[0].competencia] } });
        const linha4 = banco.prepare("SELECT * FROM g_boletos WHERE aluno_id=?").get(al4);
        const outro = [...SB.boletos.values()].find((b) => b.seuNumero === "OUTRO");
        certo("número ocupado por boleto alheio: não adota o dos outros, troca o número e registra",
          col.j.resultado?.[0]?.situacao === "aberto" && !!outro && linha4?.nosso_numero !== outro.nossoNumero && outro.situacao === "EM CARTEIRA");

        /* ------------------------------------------------------- recusa */
        const al5 = await novoAluno();
        SB.recusarProxima = true;
        const rec = await pedir("POST", `/api/gestao/alunos/${al5}/boletos`, { cookie: A, corpo: { competencias: [esperadas[0].competencia] } });
        certo("recusa do banco aparece com a frase dele", rec.j.resultado?.[0]?.situacao === "recusado" && /CEP do pagador/.test(rec.j.resultado?.[0]?.erro || ""));
        const rec2 = await pedir("POST", `/api/gestao/alunos/${al5}/boletos`, { cookie: A, corpo: { competencias: [esperadas[0].competencia] } });
        certo("corrigido o cadastro, a parcela recusada é registrada na tentativa seguinte", rec2.j.resultado?.[0]?.situacao === "aberto");

        /* ------------------------------------------------ token vencido */
        SB.tokenValido = "outro";
        const conf = await pedir("POST", `/api/gestao/alunos/${al}/boletos/atualizar`, { cookie: A, corpo: {} });
        certo("token recusado pelo banco: pede outro e segue (a secretaria não vê erro)", conf.status === 200 && SB.tokens === 2, `${conf.status} ${SB.tokens}`);

        /* --------------------------------------------------- o carnê */
        const carne = await pedir("GET", `/admin/imprimir/carne/${al}`, { cookie: A });
        const b0 = banco.prepare("SELECT * FROM g_boletos WHERE aluno_id=? ORDER BY competencia").all(al);
        /* Sem boleto nenhum (o servidor não registrou), o resto do bloco não tem
           o que conferir — e a falha tem de aparecer como prova, não como a
           suíte inteira quebrando. */
        if (!b0.length) certo("há boletos registrados para conferir o carnê", false);
        else {
        certo("o carnê traz uma parcela por boleto em aberto", carne.status === 200
          && (carne.texto.match(/class="parcela"/g) || []).length === esperadas.length);
        certo("com linha digitável, código de barras, QR Code Pix e ficha de compensação",
          carne.texto.includes(Bol.linhaFormatada(b0[0].linha_digitavel)) && carne.texto.includes('class="barras"')
          && carne.texto.includes('class="qr"') && /Ficha de compensação/.test(carne.texto));
        certo("em produção, sem a tarja de teste", !/Teste — não pague/.test(carne.texto));
        certo("o carnê não sai sem login", (await pedir("GET", `/admin/imprimir/carne/${al}`)).status === 302);
        /* Um dígito trocado no banco de dados: esse boleto NÃO pode ir ao papel. */
        banco.prepare("UPDATE g_boletos SET codigo_barras=? WHERE id=?")
          .run(b0[0].codigo_barras.slice(0, 30) + (b0[0].codigo_barras[30] === "1" ? "2" : "1") + b0[0].codigo_barras.slice(31), b0[0].id);
        const carne2 = await pedir("GET", `/admin/imprimir/carne/${al}`, { cookie: A });
        certo("boleto que não passa na conferência fica FORA do carnê",
          (carne2.texto.match(/class="parcela"/g) || []).length === esperadas.length - 1 && !carne2.texto.includes(Bol.linhaFormatada(b0[0].linha_digitavel)));

        const pdf = await pedir("GET", `/admin/imprimir/boleto/${b0[b0.length - 1].id}.pdf`, { cookie: A });
        certo("a 2ª via oficial vem do Sicredi, em PDF", pdf.status === 200 && /application\/pdf/.test(pdf.cab.get("content-type")) && SB.pdfs === 1);

        /* --------------------------------------------- pago e cancelado */
        const ultimo = b0[b0.length - 1];
        const noBanco = SB.boletos.get(ultimo.nosso_numero);
        noBanco.situacao = "LIQUIDADO PIX"; noBanco.dadosLiquidacao = { data: "2026-09-20T10:00:00.000Z", valor: 110 };
        const at = await pedir("POST", `/api/gestao/alunos/${al}/boletos/atualizar`, { cookie: A, corpo: {} });
        const pago = at.j.boletos?.find((b) => b.id === ultimo.id) || {};
        certo("conferir pagamentos marca o boleto pago, com valor e data", pago.situacao === "pago" && pago.valor_pago === 11000);
        const baixaPago = await pedir("POST", `/api/gestao/boletos/${ultimo.id}/baixa`, { cookie: A, corpo: {} });
        certo("boleto pago não se cancela", baixaPago.status === 409);
        if (b0.length > 1) {
          const alvo = b0[b0.length - 2];
          const baixa = await pedir("POST", `/api/gestao/boletos/${alvo.id}/baixa`, { cookie: A, corpo: {} });
          certo("cancelar pede a baixa ao banco", baixa.status === 200 && baixa.j.boleto.situacao === "baixado" && SB.baixas.includes(alvo.nosso_numero));
          const depois = (await pedir("GET", `/api/gestao/alunos/${al}/boletos`, { cookie: A })).j;
          certo("o mês cancelado volta a poder ser gerado", depois.previa.some((x) => x.competencia === alvo.competencia));
          const aud = (await pedir("GET", "/api/gestao/auditoria?q=boleto", { cookie: A })).j.itens || [];
          certo("o cancelamento fica na auditoria, com o aluno e o mês", aud.some((l) => l.alvo.includes(`boleto de ${alvo.competencia}`)));
        }
        let apagou = true;
        try { banco.prepare("DELETE FROM g_boletos WHERE id=?").run(ultimo.id); } catch { apagou = false; }
        certo("boleto não se apaga do banco de dados (só se baixa)", !apagou);
        }
      }
      banco.close();
      const exemplo = await pedir("GET", "/.env.exemplo");
      certo("o .env.exemplo (e qualquer .env) não sai pela web", exemplo.status === 404);
    }

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
    /* O corpo deste endereço cresceu para 10 MB na 1.27.0 porque a matrícula
       leva foto e comprovante. O teto continua existindo — e é ele que esta
       prova mede. (429 também serve: o freio de 5 por hora já pegou o IP.) */
    const gordo = await pedir("POST", "/api/publico/matricula", { corpo: { ...PUB_MENOR({ turma_id: t1.j.id }), observacao: "x".repeat(11 * 1024 * 1024) } });
    certo("envio público gigante é recusado", gordo.status === 413 || gordo.status === 429, String(gordo.status));
    const pendentes = (await pedir("GET", "/api/gestao/alunos?status=pendente", { cookie: A })).j.alunos;
    /* Os ids dos arquivos ANTES de apagar: depois do DELETE não há de onde
       tirá-los, e é justamente o sumiço deles que precisa ser provado. */
    const aApagar = (await pedir("GET", `/api/gestao/alunos/${pendentes[0].id}`, { cookie: A })).j.aluno;
    const apagar = await pedir("DELETE", `/api/gestao/alunos/${pendentes[0].id}`, { cookie: A });
    certo("pré-matrícula repetida pode ser apagada", apagar.status === 200);
    /* A política de privacidade promete que a pré-matrícula que não se
       confirma é apagada. Deixar para trás a foto da criança e o comprovante
       do responsável transformaria a promessa em mentira. */
    const fotoOrfa = await pedir("GET", `/admin/arquivo/${aApagar.foto_id}`, { cookie: A });
    const compOrfo = await pedir("GET", `/admin/arquivo/${aApagar.comprovante_id}`, { cookie: A });
    certo("apagar a pré-matrícula leva a foto e o comprovante junto",
      aApagar.foto_id && aApagar.comprovante_id && fotoOrfa.status === 404 && compOrfo.status === 404,
      `foto ${fotoOrfa.status} · comprovante ${compOrfo.status}`);
    const apagouPre = (await pedir("GET", "/api/gestao/auditoria?q=Apagou", { cookie: A })).j.itens.find((l) => l.acao === "Apagou pré-matrícula");
    certo("apagar uma pré-matrícula não deixa o nome dela na auditoria",
      apagouPre && apagouPre.alvo === `pré-matrícula nº ${pendentes[0].id}` && !/Zz Qa/.test(apagouPre.alvo), JSON.stringify(apagouPre));
  } catch (e) {
    falhas.push("a suíte quebrou: " + e.message);
    console.log("  QUEBROU:", e.stack);
    console.log(log.split("\n").slice(-20).join("\n"));
  } finally {
    servidor.kill();
    servidorCep.close();
    servidorSB.close();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n  ${ok} passaram, ${falhas.length} falharam`);
  if (falhas.length) { for (const f of falhas) console.log("   ✖ " + f); process.exitCode = 1; }
})();
