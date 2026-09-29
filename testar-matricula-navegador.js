/* ==========================================================================
   testar-matricula-navegador.js — a matrícula aceita a foto do celular (1.30.1)

   POR QUE ESTA SUÍTE EXISTE. Em 29/09/2026 chegou um vídeo de uma pessoa
   tentando se matricular: ficha inteira preenchida, os quatro quadrinhos
   marcados, e o site respondia "Falta preencher um campo obrigatório". A foto
   do celular tinha 8,2 MB, e um teto de 4 MB — conferido ANTES de a foto ser
   reduzida no aparelho — marcava o campo como inválido. A mensagem ainda
   mentia: o campo estava preenchido.

   Nenhuma prova anterior pegou isso, porque todas mandavam arquivos pequenos
   direto para o servidor. O defeito só existia no NAVEGADOR, com arquivo de
   celular de verdade. Esta suíte faz o caminho da pessoa: abre a página num
   Chrome, põe uma foto de mais de 8 MB, preenche a ficha e aperta Enviar.

   Ela sobe o PRÓPRIO servidor, com banco temporário (FF_DATA): nada do banco
   da academia é tocado, e as páginas do site não são republicadas. Sem Chrome
   na máquina, a parte do navegador é pulada e diz que foi; o resto confere o
   código.

     node testar-matricula-navegador.js
   ========================================================================== */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORTA = Number(process.env.PORTA_TESTE_MAT) || 5331;
const BASE = `http://127.0.0.1:${PORTA}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-matricula-nav-"));

let ok = 0; const falhas = [];
function certo(nome, cond, detalhe = "") {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}

async function pedir(metodo, caminho, { corpo, cookie } = {}) {
  const r = await fetch(BASE + caminho, { method: metodo,
    headers: { ...(corpo ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined });
  let j = {}; try { j = await r.clone().json(); } catch { /* não é JSON */ }
  return { status: r.status, j, cab: r.headers };
}

(async () => {
  console.log("\n=== A matrícula no navegador, com foto de celular ===\n");

  /* --------------------------------------------------------------------
     1. O CÓDIGO: o teto certo para cada coisa
     -------------------------------------------------------------------- */
  const js = fs.readFileSync(path.join(__dirname, "assets", "js", "main.js"), "utf8");
  const pagina = fs.readFileSync(path.join(__dirname, "src", "matricula.html"), "utf8");
  certo("o teto de 4 MB vale só para o PDF (que sobe como veio)",
    js.includes("const TETO_PDF = 4 * 1024 * 1024") && js.includes("const teto = ehPdf ? TETO_PDF : TETO_IMAGEM;"));
  certo("não existe mais teto único conferido antes da redução da foto", !js.includes("TETO_ARQUIVO"));
  certo("campo PREENCHIDO e recusado mostra o motivo, e não \"falta preencher\"",
    js.includes("el.validity.customError") && js.includes("recusado ? recusado.validationMessage"));
  certo("foto que não abre no aparelho não vira \"sem conexão\"",
    js.includes("Não consegui abrir a foto do aluno neste aparelho"));
  certo("a ajuda do comprovante diz que o limite é só do PDF",
    pagina.includes("(o PDF, até 4 MB)") && !pagina.includes("o PDF do banco — até 4 MB"));

  /* --------------------------------------------------------------------
     2. O SERVIDOR PRÓPRIO, com uma turma aberta no site
     -------------------------------------------------------------------- */
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000", FF_ENV: path.join(TMP, "vazio.env") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));
  try {
    let vivo = false;
    for (let i = 0; i < 60 && !vivo; i++) { try { await fetch(BASE + "/"); vivo = true; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    if (!vivo) throw new Error("o servidor não subiu:\n" + log.slice(-800));
    /* Banco novo: a senha é a da semente — a do banco de ENSAIO, que morre no fim. */
    const entrada = await pedir("POST", "/api/login", { corpo: { password: "forms-admin" } });
    const A = (entrada.cab.get("set-cookie") || "").split(";")[0];
    const natacao = (await pedir("GET", "/api/gestao/atividades", { cookie: A })).j.atividades.find((a) => a.nome === "Natação");
    const turma = await pedir("POST", "/api/gestao/turmas", { cookie: A, corpo: { atividade_id: natacao.id, horario: "10:00", publica: true } });
    certo("uma turma aberta no site para o ensaio", turma.status === 200);

    /* ------------------------------------------------------------------
       3. O CAMINHO DA PESSOA, num Chrome de verdade
       ------------------------------------------------------------------ */
    const CHROME = [process.env.CHROME,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((c) => { try { return fs.existsSync(c); } catch { return false; } });
    if (!CHROME) {
      console.log("  · navegador pulado: não achei o Chrome (defina CHROME=<caminho>)");
    } else {
      const foto = await noNavegador(CHROME, false);
      certo("foto de celular de mais de 8 MB é aceita no campo", foto.fotoValida && parseFloat(foto.tamanhoFoto) > 8, foto.tamanhoFoto);
      certo("…e a matrícula ENTRA (\"Matrícula recebida!\")", foto.recebida, foto.erroNaTela || "");
      const pdf = await noNavegador(CHROME, true);
      certo("PDF acima de 4 MB continua barrado", !pdf.comprovanteValido && !pdf.recebida);
      certo("…com a mensagem que diz o que fazer, ao lado do arquivo",
        /O PDF tem 5[.]0 MB e o limite é 4 MB/.test(pdf.avisoComprovante), pdf.avisoComprovante);
      certo("…e a mesma no envio — nada de \"falta preencher\"",
        /limite é 4 MB/.test(pdf.erroNaTela || "") && !/Falta preencher/.test(pdf.erroNaTela || ""), pdf.erroNaTela);
    }
  } catch (e) {
    falhas.push("a suíte quebrou: " + e.message);
    console.log("  QUEBROU:", e.message);
  } finally {
    servidor.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temporário */ }
  }

  console.log(`\n  ${ok} passaram, ${falhas.length} falharam`);
  falhas.forEach((f) => console.log("   ✖ " + f));
  process.exit(falhas.length ? 1 : 0);
})();

/* Abre a matrícula num Chrome headless pela porta de depuração (o Node já traz
   WebSocket), põe a foto grande — 4000×3000 com ruído, que não comprime e
   passa de 8 MB como a do vídeo —, preenche a ficha de um adulto e envia. */
async function noNavegador(CHROME, pdfGrande) {
  const DEP = PORTA + 1000;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "forms-nav-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEP}`,
    `--user-data-dir=${perfil}`, "--window-size=412,900", "about:blank"], { stdio: "ignore" });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let alvos = null;
    for (let i = 0; i < 40 && !alvos; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${DEP}/json/list`)).json(); } catch { await espera(250); } }
    const ws = new WebSocket(alvos.find((a) => a.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let seq = 0; const esp = new Map();
    ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && esp.has(m.id)) { esp.get(m.id)(m); esp.delete(m.id); } });
    const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    await cdp("Page.navigate", { url: `${BASE}/matricula/` });
    await espera(2500);
    const r = await cdp("Runtime.evaluate", { awaitPromise: true, returnByValue: true, timeout: 120000, expression: `(async () => {
      const $ = (s) => document.querySelector(s);
      const v = (s, x) => { const e = $(s); e.value = x; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); };
      const c = document.createElement("canvas"); c.width = 4000; c.height = 3000;
      const g = c.getContext("2d"); const img = g.createImageData(4000, 3000);
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i+1] = Math.random() * 255; img.data[i+2] = Math.random() * 255; img.data[i+3] = 255; }
      g.putImageData(img, 0, 0);
      const foto = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.98));
      const comp = ${pdfGrande
        ? `new Blob([new TextEncoder().encode("%PDF-1.4"), new Uint8Array(5 * 1024 * 1024)], { type: "application/pdf" })`
        : `await new Promise((ok) => { const k = document.createElement("canvas"); k.width = 600; k.height = 400; const q = k.getContext("2d"); q.fillStyle = "#fff"; q.fillRect(0, 0, 600, 400); k.toBlob(ok, "image/jpeg", 0.9); })`};
      const poe = (sel, blob, nome) => { const dt = new DataTransfer(); dt.items.add(new File([blob], nome, { type: blob.type })); $(sel).files = dt.files; $(sel).dispatchEvent(new Event("change", { bubbles: true })); };
      poe("#m-foto", foto, "foto-do-celular.jpg");
      poe("#m-comprovante", comp, ${pdfGrande ? `"comprovante.pdf"` : `"print-do-banco.jpg"`});
      const r = { tamanhoFoto: (foto.size / 1048576).toFixed(1), fotoValida: $("#m-foto").validity.valid,
        comprovanteValido: $("#m-comprovante").validity.valid, avisoComprovante: $("#mat-comp-nome").textContent };
      await new Promise((ok) => setTimeout(ok, 800));
      const t = $("#m-turma"); t.selectedIndex = 1; t.dispatchEvent(new Event("change", { bubbles: true }));
      v("#m-nome", "Zz Qa Foto Grande"); v("#m-nasc", "1990-05-10"); v("#m-sexo", "Masculino"); v("#m-mae", "Zz Qa Mae");
      v("#m-cpf", "529.982.247-25"); v("#m-whats", "(81) 99999-0005");
      v("#m-cep", "55038-270"); v("#m-rua", "Avenida Caruaru"); v("#m-num", "579"); v("#m-bairro", "Boa Vista"); v("#m-cidade", "Caruaru"); v("#m-uf", "PE");
      document.querySelectorAll(".mat-check input").forEach((x) => { x.checked = true; });
      $(".mat-enviar").click();
      for (let i = 0; i < 60; i++) { await new Promise((ok) => setTimeout(ok, 500)); if (!$("#mat-ok").hidden || !$("#mat-erro").hidden) break; }
      return { ...r, recebida: !$("#mat-ok").hidden, erroNaTela: $("#mat-erro").hidden ? null : $("#mat-erro").textContent };
    })()` });
    ws.close();
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result.result.value;
  } finally {
    chrome.kill(); await espera(400);
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
  }
}
