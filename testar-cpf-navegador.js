/* ==========================================================================
   testar-cpf-navegador.js — CPF, CEP e telefone na matrícula (1.30.2)

   POR QUE ESTA SUÍTE EXISTE. Em 30/09/2026 chegaram reclamações: "coloco o
   CPF e diz que está incorreto", "copio o CPF de outro lugar, colo, e não
   vai". O servidor estava certo — o defeito era todo do NAVEGADOR, e só
   aparecia com teclado e área de transferência de verdade:

     1. COLAR CORTAVA O NÚMERO: o campo tinha maxlength="14", e o navegador
        corta o texto colado antes de a máscara vê-lo. Espaço na frente,
        "CPF: " na frente, ou o caractere invisível que o WhatsApp põe em volta
        do texto copiado — o último dígito ficava de fora.
     2. CORRIGIR UM DÍGITO NO MEIO jogava o cursor para o fim, e o número
        digitado entrava no lugar errado.
     3. UM CPF ESCONDIDO TRAVAVA O ENVIO: digitado como adulto, a data
        corrigida para a de uma criança escondia o campo — e ele continuava
        reprovado, com a mensagem apontando para o que ninguém via.

   Rodada contra o main.js de antes, ela reproduz os três (7 falhas em 15).

   Os eventos são os do próprio Chrome (Input.dispatchKeyEvent para teclar,
   Input.insertText para colar — é o mesmo caminho do Ctrl+V e respeita o
   maxlength como um colar de verdade), e não `el.value = …`, que passaria
   por cima justamente do que estava quebrado.

   Sobe o PRÓPRIO servidor com banco temporário (FF_DATA): nada do banco da
   academia é tocado. Sem Chrome, a parte do navegador é pulada e diz que foi.

     node testar-cpf-navegador.js
   ========================================================================== */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/* 5333: vizinha da suíte da foto (5331) e longe das portas da gestão
   (5311, 5318, 5322) — portas repetidas já derrubaram suíte duas vezes. */
const PORTA = Number(process.env.PORTA_TESTE_CPF) || 5333;
const BASE = `http://127.0.0.1:${PORTA}`;
const DEP = PORTA + 1000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-cpf-nav-"));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0; const falhas = [];
function certo(nome, cond, detalhe = "") {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}

(async () => {
  console.log("\n=== CPF, CEP e telefone na matrícula, com teclado e colar de verdade ===\n");

  /* --------------------------------------------------------------------
     1. O CÓDIGO
     -------------------------------------------------------------------- */
  const js = fs.readFileSync(path.join(__dirname, "assets", "js", "main.js"), "utf8");
  const pagina = fs.readFileSync(path.join(__dirname, "src", "matricula.html"), "utf8");
  certo("os campos de CPF não cortam mais o texto colado em 14 caracteres",
    !/name="(resp_)?cpf"[^>]*maxlength="14"/.test(pagina));
  certo("o CEP não corta mais o texto colado em 9 caracteres", !/id="m-cep"[^>]*maxlength="9"/.test(pagina));
  certo("a página publicada é igual ao modelo nos campos de CPF",
    (() => { try { const pub = fs.readFileSync(path.join(__dirname, "matricula", "index.html"), "utf8");
      return !/name="(resp_)?cpf"[^>]*maxlength="14"/.test(pub); } catch { return false; } })());
  certo("o CPF escondido deixa de ser julgado", js.includes('const visivel = (el) => !el.closest("[hidden]");'));

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
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "forms-cpf-chrome-"));
  let chrome = null;
  try {
    let vivo = false;
    for (let i = 0; i < 60 && !vivo; i++) { try { await fetch(BASE + "/"); vivo = true; } catch { await espera(250); } }
    if (!vivo) throw new Error("o servidor não subiu:\n" + log.slice(-800));
    /* Banco novo: a senha é a da semente — a do banco de ENSAIO, que morre no fim. */
    const ent = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "forms-admin" }) });
    const A = (ent.headers.get("set-cookie") || "").split(";")[0];
    const ativ = (await (await fetch(BASE + "/api/gestao/atividades", { headers: { cookie: A } })).json())
      .atividades.find((a) => a.nome === "Natação");
    const t = await fetch(BASE + "/api/gestao/turmas", { method: "POST", headers: { cookie: A, "content-type": "application/json" },
      body: JSON.stringify({ atividade_id: ativ.id, horario: "10:00", publica: true }) });
    certo("uma turma aberta no site para o ensaio", t.status === 200);

    const CHROME = [process.env.CHROME,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((c) => { try { return fs.existsSync(c); } catch { return false; } });
    if (!CHROME) { console.log("  · navegador pulado: não achei o Chrome (defina CHROME=<caminho>)"); return; }

    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEP}`,
      `--user-data-dir=${perfil}`, "--window-size=412,900", "about:blank"], { stdio: "ignore" });
    let alvos = null;
    for (let i = 0; i < 40 && !alvos; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${DEP}/json/list`)).json(); } catch { await espera(250); } }
    const ws = new WebSocket(alvos.find((a) => a.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let seq = 0; const esp = new Map();
    ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && esp.has(m.id)) { esp.get(m.id)(m); esp.delete(m.id); } });
    const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const na = async (expr) => {
      const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result.result.value;
    };
    const tecla = async (key, vk, text) => {
      await cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code: key, windowsVirtualKeyCode: vk, text });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: vk });
    };
    const digitar = async (txt) => { for (const ch of txt) await tecla(ch, ch.charCodeAt(0), ch); };
    const colar = (txt) => cdp("Input.insertText", { text: txt });
    const esquerda = () => tecla("ArrowLeft", 37);
    const apagar = () => tecla("Backspace", 8);
    const focar = (sel, limpar = true) => na(`(() => { const e = document.querySelector("${sel}"); e.focus();
      ${limpar ? `e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true }));` : ""} })()`);
    const ler = (sel) => na(`(() => { const e = document.querySelector("${sel}"); e.blur();
      const a = e.parentElement.querySelector(".mat-campo-aviso");
      return { valor: e.value, valido: e.validity.valid, aviso: a && !a.hidden ? a.textContent : "" }; })()`);
    const abrir = async () => { await cdp("Page.navigate", { url: `${BASE}/matricula/` }); await espera(2500); };
    const adulto = () => na(`(() => { const n = document.querySelector("#m-nasc"); n.value = "1990-05-10";
      n.dispatchEvent(new Event("change")); })()`);

    await abrir(); await adulto();

    /* ------------------------------------------------------------------
       3. COLAR — o que as pessoas copiam de verdade
       ------------------------------------------------------------------ */
    console.log("\n  colar o CPF");
    const CPF = "529.982.247-25";
    const colagens = [
      ["formatado", CPF],
      ["só os números", "52998224725"],
      ["com espaço ANTES (o que mais acontece)", " " + CPF],
      ["com espaço depois", CPF + " "],
      ["com \"CPF: \" na frente", "CPF: " + CPF],
      ["com \"CPF nº \" na frente", "CPF nº " + CPF],
      ["com as marcas invisíveis do WhatsApp", "\u200E" + CPF + "\u200E"],
      ["com espaço duro no lugar dos pontos", "529\u00A0982\u00A0247\u00A025"],
      ["com travessão no lugar do hífen", "529.982.247\u201325"],
      ["com quebra de linha no fim", CPF + "\n"],
      ["junto de outro número (\"1) CPF 529…\")", "1) CPF " + CPF],
    ];
    for (const [nome, texto] of colagens) {
      await focar("#m-cpf"); await colar(texto);
      const e = await ler("#m-cpf");
      certo(`colar ${nome}`, e.valor === CPF && e.valido, JSON.stringify(e));
    }
    /* O bloco do responsável só existe para CRIANÇA — escondido, o campo nem
       recebe foco. */
    await na(`(() => { const n = document.querySelector("#m-nasc"); n.value = "2015-05-10"; n.dispatchEvent(new Event("change")); })()`);
    await focar("#m-r-cpf"); await colar(" 111.444.777-35");
    const resp = await ler("#m-r-cpf");
    await adulto();
    certo("o CPF do RESPONSÁVEL também aceita colar com espaço na frente", resp.valor === "111.444.777-35", JSON.stringify(resp));

    /* ------------------------------------------------------------------
       4. CORRIGIR com o cursor no meio
       ------------------------------------------------------------------ */
    console.log("\n  corrigir com o cursor no meio");
    await focar("#m-cpf"); await digitar("52998224725");
    certo("digitar os 11 números forma o CPF", (await ler("#m-cpf")).valor === CPF);

    /* Digitou 3 no lugar do 2 (penúltimo): volta UMA casa, apaga, digita. */
    await focar("#m-cpf"); await digitar("52998224735");
    await focar("#m-cpf", false); await esquerda(); await apagar(); await digitar("2");
    let e = await ler("#m-cpf");
    certo("trocar o penúltimo dígito: o número entra onde estava o cursor", e.valor === CPF && e.valido, JSON.stringify(e));

    /* No meio de um bloco: depois de "529.9", apaga o 9 e digita 9 de novo. */
    await focar("#m-cpf"); await digitar("52998224725");
    await na(`(() => { const x = document.querySelector("#m-cpf"); x.focus(); x.setSelectionRange(5, 5); })()`);
    await apagar(); await digitar("9");
    e = await ler("#m-cpf");
    certo("trocar um dígito no meio de um bloco não embaralha o resto", e.valor === CPF, JSON.stringify(e));

    /* O cursor logo depois do ponto: apagar leva o dígito do lado — antes a
       máscara recolocava o ponto e a pessoa ficava presa ali. */
    await focar("#m-cpf"); await digitar("52998224725");
    await na(`(() => { const x = document.querySelector("#m-cpf"); x.focus(); x.setSelectionRange(4, 4); })()`); // "529.|982"
    await apagar();
    e = await ler("#m-cpf");
    certo("apagar em cima do ponto apaga o dígito ao lado (não trava)", e.valor === "529.822.472-5", JSON.stringify(e));

    /* ------------------------------------------------------------------
       5. O AVISO diz o que está errado, embaixo do campo
       ------------------------------------------------------------------ */
    console.log("\n  o aviso embaixo do campo");
    await focar("#m-cpf"); await digitar("5299822472");
    e = await ler("#m-cpf");
    certo("faltando um número, o aviso conta os números", /11 números — aqui há 10/.test(e.aviso) && !e.valido, JSON.stringify(e));
    await focar("#m-cpf"); await digitar("52998224724");
    e = await ler("#m-cpf");
    certo("número trocado: o aviso diz que o CPF não existe", /não existe/.test(e.aviso) && !e.valido, JSON.stringify(e));
    await focar("#m-cpf", false); await apagar(); await digitar("5");
    e = await ler("#m-cpf");
    certo("corrigido, o aviso some sozinho", e.aviso === "" && e.valido, JSON.stringify(e));

    /* ------------------------------------------------------------------
       6. CEP e TELEFONE colados
       ------------------------------------------------------------------ */
    console.log("\n  CEP e telefone colados");
    for (const [nome, sel, texto, esperado] of [
      ["CEP com espaço na frente", "#m-cep", " 55038-270", "55038-270"],
      ["CEP só com números", "#m-cep", "55038270", "55038-270"],
      ["WhatsApp com +55", "#m-whats", "+55 81 99999-0005", "(81) 99999-0005"],
      ["WhatsApp com 0 da operadora", "#m-whats", "081 99999-0005", "(81) 99999-0005"],
      ["WhatsApp com +55 e espaço na frente", "#m-whats", " +55 (81) 99999-0005", "(81) 99999-0005"],
      ["telefone fixo", "#m-fone2", "(81) 3721-0000", "(81) 3721-0000"],
    ]) {
      await focar(sel); await colar(texto);
      const r = await ler(sel);
      certo(`colar ${nome}`, r.valor === esperado, JSON.stringify(r.valor));
    }

    /* ------------------------------------------------------------------
       7. DE PONTA A PONTA
       ------------------------------------------------------------------ */
    console.log("\n  de ponta a ponta");
    const enviar = (preparo) => na(`(async () => {
      const $ = (s) => document.querySelector(s);
      const v = (s, x) => { const e = $(s); e.value = x; e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true })); e.dispatchEvent(new Event("blur")); };
      v("#m-email", "zz.qa@exemplo.test"); v("#m-pai", "Zz Qa Pai");
      v("#m-rg", "1234567"); v("#m-rg-emissor", "SDS/PE"); v("#m-civil", "Solteiro(a)"); v("#m-profissao", "Professora");
      v("#m-r-emissor", "SDS/PE"); v("#m-r-civil", "Casado(a)"); v("#m-r-profissao", "Comerciante");
      ${preparo}
      const t = $("#m-turma"); t.selectedIndex = 1; t.dispatchEvent(new Event("change", { bubbles: true }));
      v("#m-sexo", "Masculino"); v("#m-mae", "Zz Qa Mae");
      v("#m-rua", "Avenida Caruaru"); v("#m-num", "579"); v("#m-bairro", "Boa Vista"); v("#m-cidade", "Caruaru"); v("#m-uf", "PE");
      if (!$("#m-cep").value) v("#m-cep", "55038-270");
      if (!$("#m-whats").value) v("#m-whats", "(81) 99999-0005");
      document.querySelectorAll(".mat-check input").forEach((x) => { x.checked = true; });
      const k = document.createElement("canvas"); k.width = 300; k.height = 300; k.getContext("2d").fillRect(0, 0, 300, 300);
      const b = await new Promise((ok) => k.toBlob(ok, "image/jpeg", 0.9));
      for (const [sel, nome] of [["#m-foto", "f.jpg"], ["#m-comprovante", "c.jpg"]]) {
        const dt = new DataTransfer(); dt.items.add(new File([b], nome, { type: "image/jpeg" }));
        $(sel).files = dt.files; $(sel).dispatchEvent(new Event("change", { bubbles: true })); }
      await new Promise((ok) => setTimeout(ok, 600));
      $(".mat-enviar").click();
      for (let i = 0; i < 40; i++) { await new Promise((ok) => setTimeout(ok, 400)); if (!$("#mat-ok").hidden || !$("#mat-erro").hidden) break; }
      return { recebida: !$("#mat-ok").hidden, erro: $("#mat-erro").hidden ? null : $("#mat-erro").textContent };
    })()`);

    /* O caso da reclamação: CPF colado com espaço na frente, e enviado. */
    await abrir(); await adulto();
    await na(`(() => { const e = document.querySelector("#m-nome"); e.value = "Zz Qa Colou o CPF"; })()`);
    await focar("#m-cpf"); await colar(" " + CPF);
    let r = await enviar("");
    certo("CPF colado com espaço na frente: a matrícula ENTRA", r.recebida, r.erro || "");

    /* O CAMPO ESCONDIDO não pode barrar. Desde a 1.31.0 o CPF do aluno vale
       para todos e nunca se esconde; quem some é o bloco do RESPONSÁVEL. O
       cenário: começou como criança, digitou o CPF do responsável errado, e a
       data era a de um adulto — o bloco some com o CPF errado dentro. */
    await abrir();
    r = await enviar(`v("#m-nome", "Zz Qa Virou Adulto"); v("#m-nasc", "2015-05-10");
      v("#m-r-nome", "Zz Qa Responsavel"); v("#m-r-rg", "1234567"); v("#m-r-cpf", "111.444.777-99"); v("#m-r-fone", "(81) 99999-0006");
      v("#m-nasc", "1990-05-10"); v("#m-cpf", "529.982.247-25");`);
    certo("CPF errado do responsável, depois a data virou de adulto: a matrícula ENTRA", r.recebida, r.erro || "");

    /* E o CPF da CRIANÇA agora é pedido — errado e à vista, barra. */
    await abrir();
    r = await enviar(`v("#m-nome", "Zz Qa Crianca Cpf Errado"); v("#m-nasc", "2015-05-10"); v("#m-cpf", "529.982.247-99");
      v("#m-r-nome", "Zz Qa Responsavel"); v("#m-r-rg", "1234567"); v("#m-r-cpf", "111.444.777-35"); v("#m-r-fone", "(81) 99999-0006");`);
    certo("criança com CPF errado é barrada (o CPF da criança é obrigatório desde a 1.31.0)",
      !r.recebida && /CPF não confere/.test(r.erro || ""), JSON.stringify(r));

    /* "Não consta" no pai: a matrícula entra, e o campo leva essas palavras. */
    await abrir();
    r = await enviar(`v("#m-nome", "Zz Qa Sem Pai"); v("#m-nasc", "1990-05-10"); v("#m-cpf", "529.982.247-25");
      v("#m-pai", ""); const nc = $("#m-pai-nc"); nc.checked = true; nc.dispatchEvent(new Event("change", { bubbles: true }));`);
    certo("pai \"Não consta no registro\": a matrícula ENTRA", r.recebida, r.erro || "");

    /* (1.32.1) O e-mail voltou a ser opcional: em branco, a ficha entra. */
    await abrir();
    r = await enviar(`v("#m-nome", "Zz Qa Sem Email"); v("#m-nasc", "1990-05-10"); v("#m-cpf", "529.982.247-25"); v("#m-email", "");`);
    certo("sem e-mail: a matrícula ENTRA (opcional desde a 1.32.1)", r.recebida, r.erro || "");

    /* (1.32.2) Criança: o CPF do aluno é opcional — o rótulo diz isso, e a
       ficha entra com o campo em branco. O do responsável continua exigido. */
    await abrir();
    const rotulo = await na(`(() => { const n = document.querySelector("#m-nasc"); n.value = "2016-03-03"; n.dispatchEvent(new Event("change"));
      return { req: !document.querySelector("#m-cpf-req").hidden, opc: !document.querySelector("#m-cpf-opc").hidden,
        exigido: document.querySelector("#m-cpf").required }; })()`);
    certo("criança: o CPF do aluno aparece como opcional (sem asterisco)", !rotulo.req && rotulo.opc && !rotulo.exigido, JSON.stringify(rotulo));
    r = await enviar(`v("#m-nome", "Zz Qa Crianca Sem Cpf"); v("#m-nasc", "2016-03-03"); v("#m-cpf", "");
      v("#m-r-nome", "Zz Qa Responsavel"); v("#m-r-rg", "1234567"); v("#m-r-cpf", "111.444.777-35"); v("#m-r-fone", "(81) 99999-0006");`);
    certo("criança SEM CPF: a matrícula ENTRA", r.recebida, r.erro || "");
    await abrir();
    const adultoRot = await na(`(() => { const n = document.querySelector("#m-nasc"); n.value = "1990-03-03"; n.dispatchEvent(new Event("change"));
      return { req: !document.querySelector("#m-cpf-req").hidden, exigido: document.querySelector("#m-cpf").required }; })()`);
    certo("adulto: o CPF volta a ser obrigatório, com asterisco", adultoRot.req && adultoRot.exigido, JSON.stringify(adultoRot));

    /* E um CPF errado À VISTA continua barrado — consertar não pode virar
       deixar passar qualquer coisa. */
    await abrir();
    r = await enviar(`v("#m-nome", "Zz Qa Cpf Errado"); v("#m-nasc", "1990-05-10"); v("#m-cpf", "529.982.247-99");`);
    certo("CPF errado à vista continua barrado", !r.recebida && /CPF não confere/.test(r.erro || ""), JSON.stringify(r));

    /* O que chegou ao banco: CPF formatado, sem enfeite nenhum. */
    const lista = await (await fetch(BASE + "/api/gestao/alunos?pre=1&busca=Zz%20Qa%20Colou", { headers: { cookie: A } })).json();
    const aluno = (lista.alunos || lista.itens || []).find((a) => /Colou o CPF/i.test(a.nome));
    const ficha = aluno ? await (await fetch(BASE + `/api/gestao/alunos/${aluno.id}`, { headers: { cookie: A } })).json() : null;
    const cpfGravado = ficha && (ficha.aluno ? ficha.aluno.cpf : ficha.cpf);
    certo("no banco, o CPF colado chega limpo e formatado", cpfGravado === CPF, JSON.stringify(cpfGravado));
    ws.close();
  } catch (e) {
    falhas.push("a suíte quebrou: " + e.message);
    console.log("  QUEBROU:", e.message);
  } finally {
    if (chrome) chrome.kill();
    servidor.kill();
    await espera(500);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temporário */ }
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* temporário */ }
  }

  console.log(`\n  ${ok} passaram, ${falhas.length} falharam`);
  falhas.forEach((f) => console.log("   ✖ " + f));
  process.exit(falhas.length ? 1 : 0);
})();
