/* ==========================================================================
   gestao/documentos.js — o que sai impresso: ficha, contrato e relatórios

   Cada documento é uma página HTML completa, servida só para quem está
   logado, com o CSS de impressão dentro. A ficha e o contrato têm de caber em
   UMA lauda, como os papéis que a academia usa hoje — e quem garante isso é
   um ajuste automático de tamanho de letra (ver `SCRIPT_PAGINA`), não a
   torcida para o texto não crescer.
   ========================================================================== */
"use strict";

const U = require("./util");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ==========================================================================
   OS MARCADORES DO CONTRATO

   Esta lista é a ÚNICA fonte da verdade sobre o que o modelo aceita: a tela
   de edição mostra a lista a partir daqui, e salvar um modelo com um
   marcador que não está aqui é RECUSADO. Um "{{ENDERECOO}}" escrito errado
   sairia impresso, literal, no contrato que o cliente assina.
   ========================================================================== */
const MARCADORES = [
  ["CODIGO", "Código de matrícula (6 dígitos)"],
  ["CONTRATANTE_NOME", "Quem assina: o aluno, ou o responsável se o aluno for menor"],
  ["CONTRATANTE_NACIONALIDADE", "Nacionalidade de quem assina"],
  ["CONTRATANTE_RG", "RG de quem assina"],
  ["CONTRATANTE_RG_EMISSOR", "Órgão emissor do RG de quem assina"],
  ["CONTRATANTE_CPF", "CPF de quem assina"],
  ["ALUNO_NOME", "Nome do aluno"],
  ["ALUNO_NASCIMENTO", "Nascimento do aluno (DD/MM/AAAA)"],
  ["ALUNO_IDADE", "Idade do aluno, em anos"],
  ["ENDERECO", "Rua / avenida (e complemento)"],
  ["NUMERO", "Número"],
  ["BAIRRO", "Bairro"],
  ["CEP", "CEP"],
  ["CIDADE", "Cidade"],
  ["UF", "Estado (sigla)"],
  ["ATIVIDADE", "Atividade(s) do aluno (ex.: Natação e Hidroginástica)"],
  ["HORARIO", "Horário(s), na mesma ordem das atividades (ex.: 06:00h e das 07:00)"],
  ["ATIVIDADES_HORARIOS", "Cada atividade com o seu horário e os seus dias (ex.: Natação às 06:00h (terças e sextas))"],
  ["DIAS_ALUNO", "Os dias em que ESTE aluno tem aula, por extenso"],
  ["DIAS_AULA", "Dias de funcionamento da academia, por extenso (ex.: terças, quartas e sextas)"],
  ["MENSALIDADE", "Mensalidade (ex.: R$ 110,00)"],
  ["MENSALIDADE_EXTENSO", "Mensalidade por extenso, em maiúsculas"],
  ["DATA_MATRICULA", "Data da matrícula (DD/MM/AAAA)"],
  ["DATA_EXTENSO", "Data em que o contrato é gerado, por extenso"],
  ["ASSINATURAS", "Local, data e as linhas de assinatura (use no fim)"],
];
const BLOCOS = ["SE_MENOR", "SE_MAIOR"];
const NOMES = new Set(MARCADORES.map(([n]) => n));

/* Os marcadores que um texto usa e não existem. Blocos contam pelo nome. */
function marcadoresDesconhecidos(texto) {
  const achados = new Set();
  for (const m of String(texto || "").matchAll(/\{\{\s*([#/]?)([A-Za-z_]+)\s*\}\}/g)) {
    const nome = m[2].toUpperCase();
    if (m[1] ? !BLOCOS.includes(nome) : !NOMES.has(nome)) achados.add(m[0]);
  }
  return [...achados];
}

/* ==========================================================================
   O RENDERIZADOR

   Uma passada só, com função de substituição. Duas razões:
     · um valor que por acaso contenha "{{…}}" (o nome digitado de um jeito
       estranho) não é expandido de novo;
     · String.replace com texto como substituição interpreta "$&" e "$1" — foi
       exatamente o que quebrou o main.js deste projeto na 1.7.0. Com função,
       o valor entra como está.
   ========================================================================== */
function renderizar(texto, valores, condicoes) {
  let s = String(texto || "");
  /* Blocos primeiro: o conteúdo de um bloco que sai não precisa ser
     preenchido. Aceita o bloco quebrado em parágrafos pelo editor. */
  s = s.replace(/\{\{\s*#([A-Za-z_]+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g,
    (_, nome, dentro) => (condicoes[nome.toUpperCase()] ? dentro : ""));
  s = s.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (inteiro, nome) => {
    const k = nome.toUpperCase();
    if (!(k in valores)) return inteiro;
    const v = valores[k];
    return v && typeof v === "object" && v.html !== undefined ? v.html : esc(v);
  });
  /* O editor embrulha os marcadores de bloco em <p> próprios; quando o bloco
     sai, sobram parágrafos vazios que viram linhas em branco no papel. */
  return s.replace(/<p>\s*(?:<br>\s*)*<\/p>/g, "");
}

/* ==========================================================================
   OS DADOS DO CONTRATO

   QUEM ASSINA muda com a idade: aluno maior assina por si; menor, pelo
   responsável — é assim no contrato que a academia usa. O endereço é sempre
   o do aluno (a ficha não tem outro).

   Devolve também a lista de campos EM BRANCO que o contrato vai usar. A tela
   mostra essa lista antes de gerar: é mais barato completar o cadastro agora
   do que reimprimir um contrato com "C.P.F. nº ," no meio.
   ========================================================================== */
/* "a", "a e b", "a, b e c". */
const listaPt = (itens) => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`);

/* As atividades no texto do contrato (1.22.0: o aluno pode ter mais de uma).
   O modelo diz "atividade física de {{ATIVIDADE}} … das {{HORARIO}}h" — o
   "h" final é do MODELO. Com duas turmas, sai "de Natação e Hidroginástica …
   das 06:00h e das 07:00h", na mesma ordem: o último horário fica sem o "h"
   aqui para o do modelo completá-lo. */
function textoDasAtividades(matriculas) {
  const ms = matriculas || [];
  const nomes = [...new Set(ms.map((m) => m.atividade_nome).filter(Boolean))];
  const horas = ms.map((m) => m.horario).filter(Boolean);
  const horario = horas.length <= 1 ? (horas[0] || "") : `${horas.slice(0, -1).map((h) => h + "h").join(", das ")} e das ${horas[horas.length - 1]}`;
  const cada = ms.map((m) => `${m.atividade_nome} às ${m.horario}h${m.dias && m.dias.length ? ` (${U.diasPorExtenso(m.dias)})` : ""}`);
  const diasAluno = [...new Set(ms.flatMap((m) => m.dias || []))];
  return { atividade: listaPt(nomes), horario, cada: listaPt(cada), diasAluno };
}

function dadosDoContrato({ aluno, matriculas = [], diasAula, hoje, assinaturaId }) {
  const menor = U.ehMenor(aluno.nascimento, hoje);
  const quem = menor
    ? { nome: aluno.resp_nome, nac: aluno.resp_nacionalidade, rg: aluno.resp_rg,
        emissor: aluno.resp_rg_emissor, cpf: aluno.resp_cpf }
    : { nome: aluno.nome, nac: aluno.nacionalidade, rg: aluno.rg,
        emissor: aluno.rg_emissor, cpf: aluno.cpf };

  const endereco = [aluno.logradouro, aluno.complemento].filter(Boolean).join(", ");
  const idade = U.idade(aluno.nascimento, hoje);
  const at = textoDasAtividades(matriculas);

  const valores = {
    CODIGO: U.codigoFormatado(aluno.codigo),
    CONTRATANTE_NOME: quem.nome || "",
    CONTRATANTE_NACIONALIDADE: quem.nac || "",
    CONTRATANTE_RG: quem.rg || "",
    CONTRATANTE_RG_EMISSOR: quem.emissor || "",
    CONTRATANTE_CPF: U.formatarCpf(quem.cpf),
    ALUNO_NOME: aluno.nome || "",
    ALUNO_NASCIMENTO: U.dataBR(aluno.nascimento),
    ALUNO_IDADE: idade === null ? "" : String(idade),
    ENDERECO: endereco,
    NUMERO: aluno.numero || "",
    BAIRRO: aluno.bairro || "",
    CEP: aluno.cep || "",
    CIDADE: aluno.cidade || "",
    UF: aluno.uf || "",
    ATIVIDADE: at.atividade,
    HORARIO: at.horario,
    ATIVIDADES_HORARIOS: at.cada,
    DIAS_ALUNO: U.diasPorExtenso(at.diasAluno.length ? at.diasAluno : diasAula),
    DIAS_AULA: U.diasPorExtenso(diasAula),
    MENSALIDADE: aluno.mensalidade ? U.reais(aluno.mensalidade) : "",
    MENSALIDADE_EXTENSO: aluno.mensalidade ? U.extensoReais(aluno.mensalidade).toUpperCase() : "",
    DATA_MATRICULA: U.dataBR(aluno.data_matricula),
    DATA_EXTENSO: U.dataExtenso(hoje),
  };
  valores.ASSINATURAS = { html: blocoAssinaturas(valores.CONTRATANTE_NOME, hoje, assinaturaId) };

  const rotulos = {
    CODIGO: "código de matrícula", CONTRATANTE_NOME: menor ? "nome do responsável" : "nome",
    CONTRATANTE_RG: menor ? "RG do responsável" : "RG", CONTRATANTE_RG_EMISSOR: menor ? "órgão emissor do RG do responsável" : "órgão emissor do RG",
    CONTRATANTE_CPF: menor ? "CPF do responsável" : "CPF", ALUNO_NASCIMENTO: "data de nascimento",
    ENDERECO: "endereço", NUMERO: "número", BAIRRO: "bairro", CEP: "CEP", CIDADE: "cidade", UF: "estado",
    ATIVIDADE: "atividade (nenhuma cadastrada)", MENSALIDADE: "mensalidade",
  };
  const vazios = Object.entries(rotulos).filter(([k]) => !valores[k]).map(([, r]) => r);

  return { valores, condicoes: { SE_MENOR: menor, SE_MAIOR: !menor }, menor, vazios };
}

/* As assinaturas: o contratante embaixo, a academia ao lado. Se a direção
   cadastrou a imagem das assinaturas (como no contrato em Word), ela entra;
   senão, três linhas em branco para assinar à caneta. */
function blocoAssinaturas(contratante, hoje, assinaturaId) {
  const contratada = assinaturaId
    ? `<img class="ass-img" src="/admin/arquivo/${Number(assinaturaId)}" alt="Assinaturas da contratada e das testemunhas">`
    : `<div class="ass-linhas">
         <div><span class="traco"></span>Contratado</div>
         <div><span class="traco"></span>Testemunha I</div>
         <div><span class="traco"></span>Testemunha II</div>
       </div>`;
  return `<div class="assinaturas">
    <p class="local-data">Caruaru (PE), ${esc(U.dataExtenso(hoje))}.</p>
    <div class="ass-contratante"><span class="linha-x">X</span><b>${esc(contratante || "")}</b><small>Contratante</small></div>
    ${contratada}
  </div>`;
}

/* ==========================================================================
   A PÁGINA IMPRESSA

   O ajuste de uma folha (em `SCRIPT_PAGINA`): mede a folha e, se o conteúdo passar da lauda,
   reduz a letra em passos pequenos até caber — com piso, para não virar
   letra de bula. O contrato tem ~1.000 palavras, e cabe numa lauda do jeito
   que o Word o imprimia; mas basta um endereço longo ou uma cláusula nova
   para ele pular para a segunda folha, e ninguém percebe até imprimir.
   ========================================================================== */
/* A barra de cima da página impressa: imprimir, escolher a orientação e
   (na ficha e no contrato) refazer o ajuste de uma folha para a orientação
   escolhida. A escolha fica lembrada por tipo de documento neste navegador.

   Sem CABEÇALHO E RODAPÉ DO NAVEGADOR (data, título, endereço da página,
   "1/1"): eles só aparecem porque existe margem de página para imprimi-los.
   Com @page { margin: 0 } não há onde pô-los, e a margem de verdade vem da
   própria folha — nas laterais por padding, em cima e embaixo por um
   cabeçalho e um rodapé VAZIOS de tabela, que o navegador repete em toda
   folha impressa (senão a segunda página de um relatório começaria colada
   na borda do papel). */
const SCRIPT_PAGINA = `
<script>
(function () {
  var mm = 96 / 25.4;
  var folha = document.querySelector(".folha");
  var miolo = document.querySelector(".folha-in");
  var regra = document.getElementById("orientacao");
  var chave = "ff-orientacao-" + document.body.dataset.tipo;
  var base = null;

  function ajustar(paisagem) {
    if (!folha.hasAttribute("data-uma-folha")) return;
    var aviso = document.querySelector(".aviso-folha");
    folha.style.fontSize = "";
    if (base === null) base = parseFloat(getComputedStyle(folha).fontSize);
    /* Altura útil: a folha menos 10mm em cima e 10mm embaixo. */
    var limite = (paisagem ? 190 : 277) * mm;
    var tamanho = base, piso = base * 0.72;
    while (miolo.offsetHeight > limite && tamanho > piso) {
      tamanho -= 0.25;
      folha.style.fontSize = tamanho + "px";
    }
    if (aviso) aviso.hidden = miolo.offsetHeight <= limite;
  }

  function orientar(paisagem, lembrar) {
    document.body.classList.toggle("paisagem", paisagem);
    regra.textContent = "@page{size:A4 " + (paisagem ? "landscape" : "portrait") + ";margin:0}";
    document.querySelectorAll("[data-orient]").forEach(function (b) {
      b.setAttribute("aria-pressed", String((b.dataset.orient === "h") === paisagem));
    });
    ajustar(paisagem);
    if (lembrar) { try { localStorage.setItem(chave, paisagem ? "h" : "v"); } catch (e) {} }
  }

  document.querySelectorAll("[data-orient]").forEach(function (b) {
    b.addEventListener("click", function () { orientar(b.dataset.orient === "h", true); });
  });
  document.getElementById("bt-imprimir").addEventListener("click", function () { window.print(); });
  var salvo = null;
  try { salvo = localStorage.getItem(chave); } catch (e) {}
  orientar(salvo ? salvo === "h" : document.body.classList.contains("paisagem"), false);
})();
</script>`;

function pagina({ titulo, corpo, css = "", umaFolha = false, paisagem = false, tipo = "documento" }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)} — Forms Fitness</title>
<style id="orientacao">@page{size:A4 ${paisagem ? "landscape" : "portrait"};margin:0}</style>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;background:#e9eef4;color:#111;font-family:Arial,Helvetica,sans-serif}
  .barra-imp{position:sticky;top:0;display:flex;gap:.6rem;align-items:center;justify-content:center;
    padding:.6rem;background:#0B4EA2;color:#fff;font-size:14px;z-index:5}
  .barra-imp button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:.45rem 1.1rem;
    background:#7ED321;color:#0e2a4a;cursor:pointer}
  .barra-imp .orient{display:inline-flex;background:rgba(255,255,255,.15);border-radius:999px;padding:3px}
  .barra-imp .orient button{background:transparent;color:#fff;padding:.3rem .8rem;font-weight:600}
  .barra-imp .orient button[aria-pressed="true"]{background:#fff;color:#0B4EA2}
  .barra-imp .aviso-folha{background:#fff3cd;color:#7a5200;border-radius:6px;padding:.25rem .6rem}
  /* A folha tem a largura do papel; a margem lateral é o padding. Em cima e
     embaixo, quem dá a margem são as linhas vazias da moldura (repetidas em
     cada folha impressa). */
  .folha{width:210mm;margin:12px auto;background:#fff;padding:0 10mm;
    box-shadow:0 2px 14px rgba(0,0,0,.18);font-size:13px;line-height:1.35}
  body.paisagem .folha{width:297mm}
  table.moldura{width:100%;border-collapse:collapse}
  table.moldura > thead > tr > td, table.moldura > tfoot > tr > td{height:10mm;padding:0}
  table.moldura > tbody > tr > td{padding:0}
  .folha-in{padding:0}
  .cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0B4EA2;padding-bottom:6px;margin-bottom:8px}
  .cab img{height:42px}
  .cab h1{flex:1;margin:0;font-size:1.45em;color:#0B4EA2;text-align:center}
  .cab .quando{font-size:.72em;color:#555;text-align:right;line-height:1.3}
  @media print{
    html,body{background:#fff}
    .barra-imp{display:none}
    .folha,body.paisagem .folha{margin:0;box-shadow:none;width:auto}
  }
  ${css}
</style>
</head>
<body class="${paisagem ? "paisagem" : ""}" data-tipo="${esc(tipo)}">
<div class="barra-imp">
  <button type="button" id="bt-imprimir">Imprimir</button>
  <span class="orient" role="group" aria-label="Orientação do papel">
    <button type="button" data-orient="v" aria-pressed="${paisagem ? "false" : "true"}">Vertical</button>
    <button type="button" data-orient="h" aria-pressed="${paisagem ? "true" : "false"}">Horizontal</button>
  </span>
  <span>${esc(titulo)}</span>
  <span class="aviso-folha" hidden>O conteúdo passou de uma folha${umaFolha ? " — na horizontal ele tem menos altura; experimente a vertical" : ""}.</span>
</div>
<div class="folha"${umaFolha ? " data-uma-folha" : ""}><table class="moldura" role="presentation">
  <thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot>
  <tbody><tr><td><div class="folha-in">${corpo}</div></td></tr></tbody>
</table></div>
${SCRIPT_PAGINA}
</body>
</html>`;
}

const cabecalho = (titulo, agora) => `<div class="cab">
  <img src="/assets/img/logo-original.svg" alt="Forms Fitness">
  <h1>${esc(titulo)}</h1>
  <div class="quando">${esc(U.dataHoraBR(agora))}</div>
</div>`;

/* ==========================================================================
   A FICHA DO ALUNO

   Reproduz a ficha que a academia imprime hoje (código, atividade, horário,
   foto, filiação, responsável) e acrescenta, no fim, as condições da
   matrícula — o texto que a direção edita em Configurações. Uma lauda.
   ========================================================================== */
const CSS_FICHA = `
  .f-topo{display:flex;gap:8px}
  .f-grade{flex:1;display:grid;grid-template-columns:repeat(12,1fr);gap:0;border-top:1px solid #9aa}
  .f-grade.cheia{border-top:0}
  /* Alturas em em, não em px: acompanham a letra quando o ajuste de uma
     folha a reduz — na horizontal, com px, as caixas não encolhiam e a
     ficha não cabia nem com a letra no mínimo. */
  .c{border:1px solid #9aa;border-top:0;margin-left:-1px;padding:2px 5px 3px;min-height:2.6em}
  .c:first-child{margin-left:0}
  .c small{display:block;font-size:.7em;color:#445;text-transform:none;letter-spacing:.01em}
  .c b{display:block;font-size:.95em;font-weight:600;min-height:1.2em;text-transform:uppercase;word-break:break-word}
  .c.alto{min-height:4em}
  .foto{width:30mm;height:40mm;border:1px solid #9aa;display:flex;align-items:center;justify-content:center;
    overflow:hidden;background:#f3f6f9;color:#789;font-size:.75em;text-align:center}
  .foto img{width:100%;height:100%;object-fit:cover}
  .s1{grid-column:span 1}.s2{grid-column:span 2}.s3{grid-column:span 3}.s4{grid-column:span 4}
  .s5{grid-column:span 5}.s6{grid-column:span 6}.s7{grid-column:span 7}.s8{grid-column:span 8}
  .s9{grid-column:span 9}.s10{grid-column:span 10}.s11{grid-column:span 11}.s12{grid-column:span 12}
  .f-sec{margin:6px 0 0;font-size:.75em;font-weight:700;color:#0B4EA2;text-transform:uppercase;letter-spacing:.06em}
  .condicoes{margin-top:10px;font-size:.86em;text-align:justify}
  .condicoes h2,.condicoes h3{font-size:1.02em;margin:0 0 4px;text-align:center}
  .condicoes ol{margin:0;padding-left:1.4em}
  .condicoes li{margin:0 0 2px}
  .condicoes p{margin:4px 0}
  .ass-ficha{margin-top:26px;width:60%}
  .ass-ficha .traco{display:block;border-top:1px solid #111;margin-bottom:3px}
  .ass-ficha small{font-size:.8em}
  /* As atividades como na ficha do sistema antigo: atividade, os dias
     marcados e o horário. */
  table.f-ativ{width:100%;border-collapse:collapse;margin-top:6px;font-size:.9em}
  table.f-ativ th{font-size:.78em;font-weight:700;color:#445;text-align:left;border:1px solid #9aa;padding:2px 5px;background:#f3f6f9}
  table.f-ativ td{border:1px solid #9aa;padding:3px 5px;text-transform:uppercase}
  table.f-ativ th.d,table.f-ativ td.d{text-align:center;width:9mm;padding:2px}
`;

function fichaHTML({ aluno, matriculas = [], condicoes, agora, temFoto }) {
  const c = (rotulo, valor, span, extra = "") =>
    `<div class="c ${span}${extra}"><small>${esc(rotulo)}</small><b>${esc(valor ?? "")}</b></div>`;
  const idade = U.idade(aluno.nascimento);
  const menor = U.ehMenor(aluno.nascimento);

  const corpo = `${cabecalho("Ficha do Aluno", agora)}
  <div class="f-topo">
    <div class="f-grade">
      ${c("Código", U.codigoFormatado(aluno.codigo) || "pré-matrícula", "s2")}
      ${c("Nome", aluno.nome, "s10")}
      ${c("Dt. matrícula", U.dataBR(aluno.data_matricula), "s4")}
      ${c("Status", aluno.status === "pendente" ? "Pré-matrícula" : aluno.status, "s4")}
      ${c("Mensalidade", aluno.mensalidade ? U.reais(aluno.mensalidade) : "", "s4")}
      ${c("Dt. nasc.", U.dataBR(aluno.nascimento), "s3")}
      ${c("Idade", idade === null ? "" : String(idade), "s2")}
      ${c("Sexo", aluno.sexo, "s3")}
      ${c("Estado civil", aluno.estado_civil, "s4")}
      ${c("RG", aluno.rg, "s4")}
      ${c("Emissor", aluno.rg_emissor, "s3")}
      ${c("CPF", U.formatarCpf(aluno.cpf), "s5")}
    </div>
    <div class="foto">${temFoto ? `<img src="/admin/arquivo/${Number(aluno.foto_id)}" alt="Foto do aluno">` : "sem foto"}</div>
  </div>
  ${tabelaAtividades(matriculas, aluno.horario_desejado)}
  <div class="f-grade cheia">
    ${c("E-mail", aluno.email, "s6")}
    ${c("Profissão", aluno.profissao, "s3")}
    ${c("Nacionalidade", aluno.nacionalidade, "s3")}
    ${c("Observação", aluno.observacao, "s12", " alto")}
    ${c("Endereço", [aluno.logradouro, aluno.complemento].filter(Boolean).join(", "), "s6")}
    ${c("Nº", aluno.numero, "s1")}
    ${c("CEP", aluno.cep, "s2")}
    ${c("Fone 1", aluno.fone1, "s3")}
    ${c("Bairro", aluno.bairro, "s4")}
    ${c("Cidade", aluno.cidade, "s4")}
    ${c("UF", aluno.uf, "s1")}
    ${c("Fone 2", aluno.fone2, "s3")}
    ${c("Pai", aluno.pai, "s6")}
    ${c("Mãe", aluno.mae, "s6")}
  </div>
  <p class="f-sec">Responsável${menor ? " (aluno menor de idade)" : ""}</p>
  <div class="f-grade">
    ${c("Nome do responsável", aluno.resp_nome, "s6")}
    ${c("CPF", U.formatarCpf(aluno.resp_cpf), "s3")}
    ${c("RG", aluno.resp_rg, "s2")}
    ${c("Emissor", aluno.resp_rg_emissor, "s1")}
    ${c("Fone resp.", aluno.resp_fone, "s3")}
    ${c("Data nasc.", U.dataBR(aluno.resp_nascimento), "s2")}
    ${c("End. trabalho", aluno.resp_end_trabalho, "s4")}
    ${c("Fone trabalho", aluno.resp_fone_trabalho, "s3")}
  </div>
  <div class="condicoes">${condicoes || ""}</div>
  <div class="ass-ficha"><span class="traco"></span><small>Assinatura do(a) aluno(a) ou responsável legal</small></div>`;

  return pagina({ titulo: `Ficha — ${aluno.nome}`, corpo, css: CSS_FICHA, umaFolha: true, tipo: "ficha" });
}

/* Seg a Sáb, como na ficha antiga; domingo só aparece se alguém tiver aula
   nele. */
function tabelaAtividades(matriculas, desejado) {
  const ms = matriculas || [];
  const cols = ms.some((m) => (m.dias || []).includes(0)) ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];
  const linhas = ms.length ? ms.map((m) => `<tr><td>${esc(m.atividade_nome)}</td>
      ${cols.map((d) => `<td class="d">${(m.dias || []).includes(d) ? "X" : ""}</td>`).join("")}
      <td>${esc(m.horario)}${m.horario_fim ? "–" + esc(m.horario_fim) : ""}</td><td>${esc(m.professor || "")}</td>
      <td>${m.mensalidade ? esc(U.reais(m.mensalidade)) : ""}</td></tr>`).join("")
    : `<tr><td colspan="${cols.length + 4}">${desejado ? `Pedido no site: ${esc(desejado)}` : "Nenhuma atividade cadastrada."}</td></tr>`;
  return `<table class="f-ativ"><thead><tr><th>Atividade</th>${cols.map((d) => `<th class="d">${U.DIAS_CURTO[d]}</th>`).join("")}
    <th>Horário</th><th>Professor</th><th>Mensalidade</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

/* ==========================================================================
   O CONTRATO

   `contratoCorpo` gera o HTML que é GRAVADO no histórico — a partir daí ele
   não muda mais. `contratoPagina` só embrulha esse HTML para imprimir.
   ========================================================================== */
/* DENSIDADE DE WORD, não de página web. A primeira versão usava entrelinha
   1,35 e margens folgadas: com ~1.000 palavras, o contrato dava 294 mm para
   277 disponíveis MESMO com a letra no piso — o ajuste automático não tinha
   de onde tirar. O .doc da academia cabe numa lauda porque o Word imprime
   com entrelinha ~1,15 e quase nenhum respiro entre parágrafos; aqui é igual. */
const CSS_CONTRATO = `
  .folha[data-uma-folha]{font-size:11.5px;line-height:1.2}
  .contrato{text-align:justify}
  .contrato h2{font-size:1.02em;text-align:center;margin:0 0 3px;text-transform:uppercase}
  .contrato h3{font-size:.94em;text-align:center;margin:4px 0 1px;text-transform:uppercase}
  .contrato p{margin:0 0 1.5px}
  .contrato ol,.contrato ul{margin:0 0 2px;padding-left:1.4em}
  .contrato .logo-contrato{display:block;height:32px;margin:0 auto 3px}
  .assinaturas{margin-top:6px;page-break-inside:avoid}
  .local-data{text-align:right;margin:0 0 14px}
  .ass-contratante{width:58%;margin:0 0 6px}
  /* O CSS DAQUI RENDERIZA CONTRATOS DO PASSADO. O HTML de cada contrato é
     congelado no banco quando é gerado; o CSS, não — é aplicado na hora de
     imprimir. Então uma classe que saiu da marcação NOVA não pode sair
     daqui: os contratos antigos ainda a usam. ".traco" é a da 1ª versão. */
  .ass-contratante .traco{display:block;border-top:1px solid #111;margin-bottom:1px}
  /* O "X" fica EM CIMA do traço, onde se assina — como no contrato em Word. */
  .ass-contratante .linha-x{display:block;border-bottom:1px solid #111;padding-top:12px;margin-bottom:1px;line-height:1}
  .ass-contratante b{display:block;text-transform:uppercase}
  .ass-contratante small{font-size:.85em;color:#444}
  .ass-img{display:block;width:100%;max-height:30mm;object-fit:contain}
  .ass-linhas{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:16px;font-size:.88em;text-align:center}
  .ass-linhas .traco{display:block;border-top:1px solid #111;margin-bottom:1px}
`;

function contratoCorpo({ modelo, dados }) {
  const miolo = renderizar(modelo, dados.valores, dados.condicoes);
  return `<div class="contrato">
  <img class="logo-contrato" src="/assets/img/logo-original.svg" alt="Forms Fitness">
  ${miolo}
</div>`;
}

const contratoPagina = (html, titulo) =>
  pagina({ titulo, corpo: html, css: CSS_CONTRATO, umaFolha: true, tipo: "contrato" });

/* ==========================================================================
   OS RELATÓRIOS — listagens em tabela

   Paisagem quando a tabela é larga. Não têm limite de uma folha: uma lista
   de 300 alunos ocupa o que precisar, e o cabeçalho da tabela se repete em
   cada folha impressa (thead com display:table-header-group).
   ========================================================================== */
const CSS_RELATORIO = `
  .rel-info{font-size:.85em;color:#445;margin:0 0 8px}
  table.rel{width:100%;border-collapse:collapse;font-size:.88em}
  table.rel th{background:#eaf2fb;color:#0B4EA2;text-align:left;font-weight:700;border:1px solid #b9c7d6;padding:4px 6px}
  table.rel td{border:1px solid #cfd8e2;padding:4px 6px;vertical-align:top}
  table.rel tr:nth-child(even) td{background:#f8fafc}
  table.rel td.n{text-align:right;white-space:nowrap}
  table.rel thead{display:table-header-group}
  table.rel tr{page-break-inside:avoid}
  .vazio{padding:20px;text-align:center;color:#667}
`;

function relatorioHTML({ titulo, info, colunas, linhas, agora, paisagem = false }) {
  const corpo = `${cabecalho(titulo, agora)}
  <p class="rel-info">${esc(info)}</p>
  ${linhas.length ? `<table class="rel">
    <thead><tr>${colunas.map(([rot]) => `<th>${esc(rot)}</th>`).join("")}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${colunas.map(([, campo, num]) =>
      `<td${num ? ' class="n"' : ""}>${esc(l[campo] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>` : `<p class="vazio">Nada para listar.</p>`}`;
  return pagina({ titulo, corpo, css: CSS_RELATORIO, paisagem, tipo: "relatorio" });
}

/* ==========================================================================
   A AGENDA IMPRESSA — para o mural e para entregar aos alunos

   É um documento PÚBLICO (vai para a mão de todo mundo): só mostra o que o
   aluno precisa — dias de aula, feriados e atividades. A data que perdeu
   para outra no mesmo dia (o feriado vencido por um "dia de aula") nem
   aparece: no mural, "riscado" confunde mais que ajuda.
   ========================================================================== */
const CSS_AGENDA = `
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .ag-sub{text-align:center;margin:0 0 8px;font-size:1.05em;color:#0B4EA2;font-weight:700}
  .ag-grade{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
  .ag-sem{text-align:center;font-weight:700;font-size:.8em;color:#445;text-transform:uppercase;padding:2px 0}
  .ag-dia{min-height:30mm;border:1px solid #d6dee7;border-radius:6px;padding:3px 5px;background:#fff}
  body.paisagem .ag-dia{min-height:17mm}
  .ag-dia .n{font-weight:800;font-size:1.05em;color:#556}
  .ag-dia small{display:block;font-size:.72em;line-height:1.2;font-weight:700;margin-top:1px}
  .ag-dia.fora{border-color:transparent;background:transparent}
  .ag-dia.aula{background:#dcecfb;border-color:#b9d8f5}.ag-dia.aula .n,.ag-dia.aula small{color:#0B4EA2}
  .ag-dia.feriado{background:#fbdde2;border-color:#f3b8c2}.ag-dia.feriado .n,.ag-dia.feriado small{color:#8f2340}
  .ag-dia.atividade{background:#fdf1c7;border-color:#f0d982}.ag-dia.atividade .n,.ag-dia.atividade small{color:#7a5700}
  .ag-leg{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin:8px 0 4px;font-size:.85em;font-weight:700;color:#445}
  .ag-leg span::before{content:"";display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1px solid #ccd}
  .ag-leg .l-aula::before{background:#dcecfb;border-color:#b9d8f5}
  .ag-leg .l-feriado::before{background:#fbdde2;border-color:#f3b8c2}
  .ag-leg .l-atividade::before{background:#fdf1c7;border-color:#f0d982}
  .ag-datas{margin:6px 0 0;padding:0;list-style:none;columns:2;column-gap:18px;font-size:.88em}
  .ag-datas li{break-inside:avoid;margin:0 0 2px}
  .ag-rodape{margin-top:8px;border-top:1px solid #d6dee7;padding-top:5px;text-align:center;font-size:.82em;color:#445}
`;
const CATEGORIA_TXT = { feriado: "feriado — sem aula", aula: "dia de aula", atividade: "atividade" };

function agendaHTML({ ano, mes, dias, diasAula, contato = {}, agora }) {
  const titulo = `Agenda de ${U.MESES[mes - 1]} de ${ano}`;
  const legenda = (x) => {
    const vale = x.eventos.filter((v) => v.vale && v.categoria === x.cor).map((v) => v.nome);
    return vale.length ? vale.join(" · ") : x.cor === "aula" ? "aula" : "";
  };
  const datas = dias.flatMap((x) => x.eventos.filter((v) => v.vale).map((v) =>
    `<li><b>${String(x.dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}</b> — ${esc(v.nome)} <small>(${CATEGORIA_TXT[v.categoria] || v.categoria})</small></li>`));
  const rodape = [contato.site, contato.instagram, contato.whatsapp && `WhatsApp ${contato.whatsapp}`].filter(Boolean).map(esc).join(" · ");
  const corpo = `${cabecalho(titulo, agora)}
  <p class="ag-sub">Aulas às ${esc(U.diasPorExtenso(diasAula))}</p>
  <div class="ag-grade">
    ${U.DIAS_CURTO.map((d) => `<div class="ag-sem">${d}</div>`).join("")}
    ${'<div class="ag-dia fora"></div>'.repeat(dias[0].semana)}
    ${dias.map((x) => `<div class="ag-dia${x.cor ? " " + x.cor : ""}"><span class="n">${x.dia}</span>${legenda(x) ? `<small>${esc(legenda(x))}</small>` : ""}</div>`).join("")}
  </div>
  <div class="ag-leg"><span class="l-aula">Dia de aula</span><span class="l-feriado">Feriado (sem aula)</span><span class="l-atividade">Outra atividade</span></div>
  ${datas.length ? `<ul class="ag-datas">${datas.join("")}</ul>` : ""}
  ${rodape ? `<p class="ag-rodape">${rodape}</p>` : ""}`;
  return pagina({ titulo, corpo, css: CSS_AGENDA, paisagem: true, tipo: "agenda" });
}

module.exports = {
  MARCADORES, BLOCOS, marcadoresDesconhecidos, renderizar, dadosDoContrato,
  fichaHTML, contratoCorpo, contratoPagina, relatorioHTML, agendaHTML, pagina, esc,
};
