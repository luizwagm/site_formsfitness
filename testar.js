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

    /* ------------------------------------------------------------------
       ATAQUE DISTRIBUÍDO — a brecha que a trava por IP não via.

       A conta é uma só; os IPs, não. Com uma lista de proxies o atacante
       ganhava um orçamento novo de 5 tentativas por endereço, e a trava
       nunca disparava. O balde POR CONTA soma os erros de todo mundo e é o
       que interrompe.

       Roda por último de propósito: ele deixa a conta bloqueada por 30 min.
       O IP desta máquina já acertou a senha acima, então continua entrando
       (é justamente a proteção contra o ataque virar tranca no dono) — e é
       isso que permite a suíte rodar de novo em seguida. */
    let gastas = 0, barrouCom = null;
    for (let i = 0; i < 40; i++) {
      const r = await pedir("POST", "/api/login",
        { corpo: { password: "zz-distrib-" + i }, headers: { "x-real-ip": `203.0.113.${100 + i}` } });
      if (r.status === 401) { gastas++; continue; }
      if (r.status === 429) { barrouCom = r.json?.error || ""; break; }
    }
    certo("o ataque distribuído é interrompido", barrouCom !== null && gastas <= 12, `passaram ${gastas}`);
    certo("a mensagem explica que foi a conta", /conta/i.test(barrouCom || ""), barrouCom);

    /* Com a conta bloqueada, nem a senha certa entra de um endereço novo —
       senão o bloqueio não bloquearia nada. */
    eq("senha certa de IP desconhecido é barrada enquanto a conta está travada",
      (await pedir("POST", "/api/login", { corpo: { password: SENHA }, headers: { "x-real-ip": "198.51.100.200" } })).status, 429);

    /* E o dono, do endereço de sempre, não fica trancado do lado de fora. */
    certo("o dono, do IP que já usou antes, continua entrando",
      (await pedir("POST", "/api/login", { corpo: { password: SENHA } })).status === 200);

    /* A contagem tem de sobreviver ao reinício: o servidor reinicia sozinho
       de madrugada, e uma trava só na memória devolveria o orçamento
       inteiro ao atacante todo dia. */
    const limites = path.join(__dirname, "data", "limites.json");
    certo("a contagem é gravada em disco (sobrevive ao reinício)", fs.existsSync(limites));
    if (fs.existsSync(limites)) {
      const d = JSON.parse(fs.readFileSync(limites, "utf8"));
      certo("o arquivo guarda os baldes por conta", Object.keys(d.falhas || {}).some((k) => k.includes("|conta|")));
    }
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
     BACKUP — a única falta cuja consequência é irreversível
     ==================================================================== */
  console.log("\n-- Backup --");
  {
    const { rodarBackup, statusBackup } = require("./backup");
    const cfg = { destino: path.join(__dirname, "backups"),
      bancos: [path.join(__dirname, "data", "site.db")], manter: 30, intervaloHoras: 24 };
    const feitos = rodarBackup(cfg, "do teste");
    certo("a cópia é gerada", feitos.length === 1 && fs.existsSync(feitos[0].arquivo));

    /* Backup que ninguém abre não é backup. Aqui a cópia é ABERTA e comparada
       com o original — é o que separa "o arquivo existe" de "dá para voltar". */
    const { abrirBanco } = require("./db");
    const orig = abrirBanco(path.join(__dirname, "data", "site.db"));
    const copia = abrirBanco(feitos[0].arquivo);
    const conta = (d, t) => d.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    const iguais = ["settings", "services", "team", "posts"].every((t) => conta(orig, t) === conta(copia, t));
    certo("a cópia tem o mesmo conteúdo do original", iguais);
    eq("a cópia passa no integrity_check", copia.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    orig.close(); copia.close();

    const st = statusBackup(cfg);
    certo("o status sabe dizer quando foi a última cópia", st.bancos[0].ultimo !== null);
    certo("as cópias ficam FORA de data/", !st.destino.includes(path.join("data")));
    try { fs.unlinkSync(feitos[0].arquivo); } catch {}
  }

  /* ====================================================================
     MODO MANUTENÇÃO
     ==================================================================== */
  console.log("\n-- Modo manutenção --");
  {
    const NAV = { "user-agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
    await pedir("POST", "/api/manutencao", { cookie: COOKIE,
      corpo: { ligar: true, titulo: "ZZ teste de manutenção", texto: "Voltamos já." } });
    const visitante = await pedir("GET", "/", { headers: NAV });
    /* 503 e não 200: com 200 o Google indexaria a página de aviso no lugar do
       site; com 404 concluiria que as páginas sumiram. */
    eq("o visitante recebe 503 (temporário), não 200 nem 404", visitante.status, 503);
    eq("acompanha Retry-After", visitante.headers["retry-after"], "3600");
    certo("mostra o texto configurado", /ZZ teste de manuten/.test(visitante.corpo));
    certo("quem está logado continua vendo o site",
      (await pedir("GET", "/", { cookie: COOKIE, headers: NAV })).status === 200);
    certo("os assets continuam servidos (a página de aviso depende deles)",
      (await pedir("GET", "/assets/css/styles.css")).status === 200);

    const arq = path.join(__dirname, "manutencao.html");
    certo("a página é gravada em disco (o nginx a usa quando o app cai)", fs.existsSync(arq));
    const html = fs.readFileSync(arq, "utf8");
    /* Se o app está fora do ar, nada em /assets é servido: a página tem de se
       sustentar sozinha, com CSS e desenho embutidos. */
    certo("a página não depende de nenhum arquivo do site", !/(?:href|src)="\//.test(html));

    await pedir("POST", "/api/manutencao", { cookie: COOKIE, corpo: { ligar: false } });
    eq("desligando, o site volta", (await pedir("GET", "/", { headers: NAV })).status, 200);
  }

  /* ====================================================================
     CONTADOR DE ACESSOS
     ==================================================================== */
  console.log("\n-- Acessos --");
  {
    const NAV = { "user-agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
    const antes = (await pedir("GET", "/api/stats", { cookie: COOKIE })).json;
    const ip = "203.0.113." + (150 + (process.pid % 50));
    await pedir("GET", "/", { headers: { ...NAV, "x-real-ip": ip } });
    await pedir("GET", "/", { headers: { ...NAV, "x-real-ip": ip } });          // mesma visita
    await pedir("GET", "/", { headers: { "user-agent": "Googlebot/2.1" } });     // robô
    await pedir("GET", "/assets/css/styles.css", { headers: { ...NAV, "x-real-ip": "203.0.113.240" } });
    const dep = (await pedir("GET", "/api/stats", { cookie: COOKIE })).json;

    eq("um visitante novo conta uma vez", dep.total - antes.total, 1);
    certo("o mesmo IP na mesma janela não conta de novo", dep.total - antes.total === 1);
    certo("robô não é visita", dep.total - antes.total === 1);
    certo("CSS e imagem não contam como acesso", dep.total - antes.total === 1);
    eq("sem sessão, os números não saem", (await pedir("GET", "/api/stats")).status, 401);

    /* LGPD: o endereço nunca fica legível. Guardar o IP em claro tornaria a
       tabela um cadastro de pessoas identificáveis. */
    const { abrirBanco } = require("./db");
    const d = abrirBanco(path.join(__dirname, "data", "site.db"));
    const amostra = d.prepare("SELECT ip_hash FROM visits LIMIT 20").all();
    certo("nenhum IP é gravado em claro", !amostra.some((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x.ip_hash)));
    certo("o hash tem sal (não é o sha do IP puro)",
      amostra.every((x) => /^[a-f0-9]{64}$/.test(x.ip_hash)));
    d.close();
  }

  /* ====================================================================
     COOKIES (LGPD), PRIVACIDADE E BUSCA
     ==================================================================== */
  console.log("\n-- LGPD, privacidade e busca --");
  {
    const js = fs.readFileSync(path.join(__dirname, "assets", "js", "main.js"), "utf8");
    /* O ponto todo do banner: nada de terceiros pode carregar ANTES do aceite.
       Um aviso que só informa, e rastreia de qualquer jeito, não cumpre a lei. */
    certo("os scripts de medição só carregam depois do aceite",
      /if \(escolha === "aceito"\) carregarMedicao\(\)/.test(js));
    certo("no primeiro acesso o banner aparece", /if \(!escolha\) montarBanner\(\)/.test(js));
    certo("dá para REVER a escolha depois", /cookie-prefs/.test(js));
    certo("recusar é tão fácil quanto aceitar (mesmo peso de botão)",
      /data-consent="essenciais"/.test(js) && /data-consent="aceito"/.test(js));

    const priv = await pedir("GET", "/privacidade/");
    eq("a política de privacidade abre", priv.status, 200);
    certo("ela diz o que o site faz de verdade — o formulário não guarda nada aqui",
      /não envia nada para um servidor nosso/i.test(priv.corpo));
    certo("fala de crianças (a academia tem natação infantil)", /Crianças e adolescentes/.test(priv.corpo));

    const busca = await pedir("GET", "/busca/?q=taf");
    eq("a página de busca abre", busca.status, 200);
    certo("a busca não é indexada (o conteúdo muda a cada termo)", /noindex/.test(busca.corpo));
    const idx = await pedir("GET", "/assets/data/search-index.json");
    eq("o índice de busca é publicado", idx.status, 200);
    certo("o índice tem conteúdo", Array.isArray(idx.json) && idx.json.length > 5, String(idx.json?.length));
    certo("o índice cobre blog, modalidades e equipe",
      ["Blog", "Modalidade", "Equipe"].every((t) => idx.json.some((x) => x.tipo === t)));

    const sm = await pedir("GET", "/sitemap.xml");
    certo("a privacidade entra no sitemap", /\/privacidade\//.test(sm.corpo));
    certo("a busca fica fora do sitemap", !/\/busca\//.test(sm.corpo));
  }

  /* ====================================================================
     ENDEREÇO, MATRÍCULA E LAYOUT
     ==================================================================== */
  console.log("\n-- Endereço com Maps --");
  {
    const home = await pedir("GET", "/");
    certo("o cartão de endereço está na home", /class="mapa-card"/.test(home.corpo));
    const destino = (/class="mapa-card" href="([^"]+)"/.exec(home.corpo) || [])[1] || "";
    certo("ele aponta para o Google Maps", /google\.com\/maps/.test(destino), destino.slice(0, 60));
    certo("abre em aba nova", /class="mapa-card"[^>]*target="_blank"/.test(home.corpo));
    /* O iframe do Maps carregava ~900 KB de script do Google em toda visita e
       plantava cookie ANTES do consentimento — o oposto do que o banner faz. */
    certo("o mapa embutido não voltou", !/maps[^"]*output=embed/.test(home.corpo));
    certo("o endereço é editável no painel",
      /s_endereco/.test(fs.readFileSync(path.join(__dirname, "admin", "index.html"), "utf8")));
  }

  console.log("\n-- Matrícula --");
  {
    const mat = await pedir("GET", "/matricula/");
    eq("a página abre", mat.status, 200);
    certo("tem os blocos do aluno e do responsável",
      /id="mat-responsavel"/.test(mat.corpo) && /id="mat-docs"/.test(mat.corpo));
    certo("as três autorizações estão lá", (mat.corpo.match(/class="mat-check"/g) || []).length === 3);
    certo("avisa o horário limite de 17h", /até 17h/.test(mat.corpo));
    certo("pede foto e comprovante pelo WhatsApp", /Foto do aluno/.test(mat.corpo) && /Comprovante de pagamento/.test(mat.corpo));
    /* Documento pessoal — de criança, inclusive — não sobe para o servidor:
       guardar isso criaria uma obrigação de proteção desnecessária. */
    certo("a página não sobe arquivo nenhum", !/type="file"/.test(mat.corpo));

    const js = fs.readFileSync(path.join(__dirname, "assets", "js", "main.js"), "utf8");
    certo("o formulário monta a mensagem e vai para o WhatsApp do painel",
      /wa\.me\/\$\{WHATSAPP_NUMBER\}/.test(js) && /MATRÍCULA ONLINE/.test(js));
    certo("menor de idade passa a exigir responsável", /el\.required = menor/.test(js));

    const home = await pedir("GET", "/");
    certo('o botão agora é "Garanta sua vaga"', /Garanta sua vaga/.test(home.corpo));
    certo("e leva para a matrícula", /href="\/matricula\/"/.test(home.corpo));
    certo('"aula experimental" saiu dos botões', !/>\s*(Agendar )?[Aa]ula experimental\s*</.test(home.corpo));

    const sm = await pedir("GET", "/sitemap.xml");
    certo("a matrícula entra no sitemap", /\/matricula\//.test(sm.corpo));
  }

  console.log("\n-- Layout exclusivo --");
  {
    const home = await pedir("GET", "/");
    /* O site nasceu com a MESMA armação do site da clínica — hero de duas
       colunas, modalidades em três cards, estrutura em grade uniforme. Estas
       verificações existem para que ninguém volte ao molde antigo sem notar. */
    certo("o hero sangra a tela (não é mais grade de 2 colunas)",
      /class="hero__fundo"/.test(home.corpo) && !/class="container hero__grid"/.test(home.corpo));
    certo("as raias da piscina estão no hero", /class="hero__raias"/.test(home.corpo));
    certo("os números viraram faixa própria", /class="placar"/.test(home.corpo));
    const raias = (home.corpo.match(/class="raia"/g) || []).length;
    certo("as modalidades são raias numeradas, não cards", raias >= 3, `${raias} raias`);
    certo("cada raia tem número", /class="raia__n"/.test(home.corpo));
    certo("a estrutura é mosaico, não grade uniforme",
      /class="mosaico"/.test(home.corpo) && /foto--grande/.test(home.corpo));
    certo("o markup antigo do hero não voltou", !/hero__grid|class="masonry"/.test(home.corpo));
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
    certo("a home usa o logotipo original do cliente", /logo-original\.png/.test(home.corpo));
    /* O SVG antigo tinha 3,65 MB (um PNG de 3905×2048 embutido, exibido a
       ~130px) e carregava em toda página. O arquivo novo do cliente tem 295 KB
       com o mesmo desenho — se alguém reapontar para o SVG, isto avisa. */
    certo("o logotipo não é mais o SVG de 3,6 MB", !/logo-original\.svg/.test(home.corpo));
    certo("o favicon é o PNG do cliente", /favicon\.png/.test(home.corpo) && !/favicon\.svg/.test(home.corpo));
  }

  /* --------------------------------------------------------------------- */
  console.log(`\n=== ${ok}/${ok + falhas.length} ===`);
  if (falhas.length) { console.log("\nFalhou:\n" + falhas.map((f) => "  · " + f).join("\n")); process.exit(1); }
  console.log("Tudo certo.\n");
})().catch((e) => { console.error("\nERRO NA SUÍTE:", e); process.exit(1); });
