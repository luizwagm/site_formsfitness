/* ==========================================================================
   gestao/cep.js — o endereço a partir do CEP (1.26.0)

   QUEM PERGUNTA É O SERVIDOR, E NÃO O NAVEGADOR. O painel roda com
   `connect-src 'self'`: abrir uma exceção para um site de CEP seria afrouxar a
   trava da tela que guarda CPF e foto de criança por causa de um conforto de
   digitação. Aqui a pergunta sai do servidor, com prazo curto, e a tela só
   fala com a própria casa.

   DOIS SERVIÇOS, UM DE RESERVA. O ViaCEP é o padrão do mercado e cai de vez em
   quando; a BrasilAPI junta várias bases (inclusive a dos Correios) e acha CEP
   novo que o ViaCEP ainda não tem. "Não encontrado" num deles não é a palavra
   final — o outro é consultado. Só quando os DOIS falham de rede a resposta é
   "serviço indisponível", que a tela trata diferente de "CEP não existe": no
   primeiro caso a secretaria digita o endereço à mão e segue.

   CEP DE CIDADE PEQUENA NÃO TEM RUA. "55120-000" (Riacho das Almas) devolve a
   cidade e a UF, com logradouro e bairro vazios. Isso é resposta válida, e a
   tela preenche só o que veio.

   `FF_CEP_BASES` troca os endereços dos serviços — é por onde a prova aponta
   para um servidor falso na própria máquina. Prova não sai na internet.
   ========================================================================== */
"use strict";

const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
  "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);

const texto = (v, max) => String(v ?? "").replace(/[\x00-\x1F<>]/g, "").trim().slice(0, max);

/* Cada serviço sabe montar a URL e traduzir a resposta dele para o nosso
   formato. `null` = "este serviço diz que o CEP não existe". */
const SERVICOS = [
  {
    nome: "ViaCEP",
    url: (base, cep) => `${base}/ws/${cep}/json/`,
    base: "https://viacep.com.br",
    ler: (status, j) => {
      if (status === 400 || (j && j.erro)) return null;
      return { logradouro: j.logradouro, bairro: j.bairro, cidade: j.localidade, uf: j.uf };
    },
  },
  {
    nome: "BrasilAPI",
    url: (base, cep) => `${base}/api/cep/v1/${cep}`,
    base: "https://brasilapi.com.br",
    ler: (status, j) => {
      if (status === 404 || status === 400) return null;
      return { logradouro: j.street, bairro: j.neighborhood, cidade: j.city, uf: j.state };
    },
  },
];

function criarBuscaCep({ fetch = globalThis.fetch, bases = process.env.FF_CEP_BASES, prazoMs = 4000 } = {}) {
  const trocadas = String(bases || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const servicos = SERVICOS.map((s, i) => ({ ...s, base: trocadas[i] || s.base }));

  /* Guarda a resposta por um dia. CEP não muda de rua de uma hora para outra,
     e a secretaria que abre e fecha o mesmo cadastro não precisa perguntar de
     novo a um serviço que pode estar lento. Teto de 1000 para não crescer sem
     fim num processo que fica meses de pé. */
  const cache = new Map();
  const DIA = 24 * 3600 * 1000;

  async function consultar(servico, cep) {
    const r = await fetch(servico.url(servico.base, cep), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(prazoMs),
    });
    if (r.status >= 500 || r.status === 429) throw new Error(`${servico.nome} respondeu ${r.status}`);
    let j = null;
    try { j = await r.json(); } catch { if (r.ok) throw new Error(`${servico.nome}: resposta ilegível`); }
    const lido = servico.ler(r.status, j || {});
    if (!lido) return null;
    const uf = texto(lido.uf, 2).toUpperCase();
    const cidade = texto(lido.cidade, 80);
    /* Sem cidade ou com UF inventada, a resposta não serve para nada: melhor
       tratar como "não achou" do que preencher o cadastro com lixo. */
    if (!cidade || !UFS.has(uf)) return null;
    return { cep, logradouro: texto(lido.logradouro, 120), bairro: texto(lido.bairro, 80), cidade, uf };
  }

  /* Devolve o endereço, `null` se o CEP não existe, ou lança `indisponivel`
     quando nenhum serviço respondeu. */
  return async function buscarCep(entrada) {
    const cep = String(entrada ?? "").replace(/\D/g, "");
    if (!/^\d{8}$/.test(cep) || /^0{8}$/.test(cep)) return null;

    const guardado = cache.get(cep);
    if (guardado && Date.now() - guardado.em < DIA) return guardado.valor;

    let respondeu = false;
    for (const s of servicos) {
      try {
        const achado = await consultar(s, cep);
        respondeu = true;
        if (achado) { guardar(cep, achado); return achado; }
      } catch (e) {
        console.error(`  ✖ CEP ${cep}:`, e.name === "TimeoutError" ? `${s.nome} demorou demais` : e.message);
      }
    }
    if (!respondeu) {
      const erro = new Error("Não foi possível consultar o CEP agora. Preencha o endereço à mão.");
      erro.indisponivel = true;
      throw erro;
    }
    guardar(cep, null);
    return null;
  };

  /* "Não existe" vale uma hora, e não um dia: ele pode ter vindo de um serviço
     só (o outro fora do ar), e CEP recém-criado aparece nas bases aos poucos. */
  function guardar(cep, valor) {
    if (cache.size >= 1000) cache.delete(cache.keys().next().value);
    cache.set(cep, { em: Date.now() - (valor ? 0 : DIA - 3600 * 1000), valor });
  }
}

module.exports = { criarBuscaCep };
