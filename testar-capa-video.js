/* ==========================================================================
   testar-capa-video.js — a capa tirada do próprio vídeo (1.33.0)

   O PEDIDO: "os vídeos estão com uma capa genérica quando inseridos. Devem
   criar uma capa visual, feito fizemos em outro lugar" (o Kenósis 2.14.0).

   O que esta suíte prova, num Chrome de verdade:
     · o vídeo é entregue POR FAIXA (206/416/HEAD) — sem isso a busca cai no
       segundo 0, o player não deixa avançar e a capa sai PRETA;
     · os vídeos que já estavam no ar ganham capa ao abrir o painel;
     · o vídeo enviado pelo botão "Enviar vídeo" ganha capa na hora, e a
       miniatura da linha vira ela;
     · o quadro escolhido NÃO é o preto do começo (o vídeo de ensaio começa
       com 1,5 s de tela preta, e o MediaRecorder grava sem duração —
       exatamente o caso que fez o Kenósis sair preto na primeira versão);
     · publicado, a capa está no cartão do Feed (com as medidas reais), no
       poster do player, no og:image, no JSON-LD e no vídeo da Estrutura;
     · o /api/capa-video recusa o que não deve (sem sessão, vídeo que não
       existe, caminho torto, PNG, bytes que não são JPEG, arquivo grande).

   RODA NUMA CÓPIA do projeto: o "Publicar" reescreve o index.html e o blog/,
   e o envio grava em assets/video/. Nada da pasta de verdade é tocado; o
   banco é temporário (FF_DATA). Sem Chrome, a parte do navegador é pulada.

     node testar-capa-video.js
   ========================================================================== */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/* 5337: longe das outras suítes (5311, 5318, 5322, 5331, 5333, 5335). */
const PORTA = Number(process.env.PORTA_TESTE_CAPA) || 5337;
const BASE = `http://127.0.0.1:${PORTA}`;
const DEP = PORTA + 1000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forms-capa-"));
const COPIA = path.join(TMP, "site");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0; const falhas = [];
function certo(nome, cond, detalhe = "") {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}

/* A cópia: tudo menos dados, backups, vídeos e dependências. As
   dependências vêm da pasta real por NODE_PATH — e não por junção: apagar a
   cópia no fim nunca pode alcançar o node_modules de verdade. */
function copiarProjeto() {
  const fora = /^(node_modules|data|backups|\.git)$|^assets[\\/]video$/;
  fs.cpSync(__dirname, COPIA, { recursive: true,
    filter: (src) => !fora.test(path.relative(__dirname, src)) });
}

(async () => {
  console.log("\n=== A capa tirada do próprio vídeo ===\n");
  copiarProjeto();

  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: COPIA,
    env: { ...process.env, NODE_PATH: path.join(__dirname, "node_modules"), PORT: String(PORTA), FF_DATA: path.join(TMP, "data"), FF_BACKUPS: path.join(TMP, "backups"),
      BACKUP_HORAS: "100000", FF_ENV: path.join(TMP, "vazio.env") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "forms-capa-chrome-"));
  const VIDEOS = path.join(COPIA, "assets", "video");
  let chrome = null;
  try {
    let vivo = false;
    for (let i = 0; i < 60 && !vivo; i++) { try { await fetch(BASE + "/"); vivo = true; } catch { await espera(250); } }
    if (!vivo) throw new Error("o servidor não subiu:\n" + log.slice(-800));
    const ent = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "forms-admin" }) });
    const sid = (ent.headers.get("set-cookie") || "").split(";")[0].split("=")[1];
    const A = "sid=" + sid;
    const api = async (rota, metodo = "GET", corpo, cookie = A) => {
      const r = await fetch(BASE + rota, { method: metodo, headers: { cookie, "content-type": "application/json" },
        body: corpo ? JSON.stringify(corpo) : undefined });
      return { status: r.status, j: await r.json().catch(() => ({})) };
    };

    /* ------------------------------------------- 1. entrega por faixa (HTTP)
       Com um arquivo de bytes conhecidos, dá para conferir cada pedaço. */
    const amostra = Buffer.alloc(5000); for (let i = 0; i < amostra.length; i++) amostra[i] = i % 251;
    fs.writeFileSync(path.join(VIDEOS, "zz-qa-faixa.mp4"), amostra);
    const U = BASE + "/assets/video/zz-qa-faixa.mp4";
    const r0 = await fetch(U, { headers: { range: "bytes=0-1" } });
    const b0 = Buffer.from(await r0.arrayBuffer());
    certo("Range bytes=0-1 → 206 com 2 bytes (o primeiro pedido do iPhone)", r0.status === 206 && b0.length === 2 && b0[1] === 1, `${r0.status} ${b0.length}`);
    certo("…com Content-Range bytes 0-1/5000", r0.headers.get("content-range") === "bytes 0-1/5000", r0.headers.get("content-range"));
    const r1 = await fetch(U, { headers: { range: "bytes=4000-" } });
    const b1 = Buffer.from(await r1.arrayBuffer());
    certo("Range aberto (4000-) → os últimos 1000 bytes, certos", r1.status === 206 && b1.length === 1000 && b1.equals(amostra.subarray(4000)));
    const r2 = await fetch(U, { headers: { range: "bytes=-500" } });
    const b2 = Buffer.from(await r2.arrayBuffer());
    certo("Range de sufixo (-500) → os últimos 500", r2.status === 206 && b2.equals(amostra.subarray(4500)), r2.headers.get("content-range"));
    const r3 = await fetch(U, { headers: { range: "bytes=9000-9999" } });
    certo("Range fora do arquivo → 416 com bytes */5000", r3.status === 416 && r3.headers.get("content-range") === "bytes */5000", `${r3.status}`);
    const r4 = await fetch(U);
    const b4 = Buffer.from(await r4.arrayBuffer());
    certo("sem Range → 200, arquivo inteiro, Content-Length e Accept-Ranges", r4.status === 200 && b4.equals(amostra)
      && r4.headers.get("content-length") === "5000" && r4.headers.get("accept-ranges") === "bytes");
    const r5 = await fetch(U, { method: "HEAD" });
    certo("HEAD → 200 com Content-Length e sem corpo", r5.status === 200 && r5.headers.get("content-length") === "5000"
      && (await r5.arrayBuffer()).byteLength === 0);
    const rh = await fetch(BASE + "/");
    certo("a página continua saindo inteira (200, text/html)", rh.status === 200 && /text\/html/.test(rh.headers.get("content-type") || "")
      && (await rh.text()).includes("</html>"));
    const rx = await fetch(BASE + "/server.js", { headers: { range: "bytes=0-10" } });
    certo("Range não abre o que é proibido (server.js continua 404)", rx.status === 404, String(rx.status));
    fs.unlinkSync(path.join(VIDEOS, "zz-qa-faixa.mp4"));

    /* -------------------------------------- 2. o que o /api/capa-video recusa */
    fs.writeFileSync(path.join(VIDEOS, "zz-qa-recusa.mp4"), amostra);
    const JPG = "data:image/jpeg;base64,";
    const jpegDeMentira = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
    const sem = await api("/api/capa-video", "POST", { video: "/assets/video/zz-qa-recusa.mp4", dataUrl: JPG + jpegDeMentira.toString("base64") }, "sid=nada");
    certo("sem sessão → 401", sem.status === 401, String(sem.status));
    const semLista = await api("/api/videos-sem-capa", "GET", null, "sid=nada");
    certo("lista de vídeos sem capa, sem sessão → 401", semLista.status === 401, String(semLista.status));
    const nao = await api("/api/capa-video", "POST", { video: "/assets/video/zz-qa-nao-existe.mp4", dataUrl: JPG + jpegDeMentira.toString("base64") });
    certo("vídeo que não existe → 400", nao.status === 400, String(nao.status));
    const torto = await api("/api/capa-video", "POST", { video: "/assets/video/../../server.mp4", dataUrl: JPG + jpegDeMentira.toString("base64") });
    certo("caminho torto (../) → 400", torto.status === 400, String(torto.status));
    const png = await api("/api/capa-video", "POST", { video: "/assets/video/zz-qa-recusa.mp4", dataUrl: "data:image/png;base64,iVBORw0KGgo=" });
    certo("PNG → 400", png.status === 400, String(png.status));
    const html = await api("/api/capa-video", "POST", { video: "/assets/video/zz-qa-recusa.mp4", dataUrl: JPG + Buffer.from("<script>alert(1)</script>").toString("base64") });
    certo("bytes que não são JPEG, com rótulo de JPEG → 400", html.status === 400, String(html.status));
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3.2 * 1024 * 1024)]);
    const gr = await api("/api/capa-video", "POST", { video: "/assets/video/zz-qa-recusa.mp4", dataUrl: JPG + grande.toString("base64") });
    certo("capa acima de 3 MB → 413", gr.status === 413, String(gr.status));
    certo("…e nenhuma das recusas deixou arquivo para trás", !fs.existsSync(path.join(VIDEOS, "zz-qa-recusa.jpg"))
      && !fs.readdirSync(VIDEOS).some((f) => f.includes(".tmp-")), fs.readdirSync(VIDEOS).join(", "));
    const boa = await api("/api/capa-video", "POST", { video: "/assets/video/zz-qa-recusa.mp4", dataUrl: JPG + jpegDeMentira.toString("base64") });
    certo("JPEG de verdade → 200, gravado AO LADO do vídeo com o mesmo nome", boa.status === 200 && boa.j.capa === "/assets/video/zz-qa-recusa.jpg"
      && fs.readFileSync(path.join(VIDEOS, "zz-qa-recusa.jpg")).equals(jpegDeMentira), JSON.stringify(boa.j));
    fs.unlinkSync(path.join(VIDEOS, "zz-qa-recusa.mp4")); fs.unlinkSync(path.join(VIDEOS, "zz-qa-recusa.jpg"));

    /* ------------------------------------------------------- 3. no navegador */
    const CHROME = [process.env.CHROME,
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((c) => { try { return fs.existsSync(c); } catch { return false; } });
    if (!CHROME) { console.log("  · navegador pulado: não achei o Chrome (defina CHROME=<caminho>)"); return; }

    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--autoplay-policy=no-user-gesture-required",
      `--remote-debugging-port=${DEP}`, `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
    let alvos = null;
    for (let i = 0; i < 60 && !alvos; i++) { try { alvos = await (await fetch(`http://127.0.0.1:${DEP}/json/list`)).json(); } catch { await espera(250); } }
    const ws = new WebSocket(alvos.find((a) => a.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let seq = 0; const esp = new Map(); const eventos = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && esp.has(m.id)) { esp.get(m.id)(m); esp.delete(m.id); }
      else if (m.method) eventos.push(m);
    });
    const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; esp.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const na = async (expr, gesto = false) => {
      const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gesto });
      if (r.result.exceptionDetails) throw new Error("no navegador: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result.result?.value;
    };
    const ate = async (expr, ms = 45000) => {
      for (let t = 0; t < ms; t += 300) { if (await na(expr)) return true; await espera(300); }
      return false;
    };
    await cdp("Page.enable");
    await cdp("Network.enable");
    await cdp("Network.setCookie", { name: "sid", value: sid, url: BASE });
    await cdp("Page.navigate", { url: BASE + "/privacidade/" });
    await espera(1200);

    /* O vídeo de ensaio: 1,5 s de tela PRETA e depois laranja com um bloco
       azul, gravado pelo MediaRecorder (que não grava a duração). */
    const gravar = (cor, preto) => `(async () => {
      const c = document.createElement("canvas"); c.width = 640; c.height = 360;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
      const partes = []; rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
      const t0 = performance.now(); rec.start(200);
      await new Promise((pronto) => { const tique = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = t < ${preto} ? "#000" : "${cor}"; g.fillRect(0, 0, 640, 360);
        if (t >= ${preto}) { g.fillStyle = "#0B4EA2"; g.fillRect(40, 40, 200, 120); }
        if (t > 4) { clearInterval(tique); pronto(); }
      }, 33); });
      rec.stop(); await new Promise((r) => (rec.onstop = r));
      const blob = new Blob(partes, { type: "video/webm" });
      return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(",")[1]); f.readAsDataURL(blob); });
    })()`;
    const videoA = Buffer.from(await na(gravar("#ff8a00", 1.5)), "base64");
    const videoB = Buffer.from(await na(gravar("#22cc66", 1.5)), "base64");
    certo("dois vídeos de ensaio gravados (começam pretos)", videoA.length > 5000 && videoB.length > 5000, `${videoA.length} / ${videoB.length}`);

    const enviar = async (buf, nome) => {
      const r = await fetch(BASE + "/api/upload-video", { method: "POST",
        headers: { cookie: A, "content-type": "video/webm", "x-nome-arquivo": nome }, body: buf });
      return (await r.json()).path;
    };
    /* Dois vídeos "que já estavam no ar": um numa matéria, outro na Estrutura.
       E uma matéria apontando para um vídeo que não existe mais. */
    const vMateria = await enviar(videoA, "zz-qa-materia.webm");
    const vEstrutura = await enviar(videoA, "zz-qa-estrutura.webm");
    const hoje = new Date().toISOString().slice(0, 10);
    await api("/api/posts", "POST", { title: "Zz Qa Matéria em Vídeo", excerpt: "Ensaio", content: "<p>Ensaio.</p>", image: vMateria, date: hoje });
    await api("/api/posts", "POST", { title: "Zz Qa Vídeo Sumido", excerpt: "Ensaio", content: "<p>Ensaio.</p>", image: "/assets/video/zz-qa-sumiu.mp4", date: hoje });
    await api("/api/settings", "PUT", { estrutura_video: vEstrutura });
    const faltam = (await api("/api/videos-sem-capa")).j.videos || [];
    certo("a lista dos sem capa traz a matéria E a Estrutura (e não o vídeo que sumiu)",
      faltam.length === 2 && faltam.some((v) => v.tabela === "posts" && v.video === vMateria)
      && faltam.some((v) => v.tabela === "settings" && v.video === vEstrutura), JSON.stringify(faltam));

    /* Abrir o painel basta: ele tira a capa de quem não tem. */
    await cdp("Page.navigate", { url: BASE + "/admin/" });
    const capaM = vMateria.replace(/\.webm$/, ".jpg"), capaE = vEstrutura.replace(/\.webm$/, ".jpg");
    let deu = false;
    for (let t = 0; t < 60000 && !deu; t += 500) {
      deu = fs.existsSync(path.join(COPIA, capaM)) && fs.existsSync(path.join(COPIA, capaE));
      if (!deu) await espera(500);
    }
    certo("ao abrir o painel, os dois vídeos antigos ganham capa", deu, fs.readdirSync(VIDEOS).join(", "));
    certo("…e a lista dos sem capa esvazia", ((await api("/api/videos-sem-capa")).j.videos || []).length === 0);

    /* A capa tem de ser o LARANJA, não o preto do começo. Mede no navegador,
       que decodifica o JPEG. */
    const medir = (url) => na(`new Promise((ok) => { const i = new Image(); i.onload = () => {
        const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight;
        const g = c.getContext("2d"); g.drawImage(i, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0, n = 0;
        for (let p = 0; p < d.length; p += 4 * 53) { r += d[p]; gg += d[p + 1]; b += d[p + 2]; n++; }
        ok({ w: i.naturalWidth, h: i.naturalHeight, r: r / n, g: gg / n, b: b / n,
             luz: (r * 0.299 + gg * 0.587 + b * 0.114) / n }); };
      i.onerror = () => ok(null); i.src = ${JSON.stringify(BASE + url + "?t=" + Date.now())}; })`);
    const mM = await medir(capaM);
    certo("a capa da matéria NÃO é o quadro preto do começo", mM && mM.luz > 60, JSON.stringify(mM));
    certo("…é o laranja do vídeo (vermelho alto, azul baixo)", mM && mM.r > 180 && mM.b < 110, JSON.stringify(mM));
    certo("…no tamanho do vídeo (640×360)", mM && mM.w === 640 && mM.h === 360, JSON.stringify(mM));
    const mE = await medir(capaE);
    certo("a capa do vídeo da Estrutura também é o laranja", mE && mE.luz > 60 && mE.r > 180, JSON.stringify(mE));

    /* A miniatura da linha vira a capa; o vídeo sem arquivo fica com o ▶. */
    await cdp("Page.navigate", { url: BASE + "/admin/" });
    await ate(`document.querySelectorAll('[data-t="posts"][data-f="image"]').length >= 2`, 15000);
    await espera(1500);
    const minis = await na(`(() => {
      const linha = (titulo) => [...document.querySelectorAll('[data-t="posts"][data-f="title"]')].find((i) => i.value === titulo);
      const mini = (titulo) => { const l = linha(titulo); if (!l) return null;
        const row = document.querySelector('[data-t="posts"][data-id="' + l.dataset.id + '"][data-f="image"]').parentElement;
        const img = row.querySelector("img.thumb"), seta = row.querySelector(".thumb--video");
        return { img: img ? { src: img.getAttribute("src"), carregou: img.complete && img.naturalWidth > 0 } : null,
                 seta: seta ? getComputedStyle(seta).display !== "none" : false, id: l.dataset.id }; };
      return { m: mini("Zz Qa Matéria em Vídeo"), s: mini("Zz Qa Vídeo Sumido") };
    })()`);
    certo("no painel, a miniatura da matéria é a capa (e carrega)", minis.m && minis.m.img && minis.m.img.src === capaM
      && minis.m.img.carregou && !minis.m.seta, JSON.stringify(minis.m));
    certo("…e o vídeo sem capa possível mostra o ▶, sem imagem quebrada", minis.s && !minis.s.img && minis.s.seta, JSON.stringify(minis.s));

    /* ------------- 4. o vídeo NOVO, pelo botão "Enviar vídeo" de verdade
       O seletor de arquivo é interceptado e recebe o vídeo B do disco. */
    const arqB = path.join(TMP, "zz-qa-novo.webm"); fs.writeFileSync(arqB, videoB);
    await cdp("Page.setInterceptFileChooserDialog", { enabled: true });
    eventos.length = 0;
    await na(`(() => { const row = document.querySelector('[data-t="posts"][data-id="${minis.m.id}"][data-f="image"]').parentElement;
      [...row.querySelectorAll("button")].find((b) => /Enviar vídeo/.test(b.textContent)).click(); })()`, true);
    let escolha = null;
    for (let t = 0; t < 5000 && !escolha; t += 100) { escolha = eventos.find((e) => e.method === "Page.fileChooserOpened"); if (!escolha) await espera(100); }
    certo("o botão Enviar vídeo abre o seletor de arquivo", !!escolha);
    if (escolha) await cdp("DOM.setFileInputFiles", { files: [arqB], backendNodeId: escolha.params.backendNodeId });
    const trocou = await ate(`(() => { const row = document.querySelector('[data-t="posts"][data-id="${minis.m.id}"][data-f="image"]').parentElement;
      const img = row.querySelector("img.thumb"); return !!(img && /\\?t=/.test(img.src) && img.complete && img.naturalWidth > 0); })()`, 60000);
    const novo = await na(`document.querySelector('[data-t="posts"][data-id="${minis.m.id}"][data-f="image"]').value`);
    certo("enviado pelo botão, o vídeo novo entra no campo", novo !== vMateria && /^\/assets\/video\/.+zz-qa-novo\.webm$/.test(novo), novo);
    certo("…e a miniatura da linha vira a capa dele na hora", trocou);
    const capaN = String(novo).replace(/\.webm$/, ".jpg");
    const mN = await medir(capaN);
    certo("…que é o VERDE do vídeo novo, não o preto", mN && mN.luz > 60 && mN.g > 150 && mN.r < 120, JSON.stringify(mN));
    const toastTxt = await na(`document.querySelector("#toast").textContent`);
    certo("…e o aviso diz que a capa saiu do próprio vídeo", /capa tirada do próprio vídeo/.test(toastTxt), toastTxt);

    /* Salva pelo botão da linha e publica. */
    await na(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("onclick") === "saveRow('posts',${minis.m.id})"); b.click(); })()`, true);
    await espera(1200);
    const pub = await api("/api/publish", "POST");
    certo("publicado", pub.status === 200, JSON.stringify(pub.j).slice(0, 200));

    /* ------------------------------------------------- 5. o que o site mostra */
    const blog = await (await fetch(BASE + "/blog/")).text();
    const cartao = /<a class="post-card__media post-card__media--video" href="\/blog\/zz-qa-materia-em-video\/"[^>]*><img ([^>]+)>/.exec(blog);
    certo("no Feed, o cartão da matéria em vídeo usa a capa do vídeo novo", cartao && cartao[1].includes(`src="${capaN}"`), cartao ? cartao[1] : "cartão não achado");
    certo("…com as medidas REAIS da capa (640×360), contra o salto de layout", cartao && /width="640" height="360"/.test(cartao[1]), cartao ? cartao[1] : "");
    const sumido = /href="\/blog\/zz-qa-video-sumido\/"[^>]*><img src="([^"]+)"/.exec(blog);
    certo("o vídeo sem capa continua com a capa genérica", sumido && sumido[1] === "/assets/img/capa-video.svg", sumido ? sumido[1] : "");
    const post = await (await fetch(BASE + "/blog/zz-qa-materia-em-video/")).text();
    certo("na matéria, o player tem a capa como poster", post.includes(`poster="${capaN}"`));
    certo("…o og:image é a capa, com o domínio", post.includes(`<meta property="og:image" content="https://formsfitness.com${capaN}">`));
    const ld = [...post.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return {}; } });
    const art = ld.find((x) => x["@type"] === "Article");
    certo("…e o JSON-LD aponta a capa (não o .mp4/.webm)", art && art.image === `https://formsfitness.com${capaN}`, art && art.image);
    const home = await (await fetch(BASE + "/")).text();
    certo("na home, o vídeo da Estrutura tem a capa dele como poster", home.includes(`poster="${capaE}"`));

    /* E o player deixa avançar — o que a entrega por faixa conserta. */
    await cdp("Page.navigate", { url: BASE + "/blog/zz-qa-materia-em-video/" });
    await espera(1500);
    const pulo = await na(`new Promise((ok) => {
      const v = document.querySelector(".post__cover--video video");
      const vai = () => { v.onseeked = () => ok({ t: v.currentTime, pulavel: v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) > 1 });
        v.currentTime = 2.5; };
      if (v.readyState >= 1) vai(); else v.onloadedmetadata = vai;
      setTimeout(() => ok({ t: v.currentTime, pulavel: false, demorou: true }), 15000);
    })`);
    certo("no site, dá para avançar o vídeo (a busca não volta para o 0)", pulo.pulavel && pulo.t > 2, JSON.stringify(pulo));

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
    console.log(`\n  ${ok} ok, ${falhas.length} falha(s)`);
    if (falhas.length) { console.log("  " + falhas.join("\n  ")); process.exitCode = 1; }
  }
})();
