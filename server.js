/* ==========================================================================
   server.js — Gerenciador do site Forms Fitness Academia Aquática
   Node puro + SQLite nativo (node:sqlite) — zero dependências.
   · Site:   http://localhost:5186/
   · Painel: http://localhost:5186/admin/   (senha inicial: forms-admin)
   "Publicar" regenera index.html (marcadores <!--#KEY-->), o blog
   (/blog/ + /blog/<slug>/ a partir de src/), o sitemap e o config.js.
   ========================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = 5186;
const SITE = "https://formsfitness.com.br";
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(ROOT, "blog"), { recursive: true });

const db = new DatabaseSync(path.join(ROOT, "data", "site.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS portfolio (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subtitle TEXT, image TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS testimonials (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, name TEXT, role TEXT, initials TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS team (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT, bio TEXT, photo TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    excerpt TEXT, content TEXT, image TEXT, date TEXT, sort INTEGER DEFAULT 0);
`);

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const getS = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setS = (k, v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ------------------------------- Seed ------------------------------------ */
function seed() {
  if (getS("hero_title")) return;
  const S = {
    admin_password_hash: sha("forms-admin"),
    hero_badge: "🏊 33 anos formando nadadores em Caruaru-PE",
    hero_title: "Mergulhe na academia aquática que é <em>referência</em> há 33 anos.",
    hero_lead: "Natação para todas as idades, hidroginástica e a preparação TAF que mais aprova na região. Estrutura completa, professores experientes e água na temperatura certa para você evoluir.",
    stats: JSON.stringify([
      { num: "33", label: "anos de história" }, { num: "10mil+", label: "alunos formados" },
      { num: "TAF", label: "referência em aprovação" }, { num: "0–99", label: "anos: todas as idades" },
    ]),
    about_title: "Uma escola de natação com história — e resultados.",
    about_lead: "Desde 1993 a Forms Fitness ensina Caruaru a nadar. São gerações de alunos que aprenderam a primeira braçada, venceram o medo da água, se prepararam para concursos e subiram ao pódio com a gente.",
    about_bullets: JSON.stringify([
      "33 anos de experiência comprovada",
      "Professores formados e atualizados",
      "Turmas por nível e idade — do bebê ao master",
      "Aprovações em TAF de todas as corporações",
    ]),
    whatsapp: "5500000000000",
    whatsapp_display: "(87) 00000-0000",
    contact_email: "contato@formsfitness.com.br",
    instagram: "formsfitnessacademiaaquatica",
    footer_tagline: "Academia aquática em Caruaru-PE: natação infantil e adulta, hidroginástica e preparação TAF. 33 anos formando nadadores.",
  };
  for (const [k, v] of Object.entries(S)) setS(k, v);

  [["Natação Infantil", "Do primeiro contato com a água à técnica dos quatro nados. Turmas por faixa etária, com professores especializados e muito incentivo."],
   ["Natação Adulto", "Aprenda a nadar em qualquer idade ou aperfeiçoe sua técnica — turmas por nível, do iniciante ao avançado."],
   ["Preparação TAF", "Treinamento específico para o Teste de Aptidão Física de concursos: técnica, resistência e estratégia de prova. Somos referência em aprovação."],
   ["Hidroginástica", "Condicionamento, força e alegria — aulas dinâmicas de baixo impacto, perfeitas para todas as idades e articulações."],
   ["Exames de Pele", "Avaliação dermatológica periódica para a segurança de todos os alunos — praticidade dentro da própria academia."],
   ["Treinamento para Provas", "Do circuito escolar às travessias: planilhas, acompanhamento e a experiência de quem já formou campeões."]]
    .forEach((s, i) => db.prepare("INSERT INTO services(title,text,sort) VALUES(?,?,?)").run(s[0], s[1], i));

  [["Piscina semiolímpica", "Raias completas · água tratada", "https://images.unsplash.com/photo-1519315901367-f34ff9154487?auto=format&fit=crop&w=700&q=70"],
   ["Aulas em raia", "Técnica dos 4 nados", "https://images.unsplash.com/photo-1530549387789-4c1017266635?auto=format&fit=crop&w=700&q=70"],
   ["Treino de velocidade", "Preparação para provas e TAF", "https://images.unsplash.com/photo-1560090995-01632a28895b?auto=format&fit=crop&w=700&q=70"],
   ["Hidroginástica", "Turmas animadas todo dia", "https://images.unsplash.com/photo-1575052814086-f385e2e2ad1b?auto=format&fit=crop&w=700&q=70"],
   ["Vista da piscina", "Estrutura pensada para o aluno", "https://images.unsplash.com/photo-1519311965067-36d3e5f33d39?auto=format&fit=crop&w=700&q=70"],
   ["Nado livre", "Horários para treinar no seu ritmo", "https://images.unsplash.com/photo-1438029071396-1e831a7fa6d8?auto=format&fit=crop&w=700&q=70"]]
    .forEach((w, i) => db.prepare("INSERT INTO portfolio(title,subtitle,image,sort) VALUES(?,?,?,?)").run(w[0], w[1], w[2], i));

  [["Meu filho aprendeu a nadar em 3 meses e hoje compete pela equipe. A evolução dele é impressionante.", "Patrícia M.", "Mãe de aluno · Natação infantil", "PM"],
   ["Passei no TAF da PM-PE na primeira tentativa. O treino da Forms é focado exatamente no que a prova cobra.", "Carlos E.", "Aprovado no TAF · Caruaru", "CE"],
   ["A hidroginástica mudou minha disposição e minhas dores no joelho sumiram. Turma animada demais!", "Dona Socorro", "Hidroginástica · 68 anos", "DS"]]
    .forEach((d, i) => db.prepare("INSERT INTO testimonials(text,name,role,initials,sort) VALUES(?,?,?,?,?)").run(d[0], d[1], d[2], d[3], i));

  [["Prof. Ricardo Forms", "Fundador · Natação e TAF", "33 anos formando nadadores e aprovados. Especialista em preparação física para concursos e técnica de nado.", "https://images.unsplash.com/photo-1594381898411-846e7d193883?auto=format&fit=crop&w=600&q=75"],
   ["Profa. Juliana Melo", "Natação infantil", "Especialista em pedagogia aquática: transforma o medo da água em diversão desde os primeiros meses de vida.", "https://images.unsplash.com/photo-1571731956672-f2b94d7dd0cb?auto=format&fit=crop&w=600&q=75"],
   ["Prof. André Lima", "Hidroginástica e condicionamento", "Educador físico com foco em saúde e longevidade. Comanda as turmas mais animadas da academia.", "https://images.unsplash.com/photo-1521805103424-d8f8430e8933?auto=format&fit=crop&w=600&q=75"]]
    .forEach((m, i) => db.prepare("INSERT INTO team(name,role,bio,photo,sort) VALUES(?,?,?,?,?)").run(m[0], m[1], m[2], m[3], i));

  [["Como funciona o TAF e como se preparar para ser aprovado",
    "Entenda as etapas do Teste de Aptidão Física dos principais concursos e veja por que a natação é decisiva na sua aprovação.",
    "O Teste de Aptidão Física (TAF) é uma das etapas mais temidas dos concursos públicos de PM, Bombeiros e Forças Armadas — e a natação costuma ser o divisor de águas entre aprovados e reprovados.\n\nNa maioria das corporações, o candidato precisa nadar uma distância mínima em tempo determinado, além de provas de corrida, barra e abdominal. Quem chega sem técnica gasta o dobro de energia e não completa a prova.\n\nNa Forms Fitness, o treinamento TAF é específico: simulamos a prova real, corrigimos a técnica de nado para economizar energia e montamos a estratégia de ritmo ideal para o seu edital. São 33 anos de experiência e centenas de aprovados.\n\nQuer se preparar com quem mais aprova na região? Fale com a gente e agende uma avaliação.",
    "https://images.unsplash.com/photo-1560090995-01632a28895b?auto=format&fit=crop&w=900&q=70", "2026-07-10"],
   ["5 benefícios da natação infantil que vão além da água",
    "Coordenação, disciplina, segurança e muito mais: veja o que a natação desenvolve nas crianças desde cedo.",
    "A natação é um dos esportes mais completos para o desenvolvimento infantil — e os benefícios vão muito além de aprender a nadar.\n\n1. Segurança: criança que nada tem autonomia e reduz drasticamente o risco de afogamento.\n\n2. Coordenação motora: os movimentos simétricos dos nados desenvolvem lateralidade e consciência corporal.\n\n3. Saúde respiratória: o controle de respiração fortalece o sistema cardiorrespiratório e ajuda crianças com asma.\n\n4. Disciplina e rotina: horários, sequências e metas ensinam responsabilidade de forma leve.\n\n5. Socialização: as turmas criam amizades e senso de equipe desde cedo.\n\nNa Forms Fitness as turmas são divididas por faixa etária e nível, com professores especializados em pedagogia aquática. Venha fazer uma aula experimental!",
    "https://images.unsplash.com/photo-1600965962361-9035dbfd1c50?auto=format&fit=crop&w=900&q=70", "2026-07-03"],
   ["Hidroginástica: o treino de baixo impacto que cabe em qualquer idade",
    "Força, condicionamento e zero impacto nas articulações — conheça a modalidade queridinha da academia.",
    "A hidroginástica é a prova de que treino sério pode (e deve) ser divertido. Dentro da água, o corpo fica mais leve: os exercícios fortalecem músculos e melhoram o condicionamento sem sobrecarregar joelhos e coluna.\n\nPor isso a modalidade é indicada para todas as idades — de jovens em recuperação de lesão a alunos na melhor idade que querem disposição para o dia a dia.\n\nOs benefícios aparecem rápido: mais fôlego, mais força, menos dores e uma turma que vira família.\n\nAs aulas na Forms Fitness acontecem em vários horários, sempre com professor dentro d'água e música para animar. Agende sua aula experimental gratuita!",
    "https://images.unsplash.com/photo-1575052814086-f385e2e2ad1b?auto=format&fit=crop&w=900&q=70", "2026-06-24"]]
    .forEach((p, i) => db.prepare("INSERT INTO posts(title,slug,excerpt,content,image,date,sort) VALUES(?,?,?,?,?,?,?)")
      .run(p[0], slug(p[0]), p[1], p[2], p[3], p[4], i));

  console.log("· Banco inicializado. Senha do painel: forms-admin");
}
seed();
// migração leve: garante chaves novas em bancos já existentes
if (!getS("cnpj")) setS("cnpj", "00.000.000/0001-00");

/* ------------------------------ Sessões ---------------------------------- */
const sessions = new Map();
const authed = (req) => { const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); return m && sessions.has(m[1]); };

/* ------------------------------ Publicar --------------------------------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dateBR = (iso) => { const [y, m, d] = String(iso || "").split("-"); return d ? `${d}/${m}/${y}` : iso || ""; };
const ICONS = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="16.5" cy="6.5" r="2.2"/><path d="m4 13 4.5-3.5L14 12l4-2.5"/><path d="M2 18c1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5.5" r="2.2"/><path d="M12 8v5l-3.5 6M12 13l3.5 6M7 10.5 12 9l5 1.5"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5M12 2v3"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12.6 12 20l-7.5-7.4a5 5 0 1 1 7.5-6.3 5 5 0 1 1 7.5 6.3Z"/><path d="M7 12c1.7 1.4 3.3 1.4 5 0s3.3-1.4 5 0"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5c0 4.5 3 8.5 7.5 10 4.5-1.5 7.5-5.5 7.5-10V6Z"/><path d="m9 11.5 2 2 4-4"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/></svg>',
];
const CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function setMarker(html, key, content) {
  const re = new RegExp(`(<!--#${key}-->)[\\s\\S]*?(<!--\\/${key}-->)`);
  if (!re.test(html)) throw new Error(`Marcador ${key} não encontrado`);
  // replacement em função: evita que "$" no conteúdo seja interpretado ($$, $1…)
  return html.replace(re, (_m, open, close) => `${open}\n${content}\n${close}`);
}
const fill = (tpl, map) => Object.entries(map).reduce((h, [k, v]) => h.split(`{{${k}}}`).join(v), tpl);
const postCard = (p) => `<article class="post-card" data-reveal>
            <a class="post-card__media" href="/blog/${esc(p.slug)}/" tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="" loading="lazy"></a>
            <div class="post-card__body">
              <time class="post-card__date" datetime="${esc(p.date)}">${dateBR(p.date)}</time>
              <h3 class="post-card__title"><a href="/blog/${esc(p.slug)}/">${esc(p.title)}</a></h3>
              <p class="post-card__excerpt">${esc(p.excerpt)}</p>
              <a class="post-card__more" href="/blog/${esc(p.slug)}/">Ler matéria →</a>
            </div>
          </article>`;

function publish() {
  const S = {}; for (const r of db.prepare("SELECT key,value FROM settings").all()) S[r.key] = r.value;
  const services = db.prepare("SELECT * FROM services ORDER BY sort,id").all();
  const works = db.prepare("SELECT * FROM portfolio ORDER BY sort,id").all();
  const deps = db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all();
  const team = db.prepare("SELECT * FROM team ORDER BY sort,id").all();
  const posts = db.prepare("SELECT * FROM posts ORDER BY date DESC, id DESC").all();

  const stats = JSON.parse(S.stats || "[]").map((s) =>
    `<div class="stat"><dd class="stat__num">${esc(s.num)}</dd><dt class="stat__label">${esc(s.label)}</dt></div>`).join("\n            ");

  const servicesHtml = services.map((s, i) => `<article class="card" data-reveal${i % 3 ? ` data-reveal-delay="${i % 3}"` : ""}>
            <div class="service__icon">${ICONS[i % ICONS.length]}</div>
            <h3 class="service__title">${esc(s.title)}</h3>
            <p class="service__text">${esc(s.text)}</p>
          </article>`).join("\n          ");

  const worksHtml = works.map((w, i) => `<figure class="work" data-reveal${i % 3 ? ` data-reveal-delay="${i % 3}"` : ""}><img src="${esc(w.image)}" alt="${esc(w.title)} — Forms Fitness" loading="lazy"><figcaption class="work__label">${esc(w.title)}<small>${esc(w.subtitle || "")}</small></figcaption></figure>`).join("\n          ");

  const bullets = JSON.parse(S.about_bullets || "[]").map((b) => `<li>${CHECK} ${esc(b)}</li>`).join("\n            ");

  const teamHtml = team.map((m, i) => `<article class="card pro" data-reveal${i % 3 ? ` data-reveal-delay="${i % 3}"` : ""}>
            <figure class="pro__photo"><img src="${esc(m.photo)}" alt="${esc(m.name)} — ${esc(m.role)}" loading="lazy" width="300" height="340"></figure>
            <h3 class="pro__name">${esc(m.name)}</h3>
            <p class="pro__role">${esc(m.role)}</p>
            <p class="pro__bio">${esc(m.bio)}</p>
          </article>`).join("\n          ");

  const depsHtml = deps.map((t, i) => `<figure class="card quote" data-reveal${i % 3 ? ` data-reveal-delay="${i % 3}"` : ""}>
            <div class="quote__stars" aria-label="5 de 5">★★★★★</div>
            <blockquote class="quote__text">“${esc(t.text)}”</blockquote>
            <figcaption class="quote__author"><span class="avatar">${esc(t.initials)}</span><span><span class="quote__name">${esc(t.name)}</span><br><span class="quote__role">${esc(t.role)}</span></span></figcaption>
          </figure>`).join("\n          ");

  const contactInfo = `<a class="contact-tile" href="https://wa.me/${esc(S.whatsapp)}" target="_blank" rel="noopener">
              <span class="contact-tile__icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5Z"/></svg></span>
              <span><span class="contact-tile__label">WhatsApp — resposta rápida</span><br><span class="contact-tile__value">${esc(S.whatsapp_display)}</span></span>
            </a>
            <a class="contact-tile" href="mailto:${esc(S.contact_email)}">
              <span class="contact-tile__icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>
              <span><span class="contact-tile__label">E-mail</span><br><span class="contact-tile__value">${esc(S.contact_email)}</span></span>
            </a>
            <a class="contact-tile" href="https://www.instagram.com/${esc(S.instagram)}/" target="_blank" rel="noopener">
              <span class="contact-tile__icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></span>
              <span><span class="contact-tile__label">Instagram</span><br><span class="contact-tile__value">@${esc(S.instagram)}</span></span>
            </a>`;

  const blogHome = posts.slice(0, 3).map(postCard).join("\n          ");

  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "Forms Fitness Academia Aquática",
      url: `${SITE}/`, logo: `${SITE}/assets/img/mark.svg`,
      email: S.contact_email, sameAs: [`https://www.instagram.com/${S.instagram}/`] },
    { "@type": "ExerciseGym", "@id": `${SITE}/#academia`, name: "Forms Fitness Academia Aquática",
      image: `${SITE}/assets/img/og-image.png`, url: `${SITE}/`,
      description: "Academia aquática em Caruaru-PE: natação infantil e adulta, hidroginástica e preparação TAF. 33 anos formando nadadores.",
      telephone: "+" + S.whatsapp,
      address: { "@type": "PostalAddress", addressLocality: "Caruaru", addressRegion: "PE", addressCountry: "BR" },
      areaServed: "Caruaru e região", priceRange: "$$",
      foundingDate: "1993",
      makesOffer: services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.title } })),
      parentOrganization: { "@id": `${SITE}/#org` } },
    { "@type": "WebSite", url: `${SITE}/`, name: "Forms Fitness Academia Aquática", inLanguage: "pt-BR",
      publisher: { "@id": `${SITE}/#org` } },
  ] };
  const jsonldHtml = `<script type="application/ld+json">\n  ${JSON.stringify(jsonld, null, 2).replace(/\n/g, "\n  ")}\n  </script>`;

  const idx = path.join(ROOT, "index.html");
  let html = fs.readFileSync(idx, "utf8");
  html = setMarker(html, "JSONLD", "  " + jsonldHtml);
  html = setMarker(html, "HERO_BADGE", S.hero_badge);
  html = setMarker(html, "HERO_TITLE", S.hero_title);
  html = setMarker(html, "HERO_LEAD", S.hero_lead);
  html = setMarker(html, "STATS", "            " + stats);
  html = setMarker(html, "SERVICES", "          " + servicesHtml);
  html = setMarker(html, "ABOUT_TITLE", S.about_title);
  html = setMarker(html, "ABOUT_LEAD", S.about_lead);
  html = setMarker(html, "ABOUT_BULLETS", "            " + bullets);
  html = setMarker(html, "TEAM", "          " + teamHtml);
  html = setMarker(html, "PORTFOLIO", "          " + worksHtml);
  html = setMarker(html, "TESTIMONIALS", "          " + depsHtml);
  html = setMarker(html, "BLOG", "          " + blogHome);
  html = setMarker(html, "CONTACT_INFO", "            " + contactInfo);
  html = setMarker(html, "FOOTER_TAGLINE", S.footer_tagline);
  html = setMarker(html, "CNPJ", S.cnpj);
  // atualiza QUALQUER wa.me/<numero> restante (footer etc.)
  html = html.replace(/wa\.me\/\d+/g, `wa.me/${S.whatsapp}`);
  fs.writeFileSync(idx, html);

  /* ------------------------------- Blog ---------------------------------- */
  const blogTpl = fs.readFileSync(path.join(ROOT, "src", "blog.html"), "utf8");
  const postTpl = fs.readFileSync(path.join(ROOT, "src", "post.html"), "utf8");

  fs.writeFileSync(path.join(ROOT, "blog", "index.html"), fill(blogTpl, {
    POSTS_HTML: posts.map(postCard).join("\n          ") || '<p class="blog-empty">Em breve, novidades por aqui! 🏊</p>',
  }));

  const keep = new Set(posts.map((p) => p.slug));
  for (const dir of fs.readdirSync(path.join(ROOT, "blog"), { withFileTypes: true }))
    if (dir.isDirectory() && !keep.has(dir.name))
      fs.rmSync(path.join(ROOT, "blog", dir.name), { recursive: true, force: true });

  for (const p of posts) {
    const paragraphs = String(p.content || "").split(/\n{2,}/).map((par) => `<p>${esc(par.trim()).replace(/\n/g, "<br>")}</p>`).join("\n        ");
    const pj = { "@context": "https://schema.org", "@type": "Article",
      headline: p.title, description: p.excerpt, image: p.image,
      datePublished: p.date, inLanguage: "pt-BR",
      author: { "@type": "Organization", name: "Forms Fitness Academia Aquática", url: `${SITE}/` },
      publisher: { "@id": `${SITE}/#org` },
      mainEntityOfPage: `${SITE}/blog/${p.slug}/` };
    const dirP = path.join(ROOT, "blog", p.slug);
    fs.mkdirSync(dirP, { recursive: true });
    fs.writeFileSync(path.join(dirP, "index.html"), fill(postTpl, {
      TITLE: esc(p.title), EXCERPT: esc(p.excerpt), SLUG: esc(p.slug),
      IMAGE: esc(p.image), DATE_ISO: esc(p.date), DATE_BR: dateBR(p.date),
      CONTENT_HTML: paragraphs,
      JSONLD: `<script type="application/ld+json">\n  ${JSON.stringify(pj, null, 2).replace(/\n/g, "\n  ")}\n  </script>`,
    }));
  }

  /* ------------------------------ Sitemap --------------------------------- */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${SITE}/blog/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ...posts.map((p) => `  <url><loc>${SITE}/blog/${p.slug}/</loc><lastmod>${p.date || today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
  ];
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);

  // config.js
  const cfgPath = path.join(ROOT, "assets/js/config.js");
  let cfg = fs.readFileSync(cfgPath, "utf8");
  cfg = cfg.replace(/WHATSAPP_NUMBER = "[^"]*"/, `WHATSAPP_NUMBER = "${S.whatsapp}"`)
           .replace(/CONTACT_EMAIL = "[^"]*"/, `CONTACT_EMAIL = "${S.contact_email}"`);
  fs.writeFileSync(cfgPath, cfg);
  return { services: services.length, works: works.length, team: team.length, posts: posts.length };
}

/* ------------------------------ HTTP util --------------------------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain" };
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, bad) => {
  let d = "", n = 0;
  req.on("data", (c) => { n += c.length; if (n > 25e6) { bad(new Error("payload muito grande")); req.destroy(); } d += c; });
  req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { bad(new Error("JSON inválido")); } });
});
const TABLES = { services: ["title", "text", "sort"], portfolio: ["title", "subtitle", "image", "sort"],
  testimonials: ["text", "name", "role", "initials", "sort"], team: ["name", "role", "bio", "photo", "sort"],
  posts: ["title", "slug", "excerpt", "content", "image", "date", "sort"] };
const KEYS = ["hero_badge", "hero_title", "hero_lead", "stats", "about_title", "about_lead", "about_bullets",
  "whatsapp", "whatsapp_display", "contact_email", "instagram", "footer_tagline", "cnpj"];

/* ------------------------------ Servidor ---------------------------------- */
http.createServer(async (req, res) => {
  const p = new URL(req.url, `http://localhost:${PORT}`).pathname;
  try {
    if (p.startsWith("/api/")) {
      if (p === "/api/login" && req.method === "POST") {
        const { password } = await readBody(req);
        if (sha(password) !== getS("admin_password_hash")) return json(res, 401, { error: "Senha incorreta" });
        const t = crypto.randomBytes(24).toString("hex");
        sessions.set(t, Date.now());
        res.setHeader("Set-Cookie", `sid=${t}; HttpOnly; Path=/; SameSite=Lax`);
        return json(res, 200, { ok: true });
      }
      if (!authed(req)) return json(res, 401, { error: "Não autenticado" });
      if (p === "/api/me") return json(res, 200, { ok: true });
      if (p === "/api/logout" && req.method === "POST") {
        const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); if (m) sessions.delete(m[1]);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/password" && req.method === "POST") {
        const { current, next } = await readBody(req);
        if (sha(current) !== getS("admin_password_hash")) return json(res, 400, { error: "Senha atual incorreta" });
        if (!next || String(next).length < 6) return json(res, 400, { error: "Nova senha deve ter 6+ caracteres" });
        setS("admin_password_hash", sha(next));
        return json(res, 200, { ok: true });
      }
      if (p === "/api/content") {
        const S = {}; for (const k of KEYS) S[k] = getS(k) || "";
        return json(res, 200, {
          settings: S,
          services: db.prepare("SELECT * FROM services ORDER BY sort,id").all(),
          portfolio: db.prepare("SELECT * FROM portfolio ORDER BY sort,id").all(),
          testimonials: db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all(),
          team: db.prepare("SELECT * FROM team ORDER BY sort,id").all(),
          posts: db.prepare("SELECT * FROM posts ORDER BY date DESC, id DESC").all(),
        });
      }
      if (p === "/api/settings" && req.method === "PUT") {
        const b = await readBody(req);
        for (const [k, v] of Object.entries(b)) if (KEYS.includes(k)) setS(k, v);
        return json(res, 200, { ok: true });
      }
      const tm = p.match(/^\/api\/(services|portfolio|testimonials|team|posts)(?:\/(\d+))?$/);
      if (tm) {
        const table = tm[1], id = tm[2], cols = TABLES[table];
        const b = (req.method === "POST" || req.method === "PUT") ? await readBody(req) : {};
        if (table === "posts" && (req.method === "POST" || req.method === "PUT")) {
          if (b.slug || b.title) {
            b.slug = slug(b.slug || b.title || "post") || "post";
            const clash = db.prepare("SELECT id FROM posts WHERE slug=?").get(b.slug);
            if (clash && String(clash.id) !== String(id || "")) b.slug = `${b.slug}-${Date.now().toString(36)}`;
          }
        }
        if (req.method === "POST" && !id) {
          const use = cols.filter((c) => c in b);
          db.prepare(`INSERT INTO ${table}(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`).run(...use.map((c) => b[c]));
          return json(res, 200, { ok: true });
        }
        if (req.method === "PUT" && id) {
          const use = cols.filter((c) => c in b);
          if (use.length) db.prepare(`UPDATE ${table} SET ${use.map((c) => c + "=?").join(",")} WHERE id=?`).run(...use.map((c) => b[c]), id);
          return json(res, 200, { ok: true });
        }
        if (req.method === "DELETE" && id) {
          db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
          return json(res, 200, { ok: true });
        }
      }
      if (p === "/api/upload" && req.method === "POST") {
        const { name, dataUrl } = await readBody(req);
        const m = /^data:(image\/(?:png|jpe?g|webp|svg\+xml|gif));base64,(.+)$/.exec(dataUrl || "");
        if (!m) return json(res, 400, { error: "Envie uma imagem (png, jpg, webp, svg ou gif)" });
        const safe = slug(path.parse(name || "foto").name).slice(0, 40) || "foto";
        const ext = m[1] === "image/svg+xml" ? ".svg" : "." + m[1].split("/")[1].replace("jpeg", "jpg");
        const file = `${Date.now().toString(36)}-${safe}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], "base64"));
        return json(res, 200, { ok: true, path: `/assets/img/uploads/${file}` });
      }
      if (p === "/api/publish" && req.method === "POST") return json(res, 200, { ok: true, ...publish() });
      return json(res, 404, { error: "Rota não encontrada" });
    }

    if (p === "/admin" || p === "/admin/") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      return res.end(fs.readFileSync(path.join(ROOT, "admin", "index.html")));
    }
    if (/^\/(data|src|server\.js)(\/|$)/.test(p)) { res.writeHead(404); return res.end("404"); }

    let file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
    if (p === "/") file = path.join(ROOT, "index.html");
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => {
  console.log(`\n  Forms Fitness — site + gerenciador`);
  console.log(`  · Site:   http://localhost:${PORT}/`);
  console.log(`  · Painel: http://localhost:${PORT}/admin/  (senha inicial: forms-admin)\n`);
});
