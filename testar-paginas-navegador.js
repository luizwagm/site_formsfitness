/* ==========================================================================
   testar-paginas-navegador.js — o número da página nos impressos (1.32.0)

   O PEDIDO: "nos relatórios, quando der 2+ páginas, coloque na impressão o
   número da página".

   Quem escreve "Página 2 de 5" é o rodapé de @page (counter(page) / (pages)).
   Quem decide SE escreve é uma medição na própria página (gestao/documentos.js,
   `numerar`): passou de uma folha, numera; coube em uma, não põe "Página 1 de 1".

   Medição é palpite até ser conferida no PAPEL. Por isso esta suíte imprime de
   verdade (Chrome, Page.printToPDF), CONTA as folhas do PDF e exige que a
   numeração esteja ligada exatamente quando o PDF tem 2 folhas ou mais — com
   um relatório curto, um longo, um no limite, e a agenda (que é horizontal).

   Sobe o PRÓPRIO servidor com banco temporário (FF_DATA): nada do banco da
   academia é tocado. Sem Chrome, a parte do navegador é pulada e diz que foi.

     node testar-paginas-navegador.js
   ========================================================================== */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/* 5335: longe das outras suítes (5311, 5318, 5322, 5331, 5333). */
const PORTA = Number(process.env.PORTA_TESTE_PAG) || 5335;
const BASE = `http://127.0.0.1:${PORTA}`;
const DEP = PORTA + 1000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-paginas-"));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0; const falhas = [];
function certo(nome, cond, detalhe = "") {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}

/* Um CPF válido a partir de um número qualquer (o cadastro novo exige CPF). */
function cpfDe(n) {
  const b = String(100000000 + n).slice(-9);
  const dv = (s) => { let t = 0; for (let i = 0; i < s.length; i++) t += Number(s[i]) * (s.length + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b), d2 = dv(b + d1);
  const c = b + d1 + d2;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}
const FICHA = {
  sexo: "Feminino", nacionalidade: "Brasileira", mae: "Zz Qa Mae", pai: "Não consta",
  fone1: "(81) 99999-0000", email: "zz.qa@exemplo.test", nascimento: "1980-01-01",
  rg: "1234567", rg_emissor: "SDS/PE", estado_civil: "Solteiro(a)", profissao: "Professora",
  cep: "55038-270", logradouro: "Avenida Caruaru", numero: "579", bairro: "Boa Vista", cidade: "Caruaru", uf: "PE",
};

(async () => {
  console.log("\n=== O número da página nos impressos ===\n");

  const doc = fs.readFileSync(path.join(__dirname, "gestao", "documentos.js"), "utf8");
  certo("o rodapé numera com counter(page) de counter(pages)", /counter\(page\) " de " counter\(pages\)/.test(doc));
  certo("…e só quando a medição diz que passou de uma folha", doc.includes("var varias = miolo.offsetHeight > util + 1;"));

  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000", FF_ENV: path.join(TMP, "vazio.env") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "forms-paginas-chrome-"));
  let chrome = null;
  try {
    let vivo = false;
    for (let i = 0; i < 60 && !vivo; i++) { try { await fetch(BASE + "/"); vivo = true; } catch { await espera(250); } }
    if (!vivo) throw new Error("o servidor não subiu:\n" + log.slice(-800));
    /* Banco novo: a senha é a da semente — a do banco de ENSAIO, que morre no fim. */
    const ent = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "forms-admin" }) });
    const sid = (ent.headers.get("set-cookie") || "").split(";")[0].split("=")[1];
    const A = "sid=" + sid;
    const novo = async (i, status) => {
      const r = await fetch(BASE + "/api/gestao/alunos", { method: "POST", headers: { cookie: A, "content-type": "application/json" },
        body: JSON.stringify({ ...FICHA, nome: `Zz Qa Aluno ${String(i).padStart(3, "0")}`, cpf: cpfDe(i), status }) });
      return r.status;
    };
    /* Três tamanhos: 3 inativos (uma folha), 120 ativos (várias). */
    let criados = 0;
    for (let i = 1; i <= 3; i++) if (await novo(i, "inativo") === 200) criados++;
    for (let i = 4; i <= 123; i++) if (await novo(i, "ativo") === 200) criados++;
    certo("123 alunos de ensaio cadastrados", criados === 123, String(criados));

    const CHROME = [process.env.CHROME,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((c) => { try { return fs.existsSync(c); } catch { return false; } });
    if (!CHROME) { console.log("  · navegador pulado: não achei o Chrome (defina CHROME=<caminho>)"); return; }

    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEP}`,
      `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
    let alvos = null;
    for (let i = 0; i < 60 && !alvos; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${DEP}/json/list`)).json(); } catch { await espera(250); } }
    const ws = new WebSocket(alvos.find((a) => a.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let seq = 0; const esp = new Map();
    ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && esp.has(m.id)) { esp.get(m.id)(m); esp.delete(m.id); } });
    const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const na = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result?.value;
    await cdp("Network.enable");
    await cdp("Network.setCookie", { name: "sid", value: sid, url: BASE });

    /* Abre o impresso, lê a decisão da página e imprime; devolve as duas coisas. */
    async function imprimir(rota, { horizontal = false } = {}) {
      await cdp("Page.navigate", { url: BASE + rota });
      await espera(1800);
      if (horizontal !== null) await na(`(() => { const b = document.querySelector('[data-orient="${horizontal ? "h" : "v"}"]'); if (b) b.click(); })()`);
      await espera(200);
      const decisao = await na(`({ numerada: document.body.classList.contains("numerada"),
        regra: document.getElementById("numeracao")?.textContent || "" })`);
      const pdf = await cdp("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const bytes = Buffer.from(pdf.result.data, "base64").toString("latin1");
      /* PAGINAS_PDF=<pasta> guarda os PDFs, para conferir o papel com os olhos. */
      if (process.env.PAGINAS_PDF) fs.writeFileSync(path.join(process.env.PAGINAS_PDF,
        rota.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") + (horizontal ? "-h" : "") + ".pdf"), Buffer.from(pdf.result.data, "base64"));
      const folhas = (bytes.match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
      return { ...decisao, folhas };
    }

    const curto = await imprimir("/admin/imprimir/relatorio/alunos?status=inativo");
    certo("relatório de UMA folha: sai com 1 folha", curto.folhas === 1, `${curto.folhas} folhas`);
    certo("…e SEM número de página (nada de \"Página 1 de 1\")", !curto.numerada && curto.regra === "", JSON.stringify(curto));

    /* NO LIMITE. É aqui que uma medição errada apareceria: a linha que
       empurra o relatório para a segunda folha. Vai somando inativos um a um
       até o PDF virar duas folhas (e um pouco além), e a cada passo a decisão
       da página tem de bater com o papel. */
    let n = 3, viraDuas = 0, desencontros = [];
    for (let passo = 0; passo < 90 && (!viraDuas || n < viraDuas + 2); passo++) {
      n++;
      await novo(500 + n, "inativo");
      const r = await imprimir("/admin/imprimir/relatorio/alunos?status=inativo", { horizontal: false });
      if (r.numerada !== (r.folhas >= 2)) desencontros.push(`${n} alunos: ${r.folhas} folha(s), numerada=${r.numerada}`);
      if (!viraDuas && r.folhas >= 2) viraDuas = n;
    }
    certo(`no limite (vira 2 folhas com ${viraDuas} alunos): a numeração bate com o papel a cada aluno a mais`,
      viraDuas > 0 && desencontros.length === 0, desencontros.join(" | ") || "não chegou a 2 folhas");

    const longo = await imprimir("/admin/imprimir/relatorio/alunos?status=ativo");
    certo("relatório de 120 alunos passa de uma folha", longo.folhas >= 2, `${longo.folhas} folhas`);
    certo("…e sai NUMERADO", longo.numerada && /counter\(page\)/.test(longo.regra), JSON.stringify(longo));

    /* A mesma lista deitada: menos linhas por folha, mais folhas. A decisão
       acompanha a orientação escolhida. */
    const deitado = await imprimir("/admin/imprimir/relatorio/alunos?status=ativo", { horizontal: true });
    certo("o mesmo relatório na horizontal continua numerado, com mais folhas",
      deitado.numerada && deitado.folhas > longo.folhas, `${deitado.folhas} × ${longo.folhas}`);

    /* A agenda do mês: horizontal por padrão. Seja quantas folhas forem, a
       regra é a mesma — numerada exatamente quando passa de uma. */
    const hoje = new Date();
    const agenda = await imprimir(`/admin/imprimir/agenda?ano=${hoje.getFullYear()}&mes=${hoje.getMonth() + 1}`, { horizontal: null });
    certo("agenda: numerada exatamente quando tem 2+ folhas", agenda.numerada === (agenda.folhas >= 2), JSON.stringify(agenda));

    /* O caso que mais pega: a ficha e o contrato são feitos para UMA folha. */
    const lista = await (await fetch(BASE + "/api/gestao/alunos?status=ativo", { headers: { cookie: A } })).json();
    const ficha = await imprimir(`/admin/imprimir/ficha/${lista.alunos[0].id}`, { horizontal: null });
    certo("ficha do aluno (uma folha): sem número", ficha.folhas === 1 && !ficha.numerada, JSON.stringify(ficha));
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
