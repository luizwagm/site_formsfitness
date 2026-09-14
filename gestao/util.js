/* ==========================================================================
   gestao/util.js — contas pequenas que saem impressas em documento

   Tudo aqui acaba num contrato ou numa ficha. Um erro de fuso muda a data de
   um contrato assinado; um "cento e dez" escrito errado vira discussão sobre o
   valor. Por isso cada função é pura, sem banco, e tem prova na suíte.
   ========================================================================== */
"use strict";

/* ==========================================================================
   O FUSO É O DE RECIFE, NÃO O DO SERVIDOR

   O servidor roda em UTC. Às 21h de Caruaru já é o dia seguinte em UTC: um
   contrato gerado à noite sairia datado de amanhã, e um aniversariante do dia
   31 apareceria no mês errado. Toda data "de hoje" passa por aqui.
   ========================================================================== */
const FUSO = "America/Recife";

function partesLocais(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  /* O Intl devolve "24" para meia-noite em alguns ambientes. */
  if (p.hour === "24") p.hour = "00";
  return p;
}
const hojeLocal = (d) => { const p = partesLocais(d); return `${p.year}-${p.month}-${p.day}`; };

/* '2026-09-11T17:32:08.000Z' → '11/09/2026 14:32' (horário de Recife). */
function dataHoraBR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = partesLocais(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/* 'AAAA-MM-DD' → 'DD/MM/AAAA'. Datas SEM hora não passam pelo Date: um
   new Date("2021-05-03") é meia-noite em UTC, que em Recife é dia 2 às 21h. */
function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"];

/* 'AAAA-MM-DD' → '6 de fevereiro de 2026' (o formato do contrato). */
function dataExtenso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : "";
}

/* Idade completa em anos numa data de referência (hoje, se não vier). */
function idade(nascimento, referencia) {
  const n = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(nascimento || ""));
  if (!n) return null;
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(referencia || hojeLocal());
  let anos = Number(r[1]) - Number(n[1]);
  if (Number(r[2]) < Number(n[2]) || (r[2] === n[2] && Number(r[3]) < Number(n[3]))) anos--;
  return anos >= 0 && anos < 130 ? anos : null;
}
const ehMenor = (nascimento, referencia) => {
  const i = idade(nascimento, referencia);
  return i !== null && i < 18;
};

/* ==========================================================================
   DINHEIRO — sempre em centavos inteiros

   0,1 + 0,2 não é 0,3 em ponto flutuante. Um sistema que soma mensalidades
   em float erra o centavo, e o centavo errado aparece justamente no relatório
   que a contabilidade confere.
   ========================================================================== */
function reais(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const int = Math.floor(Math.abs(n) / 100).toLocaleString("pt-BR");
  const cent = String(Math.abs(n) % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}R$ ${int},${cent}`;
}

/* "110,00", "110", "1.234,56", "R$ 110,00" → centavos. Devolve null se não
   der para ler — melhor recusar do que gravar zero sem avisar. */
function paraCentavos(texto) {
  if (typeof texto === "number") return Math.round(texto);
  const s = String(texto ?? "").replace(/[R$\s]/g, "").trim();
  if (!s) return 0;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return null;
  /* Com vírgula, o ponto é milhar ("1.234,56"). Sem vírgula e com um ponto
     seguido de 1–2 dígitos no fim, o ponto é o decimal ("110.00", como está
     escrito no contrato antigo). */
  let normal;
  if (s.includes(",")) normal = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{1,2}$/.test(s)) normal = s;
  else normal = s.replace(/\./g, "");
  const v = Number(normal);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

/* ==========================================================================
   VALOR POR EXTENSO

   O contrato escreve "R$ 110,00 (CENTO E DEZ REAIS)". O extenso é o que vale
   se o número estiver ilegível, então ele tem de estar CERTO — inclusive nas
   armadilhas do português: "cem" e não "cento" sozinho, "mil" e não "um
   mil", e o "e" depois do mil só quando o resto é redondo ou menor que cem
   ("mil e cem", mas "mil cento e dez").
   ========================================================================== */
const UNID = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
  "setecentos", "oitocentos", "novecentos"];

function ate999(n) {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const partes = [];
  const c = Math.floor(n / 100), resto = n % 100;
  if (c) partes.push(CEM[c]);
  if (resto) {
    if (resto < 20) partes.push(UNID[resto]);
    else {
      const d = Math.floor(resto / 10), u = resto % 10;
      partes.push(u ? `${DEZ[d]} e ${UNID[u]}` : DEZ[d]);
    }
  }
  return partes.join(" e ");
}

function inteiroExtenso(n) {
  if (n === 0) return "zero";
  const milhares = Math.floor(n / 1000), resto = n % 1000;
  if (!milhares) return ate999(resto);
  const mil = milhares === 1 ? "mil" : `${ate999(milhares)} mil`;
  if (!resto) return mil;
  const liga = resto < 100 || resto % 100 === 0 ? " e " : " ";
  return mil + liga + ate999(resto);
}

function extensoReais(centavos) {
  const n = Math.round(Math.abs(Number(centavos) || 0));
  const r = Math.floor(n / 100), c = n % 100;
  if (r > 999999) return "";                     // fora do que uma mensalidade é
  const pr = r ? `${inteiroExtenso(r)} ${r === 1 ? "real" : "reais"}` : "";
  const pc = c ? `${inteiroExtenso(c)} ${c === 1 ? "centavo" : "centavos"}` : "";
  if (pr && pc) return `${pr} e ${pc}`;
  return pr || pc || "zero reais";
}

/* ==========================================================================
   CPF — confere os dígitos verificadores

   Não é burocracia: é o que pega o CPF digitado com um número trocado, que
   só apareceria quando o boleto voltasse do banco. Não bloqueia o cadastro na
   gestão (a secretaria pode estar copiando de um documento antigo), mas
   bloqueia no formulário público, onde quem digita é o próprio titular.
   ========================================================================== */
function cpfValido(cpf) {
  const d = String(cpf || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10]);
}
function formatarCpf(cpf) {
  const d = String(cpf || "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(cpf || "");
}

/* O código aparece com seis dígitos nos documentos antigos da academia:
   "003879", "004018". Mantém a mesma cara. */
const codigoFormatado = (n) => (n ? String(n).padStart(6, "0") : "");

/* ==========================================================================
   DIAS DE AULA
   ========================================================================== */
const DIAS_NOME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIAS_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
const DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/* [2,3,5] → "terças, quartas e sextas" — do jeito que o contrato escreve. */
function diasPorExtenso(dias) {
  const nomes = [...new Set(dias)].sort((a, b) => a - b).map((d) => DIAS_PLURAL[d]).filter(Boolean);
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/* ==========================================================================
   PÁSCOA E FERIADOS

   Algoritmo de Meeus/Jones/Butcher, válido para qualquer ano do calendário
   gregoriano. A Sexta-feira Santa (e o Carnaval, se a academia cadastrar)
   saem daqui — é o que evita recadastrar feriado móvel todo ano.
   ========================================================================== */
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

/* Conta em UTC puro: são datas de calendário, sem hora. Somar dias em hora
   local atravessaria um horário de verão e cairia no dia errado. */
const iso = (a, m, d) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function somarDias(isoData, n) {
  const [a, m, d] = isoData.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/* Todas as datas de feriado de um ano → Map('AAAA-MM-DD' → [nomes]).
   Duas regras no mesmo dia (acontece) viram uma lista, e não uma perdida. */
function feriadosDoAno(regras, ano) {
  const mapa = new Map();
  const por = (data, nome) => {
    if (!data || !data.startsWith(String(ano))) return;
    if (!mapa.has(data)) mapa.set(data, []);
    mapa.get(data).push(nome);
  };
  const p = pascoa(ano);
  const dataPascoa = iso(ano, p.mes, p.dia);
  for (const f of regras) {
    if (f.tipo === "anual" && f.dia && f.mes) por(iso(ano, f.mes, f.dia), f.nome);
    else if (f.tipo === "data" && f.data) por(String(f.data).slice(0, 10), f.nome);
    else if (f.tipo === "pascoa" && Number.isFinite(Number(f.pascoa)))
      por(somarDias(dataPascoa, Number(f.pascoa)), f.nome);
  }
  return mapa;
}

/* Todas as datas do calendário que caem no ano, com o que cada uma é:
   data → [{ id, nome, categoria, tipo }]. É a versão de feriadosDoAno que
   sabe separar feriado, dia de aula e outra atividade. */
const CATEGORIAS = ["feriado", "atividade", "aula"];   // também a ORDEM de quem vence no mesmo dia
function datasDoAno(regras, ano) {
  const mapa = new Map();
  const por = (data, f) => {
    if (!data || !data.startsWith(String(ano))) return;
    if (!mapa.has(data)) mapa.set(data, []);
    mapa.get(data).push({ id: f.id, nome: f.nome, categoria: CATEGORIAS.includes(f.categoria) ? f.categoria : "feriado", tipo: f.tipo });
  };
  const p = pascoa(ano);
  const dataPascoa = iso(ano, p.mes, p.dia);
  for (const f of regras) {
    if (f.tipo === "anual" && f.dia && f.mes) por(iso(ano, f.mes, f.dia), f);
    else if (f.tipo === "data" && f.data) por(String(f.data).slice(0, 10), f);
    else if (f.tipo === "pascoa" && Number.isFinite(Number(f.pascoa))) por(somarDias(dataPascoa, Number(f.pascoa)), f);
  }
  return mapa;
}

/* O mês da agenda: um item por dia, com a COR e o que explica a cor.

   Quem decide o dia, nesta ordem:
   1. Uma data cadastrada para aquele dia ESPECÍFICO vale mais que uma regra
      que se repete. É assim que a academia diz "este ano, no São João, tem
      aula": cadastra 24/06/2026 como dia de aula, e o feriado anual continua
      valendo nos outros anos.
   2. No mesmo nível, feriado vence atividade, que vence dia de aula — o que
      a secretaria mais precisa ver para avisar as turmas vem por cima.
   3. Sem nada cadastrado, vale a regra da semana (os dias de aula).

   `aula` responde "tem aula neste dia?": um dia de outra atividade (exame de
   pele) num dia de aula continua tendo aula — a não ser que também seja
   feriado (capacitação da equipe marcada num feriado não abre as turmas).
   Só um "dia de aula" cadastrado para a data abre aula num feriado. */
function mesDaAgenda(regras, diasAula, ano, mes) {
  const datas = datasDoAno(regras, ano);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dias = [];
  for (let d = 1; d <= ultimo; d++) {
    const data = iso(ano, mes, d);
    const semana = new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
    const doDia = datas.get(data) || [];
    const especificas = doDia.filter((x) => x.tipo === "data");
    const valem = especificas.length ? especificas : doDia;
    const vence = CATEGORIAS.find((c) => valem.some((x) => x.categoria === c)) || "";
    const regraSemana = diasAula.includes(semana);
    const cor = vence || (regraSemana ? "aula" : "");
    const feriados = valem.filter((x) => x.categoria === "feriado").map((x) => x.nome);
    dias.push({
      data, dia: d, semana, cor,
      eventos: doDia.map((x) => ({ nome: x.nome, categoria: x.categoria, vale: valem.includes(x) })),
      feriado: vence === "feriado" ? feriados.join(" · ") : "",
      aula: cor === "aula" || (cor === "atividade" && regraSemana && !doDia.some((x) => x.categoria === "feriado")),
      diaDeAulaComFeriado: regraSemana && vence === "feriado",
    });
  }
  return dias;
}

module.exports = {
  FUSO, hojeLocal, dataHoraBR, dataBR, dataExtenso, MESES, idade, ehMenor,
  reais, paraCentavos, extensoReais, cpfValido, formatarCpf, codigoFormatado,
  DIAS_NOME, DIAS_PLURAL, DIAS_CURTO, diasPorExtenso,
  pascoa, somarDias, feriadosDoAno, datasDoAno, CATEGORIAS, mesDaAgenda,
};
