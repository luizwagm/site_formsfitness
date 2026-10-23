/* ==========================================================================
   testar-saude-navegador.js — saúde e necessidades da criança (1.35.0 → 1.37.0)

   OS PEDIDOS
     · "quando for menor de idade, colocar select com se há alguma questão de
       saúde (lista de opções, com busca)" — obrigatório. (O de transtornos
       saiu na 1.37.0: "o sim e não já resolve essa parte".)
     · (1.36.0) a pergunta da academia sobre ACOMPANHAMENTO individualizado
       (Sim/Não), com o "Importante" em destaque e itálico à vista desde o
       começo; "Sim" → a mensagem de orientação e a matrícula não segue;
       "Não" → a declaração do responsável; foto e pagamento só depois. O
       bloqueio é pela NECESSIDADE de suporte, nunca pelo diagnóstico.

   O que se prova aqui, num Chrome de verdade, com clique e teclado:
     1. o bloco só aparece para criança, e os dois campos travam o envio vazios;
     2. a busca acha sem acento ("intolerancia" → "Intolerância à lactose"),
        marca várias, "Nenhuma" é exclusiva, "Outra" abre o texto, o teclado
        funciona e o Backspace tira a última etiqueta;
     3. "Sim" mostra a orientação na hora e trava o envio; "Não" abre a
        declaração já com o responsável do item 4; foto e pagamento só
        destravam com ela aceita; CPF de outra pessoa na declaração é
        recusado; (1.37.0) "Sim" trava e apaga os itens 6 a 8; nome e CPF
        da declaração ACOMPANHAM o item 4 até a pessoa mexer neles, e ficam
        em branco se o item 4 estiver; adulto fica de fora;
     4. a matrícula de criança com "Não" e a declaração aceita entra, com a
        resposta e a declaração (nome e CPF) gravadas;
     5. no celular, a lista aberta não cria barra lateral;
     6. no painel, a ficha mostra as respostas gravadas como etiquetas.

   Sobe o PRÓPRIO servidor com banco temporário (FF_DATA): nada do banco da
   academia é tocado. Não publica. Sem Chrome, a parte do navegador é pulada.

     node testar-saude-navegador.js
   ========================================================================== */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/* 5343: longe das outras suítes (5311…5341). */
const PORTA = Number(process.env.PORTA_TESTE_SAUDE) || 5343;
const BASE = `http://127.0.0.1:${PORTA}`;
const DEP = PORTA + 1000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-saude-"));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0; const falhas = [];
function certo(nome, cond, detalhe = "") {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}

(async () => {
  console.log("\n=== Saúde e necessidades da criança (1.35.0 → 1.37.0) ===\n");
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000", FF_ENV: path.join(TMP, "vazio.env") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "forms-saude-chrome-"));
  let chrome = null;
  try {
    let vivo = false;
    for (let i = 0; i < 60 && !vivo; i++) { try { await fetch(BASE + "/"); vivo = true; } catch { await espera(250); } }
    if (!vivo) throw new Error("o servidor não subiu:\n" + log.slice(-800));
    const ent = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "forms-admin" }) });
    const sid = (ent.headers.get("set-cookie") || "").split(";")[0].split("=")[1];
    const A = "sid=" + sid;
    const api = async (rota, metodo = "GET", corpo) => {
      const r = await fetch(BASE + rota, { method: metodo, headers: { cookie: A, "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
      return { status: r.status, j: await r.json().catch(() => ({})) };
    };
    /* uma atividade com uma turma pública, para o formulário ter horário */
    const ativ = (await api("/api/gestao/atividades")).j.atividades.find((a) => a.nome === "Natação");
    const tu = await api("/api/gestao/turmas", "POST", { atividade_id: ativ.id, horario: "10:00", publica: true });
    certo("turma de ensaio criada", tu.status === 200, JSON.stringify(tu.j).slice(0, 200));

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
    let seq = 0; const esp = new Map();
    ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && esp.has(m.id)) { esp.get(m.id)(m); esp.delete(m.id); } });
    const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const na = async (expr) => {
      const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.result.exceptionDetails) throw new Error("no navegador: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result.result?.value;
    };
    const ate = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 150) { if (await na(expr)) return true; await espera(150); } return false; };
    /* teclas de verdade, pelo protocolo — o que a pessoa digita */
    const digita = async (texto) => { for (const ch of texto) await cdp("Input.dispatchKeyEvent", { type: "char", text: ch }); };
    const tecla = async (key, code, vk) => {
      await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    };
    await cdp("Page.enable");
    await cdp("Network.enable");
    await cdp("Network.setCookie", { name: "sid", value: sid, url: BASE });

    /* auxiliares dentro da página */
    const AUX = `
      window.$q = (s) => document.querySelector(s);
      window.dataNasc = (v) => { const n = $q("#m-nasc"); n.value = v; n.dispatchEvent(new Event("change", { bubbles: true })); };
      window.abrirLista = (id) => $q("#" + id + "-busca").click();
      window.opcoes = (id) => [...document.querySelectorAll("#" + id + " .lb__op")].map((l) => l.dataset.op);
      window.marcar = (id, op) => { abrirLista(id); const li = [...document.querySelectorAll("#" + id + " .lb__op")].find((l) => l.dataset.op === op);
        li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); };
      window.chips = (id) => [...document.querySelectorAll("#" + id + " .lb__chip span")].map((s) => s.textContent.trim());
      window.valor = (id) => $q("#" + id + ' input[type="hidden"]').value;
      window.tirarCookies = () => { document.body.classList.remove("has-cookie-bar");
        document.querySelectorAll("body > [class*=cookie], body > [id*=cookie], body > [class*=consent]").forEach((e) => e.remove()); };`;
    await cdp("Page.navigate", { url: BASE + "/matricula/" });
    await ate(`!!document.querySelector("#m-saude .lb__busca") && !document.querySelector("#m-turma").disabled`);
    await na(AUX + "tirarCookies(); true");

    /* ------------------------------------------------------------ 1. o bloco */
    await na(`dataNasc("1990-01-01")`);
    certo("adulto: o bloco de saúde fica escondido", await na(`$q("#mat-saude").hidden`));
    await na(`dataNasc("2017-06-10")`);
    const b1 = await na(`({ visivel: !$q("#mat-saude").hidden, s: $q("#m-saude-busca").validity.customError,
      msg: $q("#m-saude-busca").validationMessage, semTranstornos: !$q("#m-transtornos") && !/Algum transtorno/.test(document.body.textContent) })`);
    certo("criança: o bloco aparece e a saúde é obrigatória", b1.visivel && b1.s && /Nenhuma/.test(b1.msg), JSON.stringify(b1));
    certo("o campo \"Algum transtorno?\" não existe mais (1.37.0)", b1.semTranstornos);
    certo("…sem ficar vermelho antes de a pessoa passar por ele", !(await na(`$q("#m-saude").classList.contains("lb--erro")`)));

    /* ------------------------------------------------------------ 2. a lista */
    await na(`abrirLista("m-saude"); $q("#m-saude-busca").focus()`);
    await digita("intolerancia");
    certo("busca sem acento acha \"Intolerância à lactose\"", JSON.stringify(await na(`opcoes("m-saude")`)) === JSON.stringify(["Intolerância à lactose"]), JSON.stringify(await na(`opcoes("m-saude")`)));
    await na(`$q("#m-saude-busca").value = ""; $q("#m-saude-busca").dispatchEvent(new Event("input"))`);
    await na(`marcar("m-saude", "Asma"); marcar("m-saude", "Rinite alérgica")`);
    certo("marca várias: duas etiquetas e o valor certo", JSON.stringify(await na(`chips("m-saude")`)) === JSON.stringify(["Asma", "Rinite alérgica"])
      && (await na(`valor("m-saude")`)) === "Asma; Rinite alérgica", await na(`valor("m-saude")`));
    certo("…e o campo deixa de travar o envio", !(await na(`$q("#m-saude-busca").validity.customError`)));
    await na(`marcar("m-saude", "Nenhuma")`);
    certo("\"Nenhuma\" limpa as outras", JSON.stringify(await na(`chips("m-saude")`)) === JSON.stringify(["Nenhuma"]));
    await na(`marcar("m-saude", "Asma")`);
    certo("…e marcar outra tira o \"Nenhuma\"", JSON.stringify(await na(`chips("m-saude")`)) === JSON.stringify(["Asma"]));
    await na(`marcar("m-saude", "Outra (especificar)")`);
    const outra = await na(`({ visivel: !$q("#m-saude .lb__outra").hidden, exigido: $q("#m-saude .lb__outra").required })`);
    certo("\"Outra\" abre o campo de texto, obrigatório", outra.visivel && outra.exigido, JSON.stringify(outra));
    await na(`$q("#m-saude .lb__outra").focus()`);
    await digita("Alergia a abelha");
    certo("…e o texto entra no valor como \"Outra: …\"", (await na(`valor("m-saude")`)) === "Asma; Outra: Alergia a abelha", await na(`valor("m-saude")`));
    /* teclado: digita, ↓, Enter */
    await na(`abrirLista("m-saude"); $q("#m-saude-busca").focus()`);
    await digita("rinite");
    await tecla("ArrowDown", "ArrowDown", 40);
    await tecla("Enter", "Enter", 13);
    certo("teclado: digitar, ↓ e Enter marcam \"Rinite alérgica\"", (await na(`valor("m-saude")`)) === "Asma; Rinite alérgica; Outra: Alergia a abelha", await na(`valor("m-saude")`));
    await na(`$q("#m-saude-busca").focus()`);
    await tecla("Backspace", "Backspace", 8);
    certo("Backspace com a busca vazia tira a última etiqueta", (await na(`valor("m-saude")`)) === "Asma; Rinite alérgica", await na(`valor("m-saude")`));
    await na(`marcar("m-saude", "Rinite alérgica"); marcar("m-saude", "Outra (especificar)")`);
    certo("…e remarcar \"Outra\" traz de volta o texto que estava", (await na(`valor("m-saude")`)) === "Asma; Outra: Alergia a abelha", await na(`valor("m-saude")`));

    /* ------------------------- 3. necessidades do aluno: a pergunta que decide (1.36.0) */
    const enviar = `$q(".mat-enviar")`;
    await na(`(() => { const v = (s, x) => { const e = $q(s); e.value = x; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); };
      v("#m-r-nome", "Zz Qa Responsável"); v("#m-r-cpf", "111.444.777-35");
      window.responder = (x) => { const s = $q("#m-necessidade"); s.value = x; s.dispatchEvent(new Event("change", { bubbles: true })); }; return true; })()`);
    const estado = `({ pausa: !$q("#m-pausa").hidden, texto: $q("#m-pausa-texto").textContent, decl: !$q("#m-declaracao").hidden,
      trava: !$q("#mat-trava-pag").hidden, conteudo: !$q("#mat-pagamento-conteudo").hidden, desab: $q("#mat-pagamento").disabled,
      foto: $q("#m-foto").matches(":disabled"), contato: $q("#mat-contato").disabled, termos: $q(".mat-bloco--termos").disabled,
      parado: $q("#mat-contato").classList.contains("mat-bloco--parado") && $q("#mat-pagamento").classList.contains("mat-bloco--parado"), enviarTravado: ${enviar}.disabled, classe: ${enviar}.classList.contains("mat-enviar--travado"),
      exigida: $q("#m-necessidade").required, declNome: $q("#m-decl-nome").value, declCpf: $q("#m-decl-cpf").value })`;
    const imp = await na(`(() => { const p = $q(".mat-importante"); const em = p.querySelector("em");
      return { visivel: !p.closest("[hidden]") && p.getBoundingClientRect().height > 0, italico: getComputedStyle(em).fontStyle, fundo: getComputedStyle(p).backgroundColor,
        texto: p.textContent }; })()`);
    certo("o \"Importante\" está à vista ANTES de responder, em itálico e em destaque", imp.visivel && imp.italico === "italic"
      && imp.fundo !== "rgba(0, 0, 0, 0)" && /não dispõe, no momento, de equipe especializada/.test(imp.texto), JSON.stringify(imp).slice(0, 160));
    let e = await na(estado);
    certo("criança, sem resposta: a pergunta é obrigatória e foto/pagamento estão TRAVADOS", e.exigida && e.trava && !e.conteudo && e.desab && e.foto, JSON.stringify(e));
    await na(`responder("sim")`);
    e = await na(estado);
    certo("\"Sim\": a mensagem de orientação aparece na hora", e.pausa && /^Olá! Agradecemos pelas informações fornecidas/.test(e.texto)
      && /Acqua Angels/.test(e.texto) && /Equipe Forms Fitness Academia Aquática$/.test(e.texto), e.texto.slice(0, 120));
    certo("…o envio trava (cursor de proibido, não de espera) e foto/pagamento seguem travados", e.enviarTravado && e.classe && e.trava && !e.decl, JSON.stringify(e));
    certo("…e o formulário NÃO SEGUE: os itens 6 (contato), 7 e 8 (autorizações) ficam travados e apagados", e.contato && e.termos && e.desab && e.parado, JSON.stringify(e));
    const zap = await na(`$q("#m-pausa-zap").href`);
    certo("…e o WhatsApp não leva informação de saúde no endereço", /^https:\/\/wa\.me\/\d+\?text=/.test(zap) && !/necessidad|defici|transtorno|sim/i.test(decodeURIComponent(zap.split("text=")[1] || "")), zap);
    await na(`responder("nao")`);
    e = await na(estado);
    certo("\"Não\": a orientação some e a DECLARAÇÃO abre, já com o responsável do item 4", !e.pausa && e.decl
      && e.declNome === "Zz Qa Responsável" && e.declCpf === "111.444.777-35", JSON.stringify(e));
    certo("…o envio destrava, mas foto/pagamento só depois de aceitar a declaração", !e.enviarTravado && !e.classe && e.trava && e.desab, JSON.stringify(e));
    certo("…e os itens 6 e 8 voltam a valer", !e.contato && !e.termos && !e.parado, JSON.stringify(e));
    /* (1.37.0) a declaração ACOMPANHA o responsável do item 4 */
    const resp = (sel, x) => na(`(() => { const el = $q("${sel}"); el.value = ${JSON.stringify(x)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await resp("#m-r-nome", "Zz Qa Outro Nome");
    certo("corrigir o nome no item 4 depois do \"Não\" atualiza a declaração", (await na(`$q("#m-decl-nome").value`)) === "Zz Qa Outro Nome");
    await resp("#m-r-nome", "Zz Qa Responsável");
    await resp("#m-r-cpf", "");
    certo("item 4 sem CPF: o CPF da declaração fica em branco, para preencher ali", (await na(`$q("#m-decl-cpf").value`)) === "" && await na(`$q("#m-decl-cpf").required`));
    await resp("#m-r-cpf", "111.444.777-35");
    certo("…e preencher o item 4 leva o CPF para a declaração", (await na(`$q("#m-decl-cpf").value`)) === "111.444.777-35");
    await na(`(() => { const n = $q("#m-decl-nome"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); return true; })()`);
    await digita(" Jr");
    await resp("#m-r-nome", "Zz Qa Nome Trocado");
    certo("mexeu na declaração à mão: o que foi digitado vale (o item 4 não sobrescreve)", (await na(`$q("#m-decl-nome").value`)) === "Zz Qa Responsável Jr", await na(`$q("#m-decl-nome").value`));
    await resp("#m-r-nome", "Zz Qa Responsável");
    const declExigida = await na(`({ obrig: $q("#m-decl-ok").required, falta: $q("#m-decl-ok").validity.valueMissing, nome: $q("#m-decl-nome").required, cpf: $q("#m-decl-cpf").required })`);
    certo("…e a declaração (aceite, nome e CPF) passa a ser obrigatória para enviar", declExigida.obrig && declExigida.falta && declExigida.nome && declExigida.cpf, JSON.stringify(declExigida));
    await na(`$q("#m-decl-ok").click()`);
    e = await na(estado);
    certo("aceitar a declaração LIBERA foto e pagamento (item 7)", !e.trava && e.conteudo && !e.desab && !e.foto, JSON.stringify(e));
    await na(`(() => { const c = $q("#m-decl-cpf"); c.value = "529.982.247-25"; c.dispatchEvent(new Event("input", { bubbles: true })); c.dispatchEvent(new Event("blur")); return true; })()`);
    const cpfOutro = await na(`({ msg: $q("#m-decl-cpf").validationMessage, aviso: ($q("#m-decl-cpf").parentElement.querySelector(".mat-campo-aviso") || {}).textContent || "" })`);
    certo("na declaração, o CPF de OUTRA pessoa é recusado (tem de ser o do item 4)", /item 4/.test(cpfOutro.msg) && /item 4/.test(cpfOutro.aviso), JSON.stringify(cpfOutro));
    await na(`(() => { const c = $q("#m-decl-cpf"); c.value = "111.444.777-35"; c.dispatchEvent(new Event("input", { bubbles: true })); c.dispatchEvent(new Event("blur")); return true; })()`);
    certo("…com o CPF certo, o aviso some", (await na(`$q("#m-decl-cpf").validationMessage`)) === "");
    await na(`responder("sim")`);
    await na(`dataNasc("1990-01-01")`);
    await espera(100);
    e = await na(estado);
    certo("a data virar de ADULTO tira a regra: sem orientação, sem declaração, foto e pagamento livres", !e.pausa && !e.decl && !e.trava && !e.enviarTravado && !e.exigida, JSON.stringify(e));
    await na(`dataNasc("2017-06-10")`);
    await espera(100);
    e = await na(estado);
    certo("…e voltar para criança com \"Sim\" trava de novo", e.pausa && e.enviarTravado && e.trava, JSON.stringify(e));
    await na(`responder("nao")`);
    e = await na(estado);
    certo("…e \"Não\" com a declaração já aceita libera de novo", !e.trava && !e.enviarTravado, JSON.stringify(e));

    /* ------------------------------------------------------- 4. matrícula inteira */
    const r = await na(`(async () => {
      const v = (s, x) => { const e = $q(s); e.value = x; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.dispatchEvent(new Event("blur")); };
      v("#m-nome", "Zz Qa Criança Saúde"); v("#m-sexo", "Feminino"); v("#m-mae", "Zz Qa Mãe"); v("#m-pai", "Zz Qa Pai");
      v("#m-r-rg", "1234567"); v("#m-r-fone", "(81) 99999-0006");
      v("#m-r-emissor", "SDS/PE"); v("#m-r-civil", "Casado(a)"); v("#m-r-profissao", "Comerciante");
      const t = $q("#m-turma"); t.selectedIndex = 1; t.dispatchEvent(new Event("change", { bubbles: true }));
      v("#m-cep", "55038-270"); v("#m-rua", "Avenida Caruaru"); v("#m-num", "579"); v("#m-bairro", "Boa Vista"); v("#m-cidade", "Caruaru"); v("#m-uf", "PE");
      v("#m-whats", "(81) 99999-0005");
      document.querySelectorAll(".mat-bloco--termos .mat-check input").forEach((x) => { x.checked = true; });
      const k = document.createElement("canvas"); k.width = 300; k.height = 300; k.getContext("2d").fillRect(0, 0, 300, 300);
      const blob = await new Promise((ok) => k.toBlob(ok, "image/jpeg", 0.9));
      for (const id of ["#m-foto", "#m-comprovante"]) { const dt = new DataTransfer(); dt.items.add(new File([blob], "foto.jpg", { type: "image/jpeg" }));
        $q(id).files = dt.files; $q(id).dispatchEvent(new Event("change", { bubbles: true })); }
      await new Promise((ok) => setTimeout(ok, 600));
      /* tudo preenchido MENOS a declaração: o aviso tem de ser o dela */
      $q("#m-decl-ok").click();
      $q(".mat-enviar").click();
      await new Promise((ok) => setTimeout(ok, 300));
      const semDecl = $q("#mat-erro").hidden ? "" : $q("#mat-erro").textContent;
      const travouDeNovo = $q("#mat-pagamento").disabled;
      $q("#m-decl-ok").click();
      $q("#mat-erro").hidden = true;
      $q(".mat-enviar").click();
      for (let i = 0; i < 40; i++) { await new Promise((ok) => setTimeout(ok, 400)); if (!$q("#mat-ok").hidden || !$q("#mat-erro").hidden) break; }
      return { recebida: !$q("#mat-ok").hidden, erro: $q("#mat-erro").hidden ? null : $q("#mat-erro").textContent, semDecl, travouDeNovo }; })()`);
    certo("ficha completa SEM a declaração: o aviso é o da declaração, e foto/pagamento travam de novo", /aceite a declaração do responsável/.test(r.semDecl) && r.travouDeNovo, JSON.stringify({ semDecl: r.semDecl, trava: r.travouDeNovo }));
    certo("criança com \"Não\" e a declaração aceita: a matrícula ENTRA", r.recebida, r.erro || "");
    const pre = (await api("/api/gestao/alunos?status=pendente")).j.alunos.find((x) => x.nome === "Zz Qa Criança Saúde");
    const ficha = pre && (await api(`/api/gestao/alunos/${pre.id}`)).j.aluno;
    const cons = ficha ? JSON.parse(ficha.consentimento || "{}") : {};
    certo("…e grava exatamente o que foi marcado, a resposta \"nao\" e a declaração (nome e CPF)", ficha && ficha.saude === "Asma; Outra: Alergia a abelha"
      && !ficha.transtornos && ficha.necessidade === "nao" && cons.declaracao && cons.declaracao.nome === "Zz Qa Responsável Jr"
      && cons.declaracao.cpf === "111.444.777-35", JSON.stringify(ficha && { s: ficha.saude, t: ficha.transtornos, n: ficha.necessidade, d: cons.declaracao && cons.declaracao.nome }));

    /* ------------------------------------------------------------- 5. celular */
    await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
    await cdp("Page.navigate", { url: BASE + "/matricula/" });
    await ate(`!!document.querySelector("#m-saude .lb__busca")`);
    await na(AUX + `tirarCookies(); dataNasc("2017-06-10"); abrirLista("m-saude"); true`);
    await espera(300);
    const larg = await na(`({ pagina: document.documentElement.scrollWidth, tela: innerWidth, lista: !$q("#m-saude .lb__lista").hidden })`);
    certo("no celular, a lista aberta não cria barra lateral", larg.lista && larg.pagina <= larg.tela, JSON.stringify(larg));
    await cdp("Emulation.clearDeviceMetricsOverride");

    /* -------------------------------------------------------------- 6. painel */
    const doPainel = await api("/api/gestao/alunos", "POST", { sexo: "Masculino", nacionalidade: "Brasileira", mae: "Zz Qa Mãe", pai: "Não consta",
      fone1: "(81) 99999-0000", cep: "55038-270", logradouro: "Avenida Caruaru", numero: "579", bairro: "Boa Vista", cidade: "Caruaru", uf: "PE",
      resp_nome: "Zz Qa Resp", resp_cpf: "529.982.247-25", resp_rg: "9172964", resp_rg_emissor: "SDS/PE", resp_fone: "(81) 99999-0001",
      resp_estado_civil: "Casado(a)", resp_profissao: "Comerciante", resp_nacionalidade: "Brasileira",
      nome: "Zz Qa Painel Bronquite", nascimento: "2016-01-01", saude: "Bronquite; Outra: Usa bombinha", necessidade: "nao" });
    certo("painel: aluno criado com as respostas", doPainel.status === 200, JSON.stringify(doPainel.j).slice(0, 160));
    await cdp("Page.navigate", { url: BASE + "/admin/" });
    await ate(`!!document.querySelector('.navbtn[data-p="g-alunos"]')`, 15000);
    await na(`document.querySelector('.navbtn[data-p="g-alunos"]').click()`);
    await ate(`!!document.querySelector('[data-acao="editar"][data-id="${doPainel.j.id}"]')`, 15000);
    await na(`document.querySelector('[data-acao="editar"][data-id="${doPainel.j.id}"]').click()`);
    await ate(`!!document.querySelector("#fa-saude .lb__chip")`, 10000);
    const fichaPainel = await na(`({ saude: [...document.querySelectorAll("#fa-saude .lb__chip span")].map((s) => s.textContent.trim()),
      semTranstornos: !document.querySelector("#fa-transtornos"), nec: document.querySelector("#fa-necessidade").value,
      outra: document.querySelector("#fa-saude .lb__outra").value })`);
    certo("painel: a ficha mostra as respostas gravadas como etiquetas (com a \"Outra\" no campo dela)",
      JSON.stringify(fichaPainel.saude) === JSON.stringify(["Bronquite", "Outra: Usa bombinha"]) && fichaPainel.semTranstornos && fichaPainel.nec === "nao"
      && fichaPainel.outra === "Usa bombinha", JSON.stringify(fichaPainel));
    await na(`(() => { const s = document.querySelector("#fa-necessidade"); s.value = "sim"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await na(`document.querySelector('#form-aluno button[type="submit"]').click()`);
    await espera(1200);
    const depois = (await api(`/api/gestao/alunos/${doPainel.j.id}`)).j.aluno;
    certo("painel: trocar a resposta para \"Sim\" e Salvar grava (no painel não trava)", depois.necessidade === "sim" && depois.saude === "Bronquite; Outra: Usa bombinha",
      JSON.stringify({ s: depois.saude, n: depois.necessidade }));

    ws.close();
  } catch (e) {
    falhas.push("execução: " + e.message);
    console.log("  FALHA execução — " + e.message);
  } finally {
    if (chrome) chrome.kill();
    servidor.kill();
    await espera(500);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {}
    console.log(`\n  ${ok} passaram, ${falhas.length} falharam`);
    if (falhas.length) { console.log("  " + falhas.join("\n  ")); process.exitCode = 1; }
  }
})();
