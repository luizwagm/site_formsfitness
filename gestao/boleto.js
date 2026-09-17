/* ==========================================================================
   gestao/boleto.js — a matemática do boleto, sem rede (1.26.0)

   Tudo aqui é função pura: entra número, sai número. É a parte que decide se
   o carnê impresso é PAGÁVEL, e por isso é a que mais precisa de prova — e
   prova sem rede, contra os exemplos do próprio manual do Sicredi.

   O que mora aqui:
     · o "nosso número" (AA B nnnnn D), que NÓS geramos — ver `nossoNumero`;
     · a conferência do código de barras e da linha digitável que o banco
       devolve, ANTES de imprimir;
     · o desenho do código de barras (Intercalado 2 de 5, padrão FEBRABAN);
     · as datas de vencimento de cada mês, e o dinheiro em centavos.
   ========================================================================== */
"use strict";

const so = (v) => String(v ?? "").replace(/\D/g, "");

/* ==========================================================================
   NOSSO NÚMERO — gerado por nós, e não pelo banco

   O manual permite as duas coisas. Gerar aqui é o que torna o registro
   SEGURO CONTRA QUEDA DE REDE: o número é gravado no nosso banco ANTES de ir
   ao Sicredi. Se a resposta se perde no caminho, a nova tentativa pergunta ao
   banco "o boleto 262000015 existe?" em vez de registrar de novo — e o aluno
   não recebe duas cobranças do mesmo mês.

   Formato: AA B nnnnn D (manual, seção 8)
     AA    ano de dois dígitos
     B     "byte de geração", de 2 a 9 (2 = gerado pelo beneficiário)
     nnnnn sequencial livre, 00000 a 99999
     D     dígito verificador, módulo 11 sobre
           cooperativa(4) posto(2) beneficiário(5) AA B nnnnn
   ========================================================================== */
function dvNossoNumero({ cooperativa, posto, beneficiario, ano, byte, sequencial }) {
  /* Posto alfanumérico entra como "00" — regra do manual. */
  const p = /^\d{2}$/.test(String(posto)) ? String(posto) : "00";
  const base = so(cooperativa).padStart(4, "0") + p + so(beneficiario).padStart(5, "0")
    + String(ano).padStart(2, "0") + String(byte) + String(sequencial).padStart(5, "0");
  let soma = 0, peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv >= 10 ? 0 : dv;
}

function nossoNumero(dados) {
  const { ano, byte, sequencial } = dados;
  return String(ano).padStart(2, "0") + String(byte) + String(sequencial).padStart(5, "0") + dvNossoNumero(dados);
}

/* Na impressão: 26/200015-3 — o jeito que o Sicredi escreve no boleto. */
const nossoNumeroFormatado = (nn) => {
  const d = so(nn);
  return d.length === 9 ? `${d.slice(0, 2)}/${d.slice(2, 8)}-${d.slice(8)}` : d;
};

/* ==========================================================================
   CÓDIGO DE BARRAS E LINHA DIGITÁVEL — conferidos antes de imprimir

   O banco devolve os dois prontos. Conferir aqui não é desconfiança do banco:
   é garantir que o que vai para o PAPEL é o que o banco registrou. Um dígito
   trocado no caminho (banco de dados, cópia, migração) vira um boleto que o
   caixa recusa — ou, pior, que o leitor aceita com o valor errado.

   Três conferências:
     1. o dígito geral do código de barras (módulo 11, posição 5);
     2. a linha digitável é exatamente a do código de barras, com os três
        dígitos de campo (módulo 10);
     3. o valor dentro do código de barras é o valor do nosso registro.
   ========================================================================== */
function dvGeral(codigo43) {
  let soma = 0, peso = 2;
  for (let i = codigo43.length - 1; i >= 0; i--) {
    soma += Number(codigo43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 1 || dv >= 10 ? 1 : dv;
}

function dvModulo10(campo) {
  let soma = 0, peso = 2;
  for (let i = campo.length - 1; i >= 0; i--) {
    let p = Number(campo[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function codigoBarrasValido(codigo) {
  const c = so(codigo);
  if (c.length !== 44) return false;
  return dvGeral(c.slice(0, 4) + c.slice(5)) === Number(c[4]);
}

/* A linha digitável que corresponde a um código de barras de 44 dígitos. */
function linhaDoCodigo(codigo) {
  const c = so(codigo);
  const livre = c.slice(19);
  const c1 = c.slice(0, 4) + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  return c1 + dvModulo10(c1) + c2 + dvModulo10(c2) + c3 + dvModulo10(c3) + c[4] + c.slice(5, 19);
}

/* Valor em centavos gravado nas posições 10 a 19 do código de barras. */
const valorDoCodigo = (codigo) => Number(so(codigo).slice(9, 19));

function conferirBoleto({ codigoBarras, linhaDigitavel, valor }) {
  const erros = [];
  if (!codigoBarrasValido(codigoBarras)) erros.push("o código de barras não confere (dígito verificador)");
  else {
    if (so(linhaDigitavel) !== linhaDoCodigo(codigoBarras)) erros.push("a linha digitável não corresponde ao código de barras");
    if (valorDoCodigo(codigoBarras) !== Number(valor)) erros.push("o valor do código de barras não é o valor do boleto");
    if (so(codigoBarras).slice(0, 3) !== "748") erros.push("o código de barras não é do Sicredi (748)");
  }
  return erros;
}

/* 74891.12511 00614.205128 03153.351030 1 88640000009990 */
function linhaFormatada(linha) {
  const l = so(linha);
  if (l.length !== 47) return l;
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} `
    + `${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

/* ==========================================================================
   O CÓDIGO DE BARRAS DESENHADO — Intercalado 2 de 5 (ITF)

   Medidas do padrão FEBRABAN, em milímetros de verdade (o SVG usa `mm`, e o
   navegador imprime na escala certa): barra fina de 0,254 mm, larga três
   vezes a fina, 13 mm de altura. São 405 módulos finos: 102,9 mm de largura,
   dentro dos 103 mm do padrão. Impresso maior ou menor, o leitor do caixa
   pode não ler — por isso nada aqui é em pixel nem em porcentagem.

   Cada par de dígitos vira 5 barras (o primeiro dígito) intercaladas com 5
   espaços (o segundo). "E" é estreito, "L" é largo.
   ========================================================================== */
const ITF = ["EELLE", "LEEEL", "ELEEL", "LLEEE", "EELEL", "LELEE", "ELLEE", "EEELL", "LEELE", "ELELE"];

function barrasSVG(codigo, { fina = 0.254, razao = 3, altura = 13, margem = 2.5 } = {}) {
  const c = so(codigo);
  if (c.length !== 44) return "";
  const larga = fina * razao;
  const elementos = [];                       /* [largura, éBarra] em ordem */
  for (const b of [true, false, true, false]) elementos.push([fina, b]);          /* início */
  for (let i = 0; i < 44; i += 2) {
    const barras = ITF[Number(c[i])], espacos = ITF[Number(c[i + 1])];
    for (let k = 0; k < 5; k++) {
      elementos.push([barras[k] === "L" ? larga : fina, true]);
      elementos.push([espacos[k] === "L" ? larga : fina, false]);
    }
  }
  elementos.push([larga, true], [fina, false], [fina, true]);                      /* fim */

  let x = margem, caminho = "";
  for (const [w, barra] of elementos) {
    if (barra) caminho += `M${x.toFixed(3)} 0h${w.toFixed(3)}v${altura}h-${w.toFixed(3)}z`;
    x += w;
  }
  const total = x + margem;
  return `<svg class="barras" xmlns="http://www.w3.org/2000/svg" width="${total.toFixed(3)}mm" height="${altura}mm"
    viewBox="0 0 ${total.toFixed(3)} ${altura}" shape-rendering="crispEdges" role="img" aria-label="Código de barras">
    <rect width="${total.toFixed(3)}" height="${altura}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}

/* ==========================================================================
   OS VENCIMENTOS DO CARNÊ

   Dia de vencimento 31 em novembro vira 30; dia 30 em fevereiro vira 28 (ou
   29). "Empurrar para o mês seguinte" mudaria a competência do boleto e
   geraria dois boletos no mesmo mês.

   As parcelas vão do primeiro mês que ainda não venceu até dezembro do mesmo
   ano. Vencimento HOJE não entra: o boleto chegaria ao aluno já vencendo, e o
   banco pode recusar data de vencimento no dia do registro.
   ========================================================================== */
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

function vencimentoNoMes(ano, mes, dia) {
  const d = Math.min(Math.max(1, Number(dia) || 1), ultimoDia(ano, mes));
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parcelasAteDezembro({ hoje, dia }) {
  const [ano, mesHoje] = hoje.split("-").map(Number);
  const lista = [];
  for (let mes = mesHoje; mes <= 12; mes++) {
    const vencimento = vencimentoNoMes(ano, mes, dia);
    if (vencimento <= hoje) continue;
    lista.push({ competencia: `${ano}-${String(mes).padStart(2, "0")}`, vencimento });
  }
  return lista;
}

/* ==========================================================================
   MULTA E JUROS (decisão da academia em 16/09/2026)

   Multa de 2% — o teto do Código de Defesa do Consumidor (art. 52, § 1º) — e
   juros de mora de 1% ao mês. O Sicredi recebe os juros como VALOR POR DIA:
   1% ao mês dividido por 30, em centavos. Com "PERCENTUAL" o manual não diz se
   é ao dia ou ao mês; mandar valor tira a dúvida do caminho.

   Mínimo de 1 centavo por dia: numa mensalidade de R$ 2,00 o arredondamento
   daria zero, e o boleto sairia sem juros nenhum.
   ========================================================================== */
const MULTA_PERCENTUAL = 2;
const JUROS_MES_PERCENTUAL = 1;
const jurosPorDiaCentavos = (valorCentavos) =>
  Math.max(1, Math.round((valorCentavos * JUROS_MES_PERCENTUAL) / 100 / 30));

module.exports = {
  dvNossoNumero, nossoNumero, nossoNumeroFormatado,
  codigoBarrasValido, linhaDoCodigo, valorDoCodigo, conferirBoleto, linhaFormatada, dvModulo10,
  barrasSVG, vencimentoNoMes, parcelasAteDezembro, ultimoDia,
  MULTA_PERCENTUAL, JUROS_MES_PERCENTUAL, jurosPorDiaCentavos,
};
