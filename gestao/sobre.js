/* ==========================================================================
   gestao/sobre.js — o histórico de versões para a tela "Sobre o sistema"

   A fonte é o próprio CHANGELOG.md do repositório: um lugar só para escrever
   o que mudou. Uma segunda lista, feita para a tela, ficaria para trás na
   primeira versão em que alguém esquecesse dela.

   O markdown é convertido aqui por um conversor PEQUENO e fechado: tudo é
   escapado primeiro, e só então negrito, código e listas viram tag. Nenhum
   HTML escrito no arquivo passa adiante, e link não vira link — a tela é para
   ler, não para sair do sistema.
   ========================================================================== */
"use strict";

const fs = require("node:fs");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function emLinha(texto) {
  return esc(texto)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/* Blocos: parágrafo, lista (com linhas de continuação recuadas), subtítulo
   (###), citação (>) e bloco de código. O que não se encaixa vira parágrafo. */
function paraHtml(md) {
  const linhas = md.replace(/\r/g, "").split("\n");
  const saida = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim() || /^---+$/.test(l.trim())) { i++; continue; }
    if (/^```/.test(l)) {
      const bloco = [];
      for (i++; i < linhas.length && !/^```/.test(linhas[i]); i++) bloco.push(linhas[i]);
      i++;
      saida.push(`<pre>${esc(bloco.join("\n"))}</pre>`);
      continue;
    }
    if (/^#{3,6}\s/.test(l)) { saida.push(`<h4>${emLinha(l.replace(/^#+\s*/, ""))}</h4>`); i++; continue; }
    if (/^>\s?/.test(l)) {
      const bloco = [];
      for (; i < linhas.length && /^>\s?/.test(linhas[i]); i++) bloco.push(linhas[i].replace(/^>\s?/, ""));
      saida.push(`<blockquote>${emLinha(bloco.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s/.test(l)) {
      const itens = [];
      for (; i < linhas.length && (/^\s*[-*]\s/.test(linhas[i]) || (/^\s{2,}\S/.test(linhas[i]) && itens.length)); i++) {
        if (/^\s*[-*]\s/.test(linhas[i])) itens.push(linhas[i].replace(/^\s*[-*]\s/, ""));
        else itens[itens.length - 1] += " " + linhas[i].trim();
      }
      saida.push(`<ul>${itens.map((x) => `<li>${emLinha(x)}</li>`).join("")}</ul>`);
      continue;
    }
    const par = [];
    for (; i < linhas.length && linhas[i].trim() && !/^(```|#{3,6}\s|>|\s*[-*]\s|---+$)/.test(linhas[i]); i++) par.push(linhas[i].trim());
    if (par.length) saida.push(`<p>${emLinha(par.join(" "))}</p>`);
    else i++;
  }
  return saida.join("\n");
}

/* "## 1.21.0 — 2026-09-11 · o calendário ganhou cor" → versão, data, título. */
function lerVersoes(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, "utf8"); } catch { return []; }
  return texto.split(/^## /m).slice(1).map((secao) => {
    const [cab, ...resto] = secao.split("\n");
    const m = /^(\d+\.\d+\.\d+)\s*[—–-]\s*(\d{4})-(\d{2})-(\d{2})\s*(?:·\s*(.*))?$/.exec(cab.trim());
    if (!m) return null;
    return { versao: m[1], data: `${m[4]}/${m[3]}/${m[2]}`, titulo: (m[5] || "").trim(), html: paraHtml(resto.join("\n")) };
  }).filter(Boolean);
}

module.exports = { lerVersoes, paraHtml };
