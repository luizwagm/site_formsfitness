/* ==========================================================================
   gestao/carne.js — o carnê impresso (1.26.0)

   Três parcelas por folha A4, cada uma com o RECIBO DO PAGADOR à esquerda
   (fica com o aluno) e a FICHA DE COMPENSAÇÃO à direita (vai ao caixa), com o
   QR Code Pix dentro das instruções — o boleto híbrido: paga-se com o código
   de barras em qualquer banco ou com o Pix pelo celular.

   O PAPEL É O QUE VALE. Tudo o que o leitor do caixa precisa está em
   milímetros (ver `barrasSVG` em gestao/boleto.js), e a ordem e os nomes dos
   campos seguem a ficha de compensação da FEBRABAN — é o que o operador de
   caixa procura com os olhos, e um carnê "bonito" que ele não reconhece vira
   fila.

   O PDF OFICIAL DO SICREDI continua disponível por boleto no painel: é a
   segunda via que vale se este carnê não servir por qualquer motivo.
   ========================================================================== */
"use strict";

const B = require("./boleto");
const U = require("./util");
const { qrSVG } = require("./qr");
const { pagina, esc } = require("./documentos");

const CSS = `
  .folha{padding:0 10mm;font-size:9px;line-height:1.2}
  .parcela{display:flex;gap:3mm;height:90mm;padding:3mm 0;border-bottom:1px dashed #777;position:relative;
    break-inside:avoid;page-break-inside:avoid}
  .parcela:last-child{border-bottom:0}
  .parcela .corte{position:absolute;left:-6mm;bottom:-2.2mm;font-size:11px;color:#777;background:#fff}
  .canhoto{width:44mm;border-right:1px dashed #777;padding-right:3mm;display:flex;flex-direction:column}
  .ficha{flex:1;display:flex;flex-direction:column;min-width:0}
  .topo{display:flex;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:1mm;gap:2mm}
  .banco{font-weight:700;font-size:15px;letter-spacing:-.3px}
  .cod{font-weight:700;font-size:14px;border-left:2px solid #000;border-right:2px solid #000;padding:0 2mm}
  .linha{flex:1;text-align:right;font-weight:700;font-size:11.5px;letter-spacing:.2px;white-space:nowrap;font-family:"Courier New",monospace}
  table.g{width:100%;border-collapse:collapse;table-layout:fixed}
  table.g td{border:1px solid #000;padding:.5mm 1mm;vertical-align:top;overflow:hidden}
  .r{display:block;font-size:6px;text-transform:uppercase;color:#333;letter-spacing:.2px}
  .v{display:block;font-size:9px;min-height:3mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .v.dir{text-align:right}.v.forte{font-weight:700}
  .direita{width:36mm}
  .instr{position:relative;height:25mm}
  .instr .txt{padding-right:24mm;font-size:8px;line-height:1.3}
  .instr .qr-caixa{position:absolute;right:1mm;top:1mm;width:22mm;text-align:center;font-size:6px}
  .instr .qr-caixa svg{display:block;width:21mm;height:21mm;margin:0 auto}
  .pagador .v{white-space:normal;height:auto}
  .barras-caixa{display:flex;justify-content:space-between;align-items:flex-start;padding-top:1.5mm}
  .barras-caixa .aut{font-size:6.5px;text-align:right;text-transform:uppercase}
  .canhoto .item{border-bottom:1px solid #000;padding:.6mm 0}
  .canhoto .item .v{white-space:normal}
  .canhoto .titulo{font-weight:700;font-size:8px;margin:1mm 0;text-transform:uppercase}
  .canhoto .aut{margin-top:auto;border-top:1px solid #000;font-size:6px;text-transform:uppercase;padding-top:.5mm;height:10mm}
  .tarja{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .tarja span{transform:rotate(-12deg);font-size:30px;font-weight:700;color:rgba(200,0,0,.28);border:4px solid rgba(200,0,0,.28);
    padding:2mm 6mm;text-transform:uppercase;white-space:nowrap}
  .vazio{padding:20mm 0;text-align:center;font-size:14px}
  .dica-tela{margin:4mm 0 0;padding:2mm 3mm;background:#fff3cd;color:#6b4a00;border-radius:4px;font-size:12px}
  @media print{.dica-tela{display:none}}
`;

const reais = (c) => U.reais(c);
const dataBR = (iso) => U.dataBR(String(iso || "").slice(0, 10));

function carneHTML({ aluno, boletos, cfg, beneficiario, pagadorNome, pagadorDocumento, endereco }) {
  const teste = cfg.ambiente !== "producao";
  const agencia = `${cfg.cooperativa}.${cfg.posto}.${cfg.beneficiario}`;
  const total = boletos.length;

  const parcela = (b, i) => {
    const n = `${String(i + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
    const juros = reais(b.juros_dia);
    const comp = `${U.MESES[Number(b.competencia.slice(5, 7)) - 1]}/${b.competencia.slice(0, 4)}`;
    const doc = U.formatarCpf(b.pagador_documento);
    const nn = B.nossoNumeroFormatado(b.nosso_numero);
    const cel = (rotulo, valor, extra = "") => `<span class="r">${esc(rotulo)}</span><span class="v ${extra}">${valor}</span>`;
    return `
<section class="parcela">
  ${teste ? '<div class="tarja"><span>Teste — não pague</span></div>' : ""}
  <aside class="canhoto">
    <div class="topo"><span class="banco">Sicredi</span><span class="cod">748-X</span></div>
    <p class="titulo">Recibo do pagador</p>
    <div class="item">${cel("Parcela", `<b>${n}</b> · ${esc(comp)}`)}</div>
    <div class="item">${cel("Vencimento", `<b>${esc(dataBR(b.vencimento))}</b>`)}</div>
    <div class="item">${cel("(=) Valor do documento", `<b>${esc(reais(b.valor))}</b>`)}</div>
    <div class="item">${cel("Nosso número", esc(nn))}</div>
    <div class="item">${cel("Agência / Código do beneficiário", esc(agencia))}</div>
    <div class="item">${cel("Beneficiário", esc(beneficiario.nome))}</div>
    <div class="item">${cel("Pagador", esc(b.pagador_nome))}</div>
    <div class="item">${cel("Aluno", `${esc(U.codigoFormatado(aluno.codigo))} · ${esc(aluno.nome)}`)}</div>
    <div class="aut">Autenticação mecânica</div>
  </aside>
  <div class="ficha">
    <div class="topo"><span class="banco">Sicredi</span><span class="cod">748-X</span>
      <span class="linha">${esc(B.linhaFormatada(b.linha_digitavel))}</span></div>
    <table class="g">
      <tr><td colspan="5">${cel("Local de pagamento", "Pagável em qualquer banco até o vencimento. Pague também com Pix.")}</td>
        <td class="direita">${cel("Vencimento", esc(dataBR(b.vencimento)), "dir forte")}</td></tr>
      <tr><td colspan="5">${cel("Beneficiário", `${esc(beneficiario.nome)}${beneficiario.documento ? ` — CNPJ ${esc(beneficiario.documento)}` : ""}`)}</td>
        <td class="direita">${cel("Agência / Código do beneficiário", esc(agencia), "dir")}</td></tr>
      <tr><td>${cel("Data do documento", esc(dataBR(b.criado_em)))}</td><td>${cel("Nº do documento", esc(b.seu_numero))}</td>
        <td>${cel("Espécie doc.", "DS")}</td><td>${cel("Aceite", "N")}</td><td>${cel("Data processamento", esc(dataBR(b.criado_em)))}</td>
        <td class="direita">${cel("Nosso número", esc(nn), "dir")}</td></tr>
      <tr><td>${cel("Uso do banco", "")}</td><td>${cel("Carteira", "1")}</td><td>${cel("Espécie", "R$")}</td>
        <td>${cel("Quantidade", "")}</td><td>${cel("Valor", "")}</td>
        <td class="direita">${cel("(=) Valor do documento", esc(reais(b.valor)), "dir forte")}</td></tr>
      <tr><td colspan="5" rowspan="3" class="instr">
          <span class="r">Instruções (texto de responsabilidade do beneficiário)</span>
          <div class="txt">
            Mensalidade de ${esc(comp)} — parcela ${n}.<br>
            Após o vencimento, cobrar multa de ${B.MULTA_PERCENTUAL}% e juros de ${esc(juros)} ao dia
            (${B.JUROS_MES_PERCENTUAL}% ao mês).<br>
            Pague com Pix: abra o app do seu banco e aponte a câmera para o QR Code.
            ${teste ? "<br><b>AMBIENTE DE TESTE DO SICREDI — ESTE BOLETO NÃO VALE.</b>" : ""}
          </div>
          ${b.qr_code ? `<div class="qr-caixa">${qrSVG(b.qr_code, { lado: "21mm" })}Pix</div>` : ""}
        </td>
        <td class="direita">${cel("(−) Desconto / Abatimento", "")}</td></tr>
      <tr><td class="direita">${cel("(+) Mora / Multa", "")}</td></tr>
      <tr><td class="direita">${cel("(=) Valor cobrado", "")}</td></tr>
      <tr><td colspan="6" class="pagador">${cel("Pagador", `${esc(b.pagador_nome)} — CPF ${esc(doc)}${endereco ? `<br>${esc(endereco)}` : ""}`)}</td></tr>
    </table>
    <div class="barras-caixa">
      ${B.barrasSVG(b.codigo_barras)}
      <span class="aut">Autenticação mecânica<br><b>Ficha de compensação</b></span>
    </div>
  </div>
</section>`;
  };

  /* O código de barras está em milímetros, mas "ajustar à página" no diálogo
     de impressão encolhe tudo — e o leitor do caixa deixa de ler. O aviso só
     aparece na tela. */
  const dica = `<p class="dica-tela"><b>Ao imprimir:</b> escala <b>100%</b> ("Tamanho real"), papel A4, sem "ajustar à página" — senão o código de barras encolhe e o caixa não lê. Recorte na linha tracejada.</p>`;
  const corpo = boletos.length ? dica + boletos.map(parcela).join("")
    : `<p class="vazio">Nenhum boleto em aberto para imprimir.<br>Gere o carnê na tela do aluno, em <b>Boletos</b>.</p>`;
  return pagina({ titulo: `Carnê — ${aluno.nome} (${U.codigoFormatado(aluno.codigo)})`, corpo, css: CSS, tipo: "carne" });
}

module.exports = { carneHTML };
