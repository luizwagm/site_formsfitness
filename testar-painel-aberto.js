/* ==========================================================================
   testar-painel-aberto.js — o painel aberto o dia inteiro (1.39.0)

   O PEDIDO
     "o cliente passa o dia com a tela do admin aberta na tela de alunos, para
     ver as matrículas novas em tempo real. Depois de muito tempo aberto a tela
     trava e ele não consegue mexer em nada."

   O QUE ERA
     A tela não travava: a SESSÃO acabava e a tela continuava desenhada,
     recusando cada clique sem dizer nada. Três caminhos levavam a isso:
       · as sessões moravam na memória do servidor — toda entrega (push na
         main reinicia o serviço) deslogava todo mundo;
       · o cookie vencia 12 h depois do LOGIN, mesmo com uso o dia todo;
       · depois de 12 h sem uso (de propósito), nada avisava.
     E um quarto, que não trava mas cala: a conexão do aviso em tempo real
     pode morrer sem fechar (computador dormiu, rede trocou).

   O que se prova aqui:
     1. reiniciar o servidor NÃO desloga: o clique abre a ficha, e o aviso em
        tempo real reconecta e atualiza a lista;
     2. o banco guarda o HASH do cookie, nunca o cookie; o cookie é renovado a
        cada uso; sair apaga a sessão e o cookie;
     3. a sessão que acaba com a tela aberta e uma ficha em edição: o painel
        percebe SOZINHO (sem clique), abre o "Sua sessão terminou" POR CIMA da
        ficha, e depois de entrar de novo a ficha continua com o que foi
        digitado e o aviso em tempo real volta;
     4. nenhum clique morre calado: erro de servidor vira aviso na tela;
     5. o vigia do silêncio: com batidas chegando, a conexão fica quieta; sem
        batidas, a página reconecta sozinha.

   Sobe o PRÓPRIO servidor com banco temporário (FF_DATA): nada do banco da
   academia é tocado. A senha usada é a semente de teste (forms-admin).

     node testar-painel-aberto.js
   ========================================================================== */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

/* 5347: longe das outras suítes (5311…5343). */
const PORTA = Number(process.env.PORTA_TESTE_PAINEL) || 5347;
const BASE = `http://127.0.0.1:${PORTA}`;
const DEP = PORTA + 1000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-painel-"));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0; const falhas = [];
function certo(nome, cond, detalhe = "") {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}

let servidor = null, log = "";
function subir(extra = {}) {
  servidor = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000", FF_ENV: path.join(TMP, "vazio.env"), ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));
  return (async () => {
    for (let i = 0; i < 80; i++) { try { await fetch(BASE + "/"); return; } catch { await espera(250); } }
    throw new Error("o servidor não subiu:\n" + log.slice(-800));
  })();
}
const derrubar = () => new Promise((r) => { if (!servidor || servidor.exitCode !== null) return r(); servidor.once("exit", r); servidor.kill(); });

(async () => {
  console.log("\n=== O painel aberto o dia inteiro (1.39.0) ===\n");
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "forms-painel-chrome-"));
  let chrome = null;
  try {
    await subir({ FF_SSE_BATIDA_MS: "1500" });
    const entrar = async () => {
      const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "forms-admin" }) });
      return { r, sid: ((r.headers.get("set-cookie") || "").match(/sid=([a-f0-9]+)/) || [])[1] };
    };
    const { sid } = await entrar();
    const me = (s) => fetch(BASE + "/api/me", { headers: { cookie: "sid=" + s } });

    /* ------------------------------------------------ 2. a sessão no banco */
    const { abrirBanco } = require("./db");
    const banco = abrirBanco(path.join(TMP, "data", "site.db"));
    const linhas = () => banco.prepare("SELECT hash, uid, visto FROM sessoes").all();
    certo("a sessão foi gravada no banco", linhas().length === 1);
    certo("o banco guarda o HASH do cookie, nunca o cookie",
      linhas()[0].hash === crypto.createHash("sha256").update(sid).digest("hex") && !linhas().some((l) => l.hash === sid));
    const r1 = await me(sid);
    certo("cada uso devolve o cookie com o prazo renovado", /sid=[a-f0-9]+;.*Max-Age=43200/.test(r1.headers.get("set-cookie") || ""),
      r1.headers.get("set-cookie") || "(sem Set-Cookie)");

    await derrubar(); await subir({ FF_SSE_BATIDA_MS: "1500" });
    certo("depois de reiniciar o servidor, a sessão continua valendo", (await me(sid)).status === 200);

    const outra = (await entrar()).sid;
    const sair = await fetch(BASE + "/api/logout", { method: "POST", headers: { cookie: "sid=" + outra } });
    certo("sair apaga o cookie", /sid=;.*Max-Age=0/.test(sair.headers.get("set-cookie") || ""));
    certo("e a sessão: o mesmo cookie não entra mais", (await me(outra)).status === 401);
    const recusa = await (await me(outra)).json();
    certo("a recusa diz que a sessão acabou (é o que o painel escuta)", recusa.sessao === "encerrada");
    certo("senha errada NÃO diz isso (senão abriria o 'entre de novo' no login)",
      !(await (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "errada-zz" }) })).json()).sessao);

    /* ------------------------------------------------------- o navegador */
    const CHROME = [process.env.CHROME,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((c) => { try { return fs.existsSync(c); } catch { return false; } });
    if (!CHROME) { console.log("  · navegador pulado: não achei o Chrome (defina CHROME=<caminho>)"); return; }
    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEP}`, `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
    let alvos = null;
    for (let i = 0; i < 60 && !alvos; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${DEP}/json/list`)).json(); } catch { await espera(250); } }
    const ws = new WebSocket(alvos.find((a) => a.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let seq = 0; const esp = new Map(); const pedidos = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && esp.has(m.id)) { esp.get(m.id)(m); esp.delete(m.id); }
      else if (m.method === "Network.requestWillBeSent") pedidos.push(m.params.request.url.replace(BASE, ""));
    });
    const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const na = async (expr) => {
      const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.result.exceptionDetails) throw new Error("no navegador: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result.result?.value;
    };
    const ate = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 150) { if (await na(expr)) return true; await espera(150); } return false; };
    const digita = async (texto) => { for (const ch of texto) await cdp("Input.dispatchKeyEvent", { type: "char", text: ch }); };
    const contar = (trecho) => pedidos.filter((u) => u.startsWith(trecho)).length;
    await cdp("Page.enable"); await cdp("Network.enable");
    await cdp("Network.setCookie", { name: "sid", value: sid, url: BASE });
    const abrirPainel = async () => {
      await cdp("Page.navigate", { url: BASE + "/admin/" });
      await ate(`!!document.querySelector('.navbtn[data-p="g-alunos"]') && !document.querySelector("#app").hidden`);
      await na(`document.querySelector('.navbtn[data-p="g-alunos"]').click(); true`);
      return ate(`!!document.querySelector("#g-lista-alunos table, #g-lista-alunos .g-vazio:not(:empty)") && !/Carregando/.test(document.querySelector("#g-lista-alunos").textContent)`);
    };
    certo("a tela de Alunos abre", await abrirPainel());
    await ate(`true`, 1500);

    /* ------------------------------------- 1. o servidor reinicia no meio */
    pedidos.length = 0;
    await derrubar(); await subir({ FF_SSE_BATIDA_MS: "1500" });
    certo("depois da entrega, o aviso em tempo real reconecta sozinho",
      await (async () => { for (let t = 0; t < 15000; t += 300) { if (contar("/api/gestao/eventos") >= 1) return true; await espera(300); } return false; })());
    certo("e atualiza a lista (pode ter chegado matrícula no intervalo)",
      await (async () => { for (let t = 0; t < 10000; t += 300) { if (contar("/api/gestao/alunos?") >= 1) return true; await espera(300); } return false; })());
    await na(`document.querySelector('[data-acao="novo-aluno"]').click(); true`);
    certo("o clique em + Novo aluno ABRE a ficha (antes: nada, sem aviso)", await ate(`!!document.querySelector("#dlg-aluno[open]")`));
    certo("e ninguém foi mandado entrar de novo", !(await na(`document.querySelector("#dlg-sessao")?.open`)));

    /* -------------- 3. a sessão acaba com a ficha aberta e algo digitado */
    await na(`(() => { const n = document.querySelector('#dlg-aluno [name="nome"]'); n.focus(); n.value = ""; return true; })()`);
    await digita("ZZ Painel Aberto");
    const tituloAntes = await na(`document.title`);
    pedidos.length = 0;
    banco.prepare("DELETE FROM sessoes").run();          // as 12 h passaram
    certo("o painel PERCEBE sozinho, sem clique: abre o 'Sua sessão terminou'",
      await ate(`document.querySelector("#dlg-sessao")?.open`, 15000));
    certo("por cima da ficha (os dois abertos; o da sessão é o de cima)",
      await na(`document.querySelector("#dlg-aluno").open && document.querySelector("#dlg-sessao")?.open
        && document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("dialog")?.id === "dlg-sessao"`));
    certo("a aba avisa no título", /sess[aã]o encerrada/.test(await na(`document.title`)), await na(`document.title`));
    certo("o usuário já vem preenchido", (await na(`document.querySelector("#sessao-usr")?.value`)) === "admin");
    await na(`document.querySelector("#dlg-sessao")?.dispatchEvent(new Event("cancel", { cancelable: true })); true`);
    certo("Esc não fecha (fechar sem entrar deixaria a tela 'travada')", await na(`document.querySelector("#dlg-sessao")?.open`));

    /* entrar de novo, com a senha da semente de teste, digitada como a pessoa digita */
    await na(`document.querySelector("#sessao-pw")?.focus(); true`);
    await digita("forms-admin");
    pedidos.length = 0;
    await na(`document.querySelector("#sessao-entrar")?.click(); true`);
    certo("depois de entrar, o aviso some", await ate(`!document.querySelector("#dlg-sessao")?.open`));
    certo("a ficha continua aberta, com o que foi digitado",
      (await na(`document.querySelector("#dlg-aluno").open && document.querySelector('#dlg-aluno [name="nome"]').value`)) === "ZZ Painel Aberto");
    certo("o título volta ao normal", (await na(`document.title`)) === tituloAntes);
    certo("o aviso em tempo real volta",
      await (async () => { for (let t = 0; t < 10000; t += 300) { if (contar("/api/gestao/eventos") >= 1) return true; await espera(300); } return false; })());
    certo("e o clique volta a funcionar (a sessão nova vale)",
      (await na(`fetch("/api/me").then((r) => r.status)`)) === 200);
    await na(`document.querySelector("#dlg-aluno").close(); true`);

    /* ------------------------------------- 4. nenhum clique morre calado */
    await na(`window.__zz = Promise.reject(new Error("ZZ erro de prova")); true`);
    certo("erro sem tratamento vira aviso na tela", await ate(`document.querySelector("#toast").classList.contains("on") && /ZZ erro de prova/.test(document.querySelector("#toast").textContent)`));

    /* ---------------------------------------------- 5. o vigia do silêncio
       Com batidas a cada 1,5 s e silêncio tolerado de 4 s: nenhuma reconexão.
       Com o servidor calado (batida de 60 s): a página reconecta sozinha. */
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.FF_SSE_SILENCIO_MS = 4000;" });
    certo("(o painel reabre com o vigia encurtado)", await abrirPainel());
    await espera(1500); pedidos.length = 0;
    await espera(9000);
    certo("com batidas chegando, a conexão fica quieta (nenhuma reconexão em 9 s)", contar("/api/gestao/eventos") === 0,
      `${contar("/api/gestao/eventos")} reconexões`);
    await derrubar(); await subir({ FF_SSE_BATIDA_MS: "60000" });
    await espera(3000); pedidos.length = 0;
    await espera(12000);
    certo("com a linha calada, a página reconecta sozinha", contar("/api/gestao/eventos") >= 1, `${contar("/api/gestao/eventos")} reconexões`);
    certo("e atualiza a lista ao reconectar", contar("/api/gestao/alunos?") >= 1);
    certo("sem virar laço (no máximo uma reconexão a cada ~4 s)", contar("/api/gestao/eventos") <= 4, `${contar("/api/gestao/eventos")} em 12 s`);
    banco.close();
  } catch (e) {
    falhas.push("execução: " + e.message);
    console.log("  ERRO", e.message);
  } finally {
    try { chrome?.kill(); } catch {}
    await derrubar();
    await espera(600);
    try { fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
    console.log(`\n  ${falhas.length ? "✖" : "✔"} ${ok} ok, ${falhas.length} falha(s)\n`);
    process.exitCode = falhas.length ? 1 : 0;
  }
})();
