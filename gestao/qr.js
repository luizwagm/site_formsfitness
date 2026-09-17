/* ==========================================================================
   gestao/qr.js — o QR Code Pix do boleto, em SVG (1.26.0)

   Vem do Alafcell Assistec, onde já está em produção. A biblioteca `qrcode`
   tem um gerador de SVG pronto, mas assíncrono; `create()` é síncrono e
   devolve só a matriz — o desenho é nosso: um caminho único, preto no branco.

   Nível `M` (cerca de 15% de correção): o que o Banco Central recomenda para
   Pix. Acima disso o código fica mais denso sem ganho no papel; abaixo, uma
   dobra no carnê já impede a leitura.
   ========================================================================== */
"use strict";

/* CARREGADO SÓ QUANDO USADO, E SEM DERRUBAR NADA. O deploy.sh trata falha do
   `npm install` como não fatal (o site sobe com o driver de reserva do banco).
   Um `require("qrcode")` no topo transformaria essa falha em site fora do ar
   na subida seguinte — por causa de um desenho no carnê. Sem a biblioteca, o
   carnê sai sem o QR (o código de barras continua valendo) e o log avisa. */
let QRCode;
function biblioteca() {
  if (QRCode === undefined) {
    try { QRCode = require("qrcode"); }
    catch { QRCode = null; console.error("  ✖ carnê: biblioteca qrcode ausente — rode npm ci --omit=dev (o QR Pix sai em branco)"); }
  }
  return QRCode;
}

function qrSVG(texto, { lado = "32mm", margem = 2, nivel = "M" } = {}) {
  const Q = biblioteca();
  if (!Q) return "";
  let q;
  try { q = Q.create(String(texto), { errorCorrectionLevel: nivel }); }
  catch { return ""; }               /* texto grande demais: melhor nada que quebrado */

  const n = q.modules.size;
  const d = q.modules.data;
  const total = n + margem * 2;
  let caminho = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (d[y * n + x]) caminho += `M${x + margem} ${y + margem}h1v1h-1z`;

  /* `crispEdges`: sem suavizar a borda dos módulos — QR borrado é QR que a
     câmera do banco não lê. */
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${lado}" height="${lado}"
    shape-rendering="crispEdges" role="img" aria-label="QR Code Pix"><rect width="${total}" height="${total}" fill="#fff"/>
    <path d="${caminho}" fill="#000"/></svg>`;
}

module.exports = { qrSVG };
