/* ==========================================================================
   gestao/sicredi.js — a API de Cobrança do Sicredi (1.26.0)

   Só a conversa com o banco: autenticar, registrar, consultar, dar baixa e
   baixar o PDF oficial. Quem decide O QUE registrar é gestao/cobranca.js.

   Referência: "Manual API da Cobrança", Sicredi, versão 1.0 (27/06/2022).

   ---------------------------------------------------------------------------
   AS CREDENCIAIS MORAM NO .env DO SERVIDOR, E EM MAIS LUGAR NENHUM

     SICREDI_AMBIENTE        producao | sandbox
     SICREDI_API_KEY         a chave (UUID) do portal do desenvolvedor
     SICREDI_CODIGO_ACESSO   o Código de Acesso gerado no Internet Banking
                             (Cobrança ▸ Código de Acesso ▸ Gerar)
     SICREDI_COOPERATIVA     4 dígitos
     SICREDI_POSTO           2 dígitos (a agência)
     SICREDI_BENEFICIARIO    5 dígitos (o código do convênio de cobrança)

   Não no banco de dados: ele vai inteiro para o backup diário, e o backup
   viaja. Não no painel: quem tem a senha de uma secretaria não pode ler a
   chave que registra cobrança em nome da academia.

   No SANDBOX o manual fornece cooperativa, posto, beneficiário, usuário e
   senha de teste; só a chave (x-api-key de homologação) é pedida.

   `SICREDI_BASE_URL` troca o endereço do banco — é por onde a prova aponta
   para um Sicredi falso na própria máquina.
   ========================================================================== */
"use strict";

const so = (v) => String(v ?? "").replace(/\D/g, "");

const TESTE = { cooperativa: "6789", posto: "03", beneficiario: "12345", usuario: "123456789", senha: "teste123" };

function lerConfig(env = process.env) {
  const amb = String(env.SICREDI_AMBIENTE || "").trim().toLowerCase();
  const ambiente = amb === "producao" ? "producao" : (amb === "sandbox" || amb === "homologacao") ? "sandbox" : "";
  const teste = ambiente === "sandbox";
  const c = {
    ambiente,
    apiKey: String(env.SICREDI_API_KEY || "").trim(),
    codigoAcesso: String(env.SICREDI_CODIGO_ACESSO || "").trim() || (teste ? TESTE.senha : ""),
    cooperativa: so(env.SICREDI_COOPERATIVA) || (teste ? TESTE.cooperativa : ""),
    posto: String(env.SICREDI_POSTO || "").trim() || (teste ? TESTE.posto : ""),
    beneficiario: so(env.SICREDI_BENEFICIARIO) || (teste ? TESTE.beneficiario : ""),
    base: String(env.SICREDI_BASE_URL || "").trim().replace(/\/+$/, "")
      || `https://api-parceiro.sicredi.com.br${teste ? "/sb" : ""}`,
  };
  c.usuario = teste && !so(env.SICREDI_BENEFICIARIO) ? TESTE.usuario : c.beneficiario + c.cooperativa;

  /* O que falta, em português — é o que a tela mostra no lugar do botão. */
  const faltam = [];
  if (!ambiente) faltam.push("SICREDI_AMBIENTE (producao ou sandbox)");
  if (!c.apiKey) faltam.push("SICREDI_API_KEY");
  if (!c.codigoAcesso) faltam.push("SICREDI_CODIGO_ACESSO");
  if (!/^\d{4}$/.test(c.cooperativa)) faltam.push("SICREDI_COOPERATIVA (4 dígitos)");
  if (!/^\w{2}$/.test(c.posto)) faltam.push("SICREDI_POSTO (2 dígitos)");
  if (!/^\d{5}$/.test(c.beneficiario)) faltam.push("SICREDI_BENEFICIARIO (5 dígitos)");
  c.faltam = faltam;
  c.configurado = faltam.length === 0;
  return c;
}

/* O erro que o painel mostra. `incerto` = o pedido PODE ter chegado ao banco
   (sem resposta, prazo estourado, 5xx): quem chamou não pode concluir que o
   boleto não existe. */
class ErroSicredi extends Error {
  constructor(mensagem, { status = 0, incerto = false, corpo = null } = {}) {
    super(mensagem); this.status = status; this.incerto = incerto; this.corpo = corpo;
  }
}

function mensagemDo(j, texto, status) {
  if (j && typeof j === "object") {
    const m = j.message || j.mensagem || j.error_description || j.detail || j.error
      || (Array.isArray(j.errors) && j.errors.map((e) => e.message || e.mensagem || JSON.stringify(e)).join("; "));
    if (m) return String(m).slice(0, 300);
  }
  return (String(texto || "").trim().slice(0, 300)) || `o Sicredi respondeu ${status}`;
}

function criarSicredi(cfg, { fetch = globalThis.fetch, prazoMs = 20000 } = {}) {
  let tok = null;          /* { acesso, vence, renovacao, venceRenovacao } */

  async function http(url, opcoes) {
    try {
      return await fetch(url, { ...opcoes, signal: AbortSignal.timeout(prazoMs) });
    } catch (e) {
      throw new ErroSicredi(e.name === "TimeoutError"
        ? "O Sicredi não respondeu a tempo." : "Não foi possível falar com o Sicredi.", { incerto: true });
    }
  }

  /* ------------------------------------------------------------ o token
     Vale 300 s; o de renovação, 1800 s (exemplos do manual). O manual pede
     que NÃO se autentique a cada chamada — o banco limita pedidos (429). */
  async function pedirToken(form) {
    const r = await http(`${cfg.base}/auth/openapi/token`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, context: "COBRANCA", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const texto = await r.text();
    let j = null; try { j = JSON.parse(texto); } catch {}
    if (!r.ok || !j || !j.access_token) {
      throw new ErroSicredi(r.status === 401
        ? "O Sicredi recusou as credenciais (confira SICREDI_API_KEY, SICREDI_CODIGO_ACESSO, cooperativa e beneficiário)."
        : mensagemDo(j, texto, r.status), { status: r.status, incerto: r.status >= 500 });
    }
    const agora = Date.now();
    tok = {
      acesso: j.access_token,
      vence: agora + (Number(j.expires_in) || 300) * 1000 - 30000,
      renovacao: j.refresh_token || "",
      venceRenovacao: agora + (Number(j.refresh_expires_in) || 0) * 1000 - 30000,
    };
    return tok.acesso;
  }

  async function token() {
    const agora = Date.now();
    if (tok && agora < tok.vence) return tok.acesso;
    if (tok && tok.renovacao && agora < tok.venceRenovacao) {
      try { return await pedirToken({ grant_type: "refresh_token", refresh_token: tok.renovacao }); }
      catch { tok = null; }
    }
    return pedirToken({ grant_type: "password", username: cfg.usuario, password: cfg.codigoAcesso, scope: "cobranca" });
  }

  /* Uma chamada autenticada. Com 401, o token é descartado e a chamada
     repetida UMA vez — o token pode ter vencido entre a conferência e o uso. */
  async function chamar(metodo, caminho, { corpo, cabecalhos = {}, binario = false } = {}, repetiu = false) {
    const r = await http(`${cfg.base}${caminho}`, {
      method: metodo,
      headers: {
        "x-api-key": cfg.apiKey, Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json", cooperativa: cfg.cooperativa, posto: cfg.posto, ...cabecalhos,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (r.status === 401 && !repetiu) { tok = null; return chamar(metodo, caminho, { corpo, cabecalhos, binario }, true); }
    if (binario && r.ok) return { status: r.status, dados: Buffer.from(await r.arrayBuffer()) };
    const texto = await r.text();
    let j = null; try { j = JSON.parse(texto); } catch {}
    return { status: r.status, dados: j, texto };
  }

  const falhou = (r) => new ErroSicredi(mensagemDo(r.dados, r.texto, r.status),
    { status: r.status, incerto: r.status >= 500 || r.status === 429, corpo: r.dados });

  return {
    ambiente: cfg.ambiente,

    /* POST /cobranca/boleto/v1/boletos — devolve txid, qrCode,
       linhaDigitavel, codigoBarras, cooperativa, posto, nossoNumero. */
    async registrar(payload) {
      const r = await chamar("POST", "/cobranca/boleto/v1/boletos", { corpo: payload });
      if (r.status === 200 || r.status === 201) return r.dados || {};
      throw falhou(r);
    },

    /* GET por nosso número. `null` = o banco não conhece este boleto. */
    async consultar(nossoNumero) {
      const q = new URLSearchParams({ codigoBeneficiario: cfg.beneficiario, nossoNumero: so(nossoNumero) });
      const r = await chamar("GET", `/cobranca/boleto/v1/boletos?${q}`);
      if (r.status === 200) return r.dados || {};
      if (r.status === 404) return null;
      throw falhou(r);
    },

    /* PATCH …/{nossoNumero}/baixa — o pedido de cancelamento. O banco aceita
       (202) e processa depois; a situação "BAIXADO" aparece na consulta. */
    async baixar(nossoNumero) {
      const r = await chamar("PATCH", `/cobranca/boleto/v1/boletos/${so(nossoNumero)}/baixa`,
        { corpo: {}, cabecalhos: { codigoBeneficiario: cfg.beneficiario } });
      if (r.status >= 200 && r.status < 300) return r.dados || {};
      throw falhou(r);
    },

    /* O PDF oficial do banco — a "2ª via" que vale se o nosso carnê não
       servir por qualquer motivo. */
    async pdf(linhaDigitavel) {
      const q = new URLSearchParams({ linhaDigitavel: so(linhaDigitavel) });
      const r = await chamar("GET", `/cobranca/boleto/v1/boletos/pdf?${q}`, { binario: true });
      if (r.status >= 200 && r.status < 300 && Buffer.isBuffer(r.dados)) return r.dados;
      throw falhou(r);
    },
  };
}

module.exports = { lerConfig, criarSicredi, ErroSicredi };
