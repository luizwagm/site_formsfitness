/* ==========================================================================
   testar.js — Suíte de testes do gerenciador da Forms Fitness

   Roda contra o servidor DE VERDADE (http://localhost:5186), não contra
   simulações: o que passa aqui é o que o navegador vai encontrar.

       node server.js        (num terminal)
       node testar.js        (no outro)

   POR QUE ISTO EXISTE: cada bloco abaixo cobre uma falha REAL encontrada na
   auditoria do BemEstar — senha sem sal, sessão eterna, força bruta livre,
   upload de SVG, banco exposto na web. Sem teste, nada impede que uma dessas
   volte na próxima alteração do arquivo.

   NÃO ESCREVE NADA POR CIMA DO CONTEÚDO DO CLIENTE: o único registro criado é
   uma matéria com slug "zz-teste-…", apagada no fim. Nenhum texto, foto ou
   configuração do site é tocado.
   ========================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const BASE = { hostname: "127.0.0.1", port: 5186 };
const SENHA = process.env.FORMS_SENHA || "forms-admin";

let ok = 0, falhas = [];
const eq = (nome, achado, esperado) => {
  const bom = JSON.stringify(achado) === JSON.stringify(esperado);
  if (bom) { ok++; console.log(`  ok   ${nome}`); }
  else { falhas.push(nome); console.log(`  FALHA ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         achado:   ${JSON.stringify(achado)}`); }
};
const certo = (nome, cond, detalhe = "") => eq(nome + (detalhe && !cond ? ` — ${detalhe}` : ""), !!cond, true);

/* Requisição crua: precisamos ver cabeçalhos e status, que um cliente
   pronto costuma esconder ou seguir automaticamente. */
function pedir(metodo, caminho, { corpo, cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? null : JSON.stringify(corpo);
    const req = http.request({ ...BASE, method: metodo, path: caminho, headers: {
      ...(dados ? { "content-type": "application/json", "content-length": Buffer.byteLength(dados) } : {}),
      ...(cookie ? { cookie } : {}), ...headers,
    } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, corpo: b, json });
      });
    });
    req.on("error", reject);
    if (dados) req.write(dados);
    req.end();
  });
}

/* Uma imagem PNG EM PÉ, 40×90, montada byte a byte. É o caso que motivou a
   correção: foto vertical de celular, que o layout antigo recortava. */
function pngEmPe() {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const bloco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(corpo));
    return Buffer.concat([tam, corpo, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(40, 0); ihdr.writeUInt32BE(90, 4);
  ihdr[8] = 8; ihdr[9] = 0;                                  // 8 bits, tons de cinza
  const linhas = Buffer.alloc(90 * 41);                      // 1 byte de filtro + 40 px por linha
  const zlib = require("node:zlib");
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    bloco("IHDR", ihdr),
    bloco("IDAT", zlib.deflateSync(linhas)),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

(async () => {
  console.log("\n=== Forms Fitness — suíte de testes ===\n");

  /* ====================================================================
     1. SENHA
     ==================================================================== */
  console.log("-- Senha --");
  {
    const r = await pedir("POST", "/api/login", { corpo: { password: "obviamente-errada-zz" } });
    eq("senha errada é recusada", r.status, 401);
    certo("a resposta não conta o que errou", !/hash|scrypt|sha|usuário/i.test(r.corpo));
  }
  const entrar = await pedir("POST", "/api/login", { corpo: { password: SENHA } });
  eq("senha certa entra", entrar.status, 200);
  const bolo = String(entrar.headers["set-cookie"] || "");
  certo("cookie é HttpOnly (JavaScript da página não lê)", /HttpOnly/i.test(bolo));
  certo("cookie é SameSite (não viaja em requisição de outro site)", /SameSite/i.test(bolo));
  certo("cookie tem prazo — sessão não é eterna", /Max-Age=\d+/i.test(bolo), bolo);
  const sid = (/sid=([a-f0-9]+)/.exec(bolo) || [])[1];
  const COOKIE = `sid=${sid}`;

  /* O hash guardado precisa estar no formato novo: com sal e com os
     parâmetros embutidos. Lemos o arquivo do banco em bruto — se o texto do
     hash antigo (64 hexadecimais soltos) estivesse lá, apareceria. */
  {
    /* Com WAL ligado, a gravação mais recente vive no diário e só depois
       migra para o .db. Ler os dois evita um "falhou" que é só o momento. */
    const bruto = ["site.db", "site.db-wal"].map((a) => {
      try { return fs.readFileSync(path.join(__dirname, "data", a), "latin1"); } catch { return ""; }
    }).join("");
    certo("a senha está gravada em scrypt, com sal", /scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}/.test(bruto));
  }

  /* ====================================================================
     2. SESSÃO
     ==================================================================== */
  console.log("\n-- Sessão --");
  eq("sem cookie, a API nega", (await pedir("GET", "/api/content")).status, 401);
  eq("cookie inventado é negado", (await pedir("GET", "/api/content", { cookie: "sid=" + "f".repeat(48) })).status, 401);
  eq("com cookie válido, a API responde", (await pedir("GET", "/api/content", { cookie: COOKIE })).status, 200);

  /* ====================================================================
     3. CABEÇALHOS DE PROTEÇÃO
     ==================================================================== */
  console.log("\n-- Cabeçalhos --");
  {
    const h = (await pedir("GET", "/")).headers;
    eq("nosniff (navegador não adivinha o tipo do arquivo)", h["x-content-type-options"], "nosniff");
    certo("o site não pode ser embutido em iframe de terceiro",
      /^(DENY|SAMEORIGIN)$/i.test(String(h["x-frame-options"] || "")) || /frame-ancestors/.test(h["content-security-policy"] || ""),
      String(h["x-frame-options"]));
    certo("referrer não vaza a URL inteira para fora", /origin|no-referrer|strict/i.test(h["referrer-policy"] || ""));
    certo("o servidor não anuncia versão do Node", !/node/i.test(String(h["x-powered-by"] || h.server || "")));
  }
  {
    const h = (await pedir("GET", "/admin/", { cookie: COOKIE })).headers;
    certo("o painel tem CSP", !!h["content-security-policy"]);
    certo("o painel não é indexado pelo Google", /noindex/i.test(String(h["x-robots-tag"] || "")));
  }

  /* ====================================================================
     4. FORÇA BRUTA
     ==================================================================== */
  console.log("\n-- Força bruta --");
  {
    /* O bloqueio dura 15 minutos e não tem como ser desfeito de fora — de
       propósito. Se gastássemos as tentativas do IP REAL desta máquina, a
       suíte só poderia rodar uma vez a cada 15 minutos. Por isso queimamos um
       IP FICTÍCIO, entregue no cabeçalho que o nginx usaria. */
    const FALSO = { "x-real-ip": "203.0.113.7" };
    let ultimo = 0;
    for (let i = 0; i < 6; i++)
      ultimo = (await pedir("POST", "/api/login", { corpo: { password: "zz-errada-" + i }, headers: FALSO })).status;
    eq("depois de 5 erros o IP é barrado", ultimo, 429);
    eq("bloqueado, nem a senha certa passa",
      (await pedir("POST", "/api/login", { corpo: { password: SENHA }, headers: FALSO })).status, 429);

    /* REGRESSÃO DE UMA FALHA REAL, encontrada ao escrever esta suíte.

       O nginx monta `X-Forwarded-For: <o que o cliente mandou>, <IP real>`. O
       código lia o PRIMEIRO item — ou seja, o texto que o próprio visitante
       escreveu. Trocando esse texto a cada tentativa, cada erro caía num
       "IP" novo e o quinto erro nunca chegava: a trava simplesmente não
       existia. Aqui o primeiro item muda toda vez e o último, que é o que o
       nginx escreve, continua sendo o IP já bloqueado. Tem de continuar 429. */
    let furou = 0;
    for (let i = 0; i < 4; i++) {
      const r = await pedir("POST", "/api/login", { corpo: { password: "zz-errada" },
        headers: { "x-forwarded-for": `198.51.100.${i}, 203.0.113.7` } });
      if (r.status !== 429) furou++;
    }
    eq("trocar o X-Forwarded-For não escapa da trava", furou, 0);

    /* Sem proxy nenhum, o socket manda: um IP não pode carregar o bloqueio de
       outro, senão cinco erros de um visitante derrubariam o painel do dono. */
    certo("o bloqueio é só daquele IP — este aqui continua entrando",
      (await pedir("POST", "/api/login", { corpo: { password: SENHA } })).status === 200);
    certo("a sessão já aberta continua valendo",
      (await pedir("GET", "/api/content", { cookie: COOKIE })).status === 200);
  }

  /* ====================================================================
     5. ARQUIVOS QUE NÃO PODEM SAIR PELA WEB
     ==================================================================== */
  console.log("\n-- Arquivos protegidos --");
  for (const alvo of ["/data/site.db", "/server.js", "/db.js", "/package.json", "/node_modules/better-sqlite3/package.json"]) {
    const r = await pedir("GET", alvo);
    certo(`${alvo} não é servido`, r.status === 403 || r.status === 404, `status ${r.status}`);
  }
  for (const alvo of ["/../server.js", "/assets/../server.js", "/assets/%2e%2e/server.js"]) {
    const r = await pedir("GET", alvo);
    certo(`travessia ${alvo} não escapa da pasta`, !/DatabaseSync|abrirBanco|scryptSync/.test(r.corpo));
  }

  /* ====================================================================
     6. UPLOAD
     ==================================================================== */
  console.log("\n-- Upload --");
  {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const r = await pedir("POST", "/api/upload", { cookie: COOKIE, corpo: { name: "x.svg", dataUrl: "data:image/svg+xml;base64," + svg } });
    eq("SVG é recusado (pode carregar script dentro)", r.status, 400);
  }
  {
    const r = await pedir("POST", "/api/upload", { corpo: { name: "x.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" } });
    eq("upload sem sessão é negado", r.status, 401);
  }
  const IMG = await (async () => {
    const r = await pedir("POST", "/api/upload", { cookie: COOKIE, corpo: { name: "zz-teste-em-pe.png", dataUrl: "data:image/png;base64," + pngEmPe().toString("base64") } });
    eq("PNG é aceito", r.status, 200);
    return r.json?.path;                                    // o painel devolve em `path`
  })();

  /* ====================================================================
     7. PUBLICAÇÃO: proporção da capa e HTML do conteúdo
     ==================================================================== */
  console.log("\n-- Publicação --");
  const SLUG = "zz-teste-" + process.pid;
  let idMateria = null;
  try {
    const criar = await pedir("POST", "/api/posts", { cookie: COOKIE, corpo: {
      title: "ZZ Teste automático", slug: SLUG, date: "2026-07-29",
      excerpt: "Registro de teste — apagado no fim.", image: IMG,
      content: '<p>Primeiro <strong>parágrafo</strong>.</p><p>Segundo com <a href="javascript:alert(1)">link ruim</a> e <script>alert(1)</script> junto.</p>',
    } });
    eq("matéria de teste criada", criar.status, 200);
    /* O POST responde só `ok`. O id vem da releitura pelo slug — que também
       confirma que a matéria realmente entrou no banco. */
    idMateria = (await pedir("GET", "/api/content", { cookie: COOKIE })).json?.posts?.find((p) => p.slug === SLUG)?.id;
    certo("a matéria aparece no banco", !!idMateria);

    eq("publicar responde ok", (await pedir("POST", "/api/publish", { cookie: COOKIE, corpo: {} })).status, 200);

    const pag = await pedir("GET", `/blog/${SLUG}/`);
    eq("a matéria publicada abre", pag.status, 200);

    const capa = /<figure class="post__cover">\s*<img[^>]*>/.exec(pag.corpo)?.[0] || "";
    certo("a capa declara a medida REAL da foto (40×90, em pé)",
      /width="40"/.test(capa) && /height="90"/.test(capa), capa);

    const css = fs.readFileSync(path.join(__dirname, "assets", "css", "styles.css"), "utf8");
    const regra = /\.post__cover img \{[^}]*\}/.exec(css)?.[0] || "";
    certo("a capa não é mais recortada (sem aspect-ratio fixo)", !/aspect-ratio/.test(regra), regra);
    certo("a capa não é mais esticada (sem object-fit: cover)", !/object-fit:\s*cover/.test(regra), regra);
    certo("a capa tem teto de altura, para foto em pé não empurrar o texto", /max-height/.test(regra), regra);

    certo("o <script> do conteúdo não sai na página", !/<script>alert\(1\)<\/script>/.test(pag.corpo));
    certo("o link javascript: foi neutralizado", !/href="javascript:/.test(pag.corpo));
    certo("a formatação legítima permanece", /<strong>parágrafo<\/strong>/.test(pag.corpo));

    /* O que foi GRAVADO também precisa estar limpo: se só a exibição
       filtrasse, o lixo continuaria no banco esperando outra saída. */
    const guardado = (await pedir("GET", "/api/content", { cookie: COOKIE })).json?.posts?.find((p) => p.slug === SLUG);
    certo("o banco também guarda o conteúdo já limpo", guardado && !/<script/i.test(guardado.content || ""), guardado?.content);
  } finally {
    if (idMateria) {
      await pedir("DELETE", `/api/posts/${idMateria}`, { cookie: COOKIE });
      await pedir("POST", "/api/publish", { cookie: COOKIE, corpo: {} });
      const sumiu = await pedir("GET", `/blog/${SLUG}/`);
      eq("a matéria de teste foi removida do site", sumiu.status, 404);
    }
    if (IMG) { try { fs.unlinkSync(path.join(__dirname, IMG.replace(/^\//, ""))); } catch {} }
  }

  /* ====================================================================
     8. PAINEL: editor, URL automática e resumo
     ==================================================================== */
  console.log("\n-- Painel --");
  {
    const html = fs.readFileSync(path.join(__dirname, "admin", "index.html"), "utf8");
    certo("existe o editor de texto formatado", /function editorRico/.test(html));
    certo("o editor tem negrito, itálico, lista e link", ["bold", "italic", "insertUnorderedList", "createLink"].every((c) => html.includes(c)));
    certo("o editor permite ver e escrever o HTML", /function edHtml/.test(html) && /class="ed-fonte/.test(html));
    certo("o HTML escrito à mão passa pelo mesmo filtro do servidor", /limparRicos/.test(fs.readFileSync(path.join(__dirname, "server.js"), "utf8")));
    certo("a URL amigável vem do título", /function gerarSlug/.test(html) && /onblur="gerarSlug/.test(html));
    certo("a URL só é preenchida quando está vazia", /dataset\.tocado/.test(html));
    certo("o resumo é gerado do conteúdo", /function gerarResumo|gerarResumo\(/.test(html));
    certo("o conteúdo da matéria usa o editor", /\["content","Conteúdo","bigtext"\]/.test(html));
    certo("o resumo fica em texto simples (vai para o Google)", /\["excerpt",[^\]]*"resumo"\]/.test(html));
  }

  /* ====================================================================
     9. O SITE PÚBLICO CONTINUA DE PÉ
     ==================================================================== */
  console.log("\n-- Site --");
  for (const [rota, marca] of [["/", "Forms Fitness"], ["/blog/", "blog"], ["/sitemap.xml", "<urlset"], ["/robots.txt", "Sitemap"]]) {
    const r = await pedir("GET", rota);
    certo(`${rota} responde`, r.status === 200 && r.corpo.toLowerCase().includes(marca.toLowerCase()), `status ${r.status}`);
  }
  {
    const home = await pedir("GET", "/");
    certo("a home usa o logotipo original do cliente", /logo-original\.svg/.test(home.corpo));
  }

  /* --------------------------------------------------------------------- */
  console.log(`\n=== ${ok}/${ok + falhas.length} ===`);
  if (falhas.length) { console.log("\nFalhou:\n" + falhas.map((f) => "  · " + f).join("\n")); process.exit(1); }
  console.log("Tudo certo.\n");
})().catch((e) => { console.error("\nERRO NA SUÍTE:", e); process.exit(1); });
