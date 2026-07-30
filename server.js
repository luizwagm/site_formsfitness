/* ==========================================================================
   server.js — Gerenciador do site Forms Fitness Academia Aquática
   Node puro + SQLite pelo db.js (better-sqlite3, com node:sqlite de reserva).
   · Site:   http://localhost:5186/
   · Painel: http://localhost:5186/admin/   (senha inicial: forms-admin)
   "Publicar" regenera index.html (marcadores <!--#KEY-->), o blog
   (/blog/ + /blog/<slug>/ a partir de src/), o sitemap e o config.js.
   ========================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { abrirBanco, DRIVER_NOME, DRIVER_AVISO } = require("./db");
const { criarLimitador } = require("./limitador");
const { agendarBackups } = require("./backup");

const ROOT = __dirname;
/* Versão do SITE/painel. Segunda casa = novidade, terceira = correção; a
   primeira não muda. Aparece no rodapé do painel, então o que se lê na tela é
   sempre o que está REALMENTE rodando no servidor. */
const APP_VERSION = "1.6.1";
const PORT = 5186;
const SITE = "https://formsfitness.com";
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(ROOT, "blog"), { recursive: true });

/* Freio contra adivinhação de senha. Vive em arquivo para sobreviver ao
   reinício — o servidor reinicia sozinho de madrugada, e uma contagem só na
   memória devolveria o orçamento inteiro ao atacante todo dia. */
const limite = criarLimitador({ arquivo: path.join(ROOT, "data", "limites.json") });
limite.carregar();
process.on("exit", () => limite.gravar());

const db = abrirBanco(path.join(ROOT, "data", "site.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS portfolio (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subtitle TEXT, image TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS testimonials (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, name TEXT, role TEXT, initials TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS team (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT, bio TEXT, photo TEXT, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    excerpt TEXT, content TEXT, image TEXT, date TEXT, sort INTEGER DEFAULT 0);

  -- Contador de acessos do site público. O IP NUNCA é gravado em claro:
  -- guardamos só o hash (LGPD — dado pseudonimizado, não reversível na prática).
  CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL, path TEXT, referrer TEXT, ua TEXT, day TEXT NOT NULL, ts INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_visits_ip_ts ON visits(ip_hash, ts);
  CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day);
  CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);
`);

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/* ==========================================================================
   SENHA DO PAINEL

   Era SHA-256 puro. O problema não é o algoritmo ser fraco em si — é ser
   RÁPIDO e SEM SAL: uma placa de vídeo testa bilhões por segundo, e como não
   há sal, o hash de uma senha comum já está em tabela pronta na internet. Quem
   pusesse a mão no data/site.db teria a senha em minutos.

   O scrypt é deliberadamente lento e usa MEMÓRIA, o que anula o ganho da placa
   de vídeo, e cada senha tem o seu sal — dois cadastros com a mesma senha
   geram hashes diferentes.

   MIGRAÇÃO SEM PEDIR NADA A NINGUÉM: o hash antigo continua sendo aceito UMA
   vez; ao acertar a senha, ela é regravada em scrypt. Ninguém precisa
   redefinir nada e o formato velho some no primeiro acesso.
   ========================================================================== */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(senha), salt, SCRYPT.keylen, SCRYPT);
  /* O "$" separa os campos — é ele que permite reler os parâmetros na hora de
     conferir, e é por "scrypt$" que se reconhece o formato novo. */
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${dk.toString("hex")}`;
}
const iguais = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
function confereSenha(senha, guardado) {
  if (!guardado) return false;
  if (!guardado.startsWith("scrypt$")) return sha(senha) === guardado;   // formato antigo
  const [, N, r, p, saltHex, dkHex] = guardado.split("$");
  const dk = crypto.scryptSync(String(senha), Buffer.from(saltHex, "hex"), dkHex.length / 2, { N: +N, r: +r, p: +p });
  return iguais(Buffer.from(dkHex, "hex"), dk);
}
/* Hash descartável para gastar o MESMO tempo quando a senha está errada.
   Sem isto, "senha errada" responde em 1ms e "senha certa" em ~200ms — e essa
   diferença, medida no relógio, entrega quando alguém acertou. */
const HASH_ISCA = hashSenha(crypto.randomBytes(16).toString("hex"));

/* A TRAVA DE FORÇA BRUTA mudou de casa: está em `limitador.js`, que além do
   balde por IP tem o balde por CONTA (o que barra o ataque distribuído),
   espera crescente entre erros e contagem que sobrevive ao reinício. O que
   ficou aqui é só a leitura do IP, que o limitador recebe pronta.

   O IP REAL de quem está pedindo.

   Atrás do nginx o socket é sempre 127.0.0.1, então o IP verdadeiro precisa
   chegar por cabeçalho. Só que cabeçalho é texto que o CLIENTE também
   escreve. O nginx monta `X-Forwarded-For: <o que o cliente mandou>, <IP
   real>` — ele ACRESCENTA no fim, não substitui. Ler o PRIMEIRO item da lista,
   como estava aqui, é ler exatamente o que o visitante digitou.

   Na prática isso anulava a trava de força bruta: bastava mandar um
   X-Forwarded-For diferente a cada tentativa para nenhuma "contar" duas vezes
   no mesmo IP, e a senha podia ser tentada infinitas vezes.

   Duas correções: o cabeçalho só é aceito quando a conexão de fato veio do
   nginx local, e usamos o X-Real-IP — que o nginx SOBRESCREVE — ou, na falta
   dele, o ÚLTIMO item da lista, o único que o nginx escreveu. */
const DO_PROXY = /^(?:::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
function ipDoCliente(req) {
  const direto = String(req.socket.remoteAddress || "");
  if (!DO_PROXY.test(direto)) return direto;                      // conexão direta: só o socket vale
  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real;
  const lista = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista.length ? lista[lista.length - 1] : direto;
}
const getS = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setS = (k, v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));
const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ==========================================================================
   CONTADOR DE ACESSOS — só visitas humanas ao site público.

   Um mesmo IP conta 1 vez por janela de VISIT_WINDOW_MIN minutos; passada a
   janela volta a contar, porque aí é uma VISITA nova, não um clique a mais.
   IPs diferentes contam sempre. Nada disso aparece no site — só na tela
   Acessos do painel, que exige sessão.
   ========================================================================== */
const VISIT_WINDOW_MIN = 30;
/* Sal guardado no banco: sem ele, o hash de um IPv4 seria quebrável por
   força bruta em minutos (só existem 4 bilhões de endereços, e testar todos
   é trivial). Com um sal aleatório POR INSTALAÇÃO, deixa de ser — e é o que
   torna o dado pseudonimizado de verdade, e não só de fachada. */
if (!getS("visit_salt")) setS("visit_salt", crypto.randomBytes(24).toString("hex"));
const VISIT_SALT = getS("visit_salt");

/* Robô não é visita. Sem esta lista, o número que o cliente vê seria em boa
   parte o Google e os pré-visualizadores de link do WhatsApp. */
const BOT_RE = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|preview|monitor|uptime|curl|wget|python-requests|axios|headless|lighthouse|pagespeed|semrush|ahrefs|mj12|dotbot|petalbot|gptbot|ccbot|claudebot|perplexity/i;

function trackVisit(req, pathname) {
  try {
    if (req.method !== "GET") return;
    const ua = String(req.headers["user-agent"] || "");
    if (!ua || BOT_RE.test(ua)) return;                 // robôs não são visita
    if (req.headers["sec-fetch-dest"] === "iframe") return;

    const ipHash = sha(VISIT_SALT + ipDoCliente(req));
    const agora = Date.now();
    const ultima = db.prepare("SELECT ts FROM visits WHERE ip_hash=? ORDER BY ts DESC LIMIT 1").get(ipHash);
    if (ultima && agora - Number(ultima.ts) < VISIT_WINDOW_MIN * 60_000) return;  // ainda na mesma visita

    const ref = String(req.headers.referer || "");
    db.prepare("INSERT INTO visits(ip_hash,path,referrer,ua,day,ts) VALUES(?,?,?,?,?,?)")
      .run(ipHash, pathname.slice(0, 300),
        /* Referência de dentro de casa não é "origem": contá-la encheria a
           lista com o próprio site e esconderia de onde a visita veio. */
        ref.includes("formsfitness.com") || ref.includes("localhost") ? "" : ref.slice(0, 300),
        ua.slice(0, 300), new Date(agora).toISOString().slice(0, 10), agora);
  } catch { /* medir acesso NUNCA pode derrubar a entrega da página */ }
}

function statsAcessos() {
  const hoje = new Date().toISOString().slice(0, 10);
  const desde = (dias) => Date.now() - dias * 86_400_000;
  const num = (sql, ...p) => Number(db.prepare(sql).get(...p)?.n || 0);
  return {
    total: num("SELECT COUNT(*) n FROM visits"),
    hoje: num("SELECT COUNT(*) n FROM visits WHERE day=?", hoje),
    semana: num("SELECT COUNT(*) n FROM visits WHERE ts>=?", desde(7)),
    mes: num("SELECT COUNT(*) n FROM visits WHERE ts>=?", desde(30)),
    visitantes: num("SELECT COUNT(DISTINCT ip_hash) n FROM visits"),
    visitantesMes: num("SELECT COUNT(DISTINCT ip_hash) n FROM visits WHERE ts>=?", desde(30)),
    porDia: db.prepare("SELECT day, COUNT(*) total FROM visits WHERE ts>=? GROUP BY day ORDER BY day").all(desde(30)),
    topPaginas: db.prepare("SELECT path, COUNT(*) total FROM visits GROUP BY path ORDER BY total DESC LIMIT 12").all(),
    origens: db.prepare("SELECT referrer, COUNT(*) total FROM visits WHERE referrer<>'' GROUP BY referrer ORDER BY total DESC LIMIT 8").all(),
    janelaMin: VISIT_WINDOW_MIN,
  };
}

/* ------------------------------- Seed ------------------------------------ */
function seed() {
  /* As chaves do modo manutenção ficam FORA do if de baixo: o site já existe e
     já tem hero_title, então um seed que só roda na primeira instalação nunca
     as criaria. Sem elas, o painel abriria a tela sem valor nenhum. */
  if (getS("manutencao") === undefined) setS("manutencao", "0");
  if (getS("manutencao_titulo") === undefined) setS("manutencao_titulo", "Estamos atualizando o site");
  if (getS("manutencao_texto") === undefined) setS("manutencao_texto", "Volte em instantes.");
  if (getS("hero_title")) return;
  const S = {
    admin_password_hash: hashSenha("forms-admin"),
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
    contact_email: "contato@formsfitness.com",
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
/* A sessão guarda o INSTANTE do último uso, não só a existência do cookie.
   Sem prazo, um cookie copiado de um computador emprestado abriria o painel
   meses depois. Doze horas cobrem um dia de trabalho e o relógio reinicia a
   cada acesso — quem está usando não é interrompido. */
const SESSAO_HORAS = 12;
const sessions = new Map();
const authed = (req) => {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const visto = sessions.get(m[1]);
  if (!visto) return false;
  if (Date.now() - visto > SESSAO_HORAS * 3600_000) { sessions.delete(m[1]); return false; }
  sessions.set(m[1], Date.now());
  return true;
};
setInterval(() => {
  const limite = Date.now() - SESSAO_HORAS * 3600_000;
  for (const [k, v] of sessions) if (v < limite) sessions.delete(k);
}, 30 * 60_000).unref();

/* ==========================================================================
   CSP DO PAINEL

   Segunda linha de defesa: mesmo que um texto vindo do banco escape do escape
   do HTML, o navegador recusa script de outra origem, <object>/<embed> e a
   página dentro de um iframe alheio. `unsafe-inline` é necessário porque o
   painel usa <script> e style inline; `connect-src 'self'` impede que qualquer
   coisa injetada mande dados para fora.

   O SITE PÚBLICO segue sem CSP de propósito: ele usa estilo inline, imagens do
   Unsplash e fontes do Google, e uma política mal calibrada quebraria a página.
   Lá não há sessão nem dado sensível.
   ========================================================================== */
const CSP_PAINEL = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
  "form-action 'self'; img-src 'self' data: https:; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'";

/* ------------------------------ Publicar --------------------------------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


/* ==========================================================================
   TEXTO FORMATADO DO PAINEL

   O painel ganhou um editor com negrito, listas e links, e o que ele grava é
   HTML. Isso significa que o site passa a IMPRIMIR marcação vinda do banco —
   e é aí que mora o risco: um texto colado de fora traria script, iframe e
   estilo junto, e o site é público.

   A regra é LISTA DE PERMITIDOS. Só o que está aqui passa; o resto vira texto.
   Lista de proibidos sempre esquece alguma coisa, e a que esquecer é a que vai
   ser usada.

   `href` é o único atributo aceito, e só em <a>, com o esquema conferido:
   `javascript:` num link é execução de código com a cara de um link comum.
   ========================================================================== */
/* Com o botão "</>" dá para escrever marcação à mão, e uma tag que não estivesse
   nesta lista sumiria calada — a pessoa salvaria a tabela e ela simplesmente não
   apareceria no site. Por isso a lista cobre também o que se escreve à mão.
   Todas as adições são INERTES: não executam nada e ficam sem atributo nenhum,
   porque htmlLimpo só preserva o href do <a>. Continuam de fora img (sem src
   sobra uma tag vazia — foto é pelo campo de imagem) e tudo que roda código. */
const TAGS_SITE = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "a", "span", "div", "hr", "sub", "sup", "code", "pre",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption"]);
const LINK_SEGURO = /^(https?:\/\/|mailto:|tel:|\/|#)/i;

function htmlLimpo(valor) {
  if (valor === null || valor === undefined) return valor;
  let s = String(valor);
  if (!s.includes("<")) return s;                     // texto puro: nada a fazer

  /* Fora antes de tudo: o conteúdo destas some junto com a tag. Remover só a
     tag deixaria o código do script solto como texto visível na página. */
  s = s.replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[^>]*\/?>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tag, nome, attrs) => {
    const n = nome.toLowerCase();
    if (!TAGS_SITE.has(n)) return "";                 // descarta a tag, mantém o texto
    if (tag.startsWith("</")) return `</${n}>`;
    if (n === "br") return "<br>";
    if (n === "a") {
      const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || "");
      const href = m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
      if (!href || !LINK_SEGURO.test(href)) return "<a>";
      const externo = /^https?:\/\//i.test(href);
      return `<a href="${esc(href)}"${externo ? ' target="_blank" rel="noopener"' : ""}>`;
    }
    return `<${n}>`;                                   // todo o resto sem atributo
  });
}

/* Quais campos aceitam formatação. Fora daqui, o texto é gravado como veio.

   Os RESUMOS (`posts.excerpt`, `services.text`) ficam de propósito de fora:
   eles viram a descrição do Google e o JSON-LD, onde uma tag aparece crua no
   resultado de busca. O endereço também — entra no JSON-LD da clínica. */
const CAMPOS_RICOS = {
  posts: ["content"],
  services: ["text"],
  testimonials: ["text"],
  team: ["bio"],
};
function limparRicos(tabela, obj) {
  for (const c of CAMPOS_RICOS[tabela] || []) if (c in obj) obj[c] = htmlLimpo(obj[c]);
  return obj;
}

/* Um bloco de texto do painel, pronto para entrar na página.

   Convive com os dois formatos porque o conteúdo antigo é TEXTO PURO com
   parágrafos separados por linha em branco — e continua sendo, até alguém
   reabrir aquele texto no editor. Sem esta ponte, todo o conteúdo já
   publicado viraria um parágrafo só na primeira publicação depois desta
   versão. */
function blocoTexto(valor) {
  const s = String(valor || "").trim();
  if (!s) return "";
  if (/<(p|br|ul|ol|li|h2|h3|h4|blockquote|div|strong|b|em|i|a)\b/i.test(s)) return htmlLimpo(s);
  return s.split(/\n{2,}/).map((par) => `<p>${esc(par.trim()).replace(/\n/g, "<br>")}</p>`).join("\n        ");
}

/* ==========================================================================
   TAMANHO REAL DA IMAGEM

   O `width`/`height` do <img> não muda o tamanho na tela (quem manda é o CSS):
   ele diz ao navegador a PROPORÇÃO, para reservar o espaço certo antes de a
   imagem carregar. Sem isso a página dá um pulo quando ela chega — e o número
   errado é pior que nenhum, porque reserva um retângulo deitado para uma foto
   em pé.

   A capa da matéria vinha com `width="900" height="500"` fixos no template. A
   clínica sobe foto de WhatsApp, que quase sempre está EM PÉ: o navegador
   reservava paisagem e o CSS recortava o resto.

   Lê direto do cabeçalho do arquivo, sem biblioteca: são os primeiros bytes de
   cada formato. Só vale para os nossos uploads — imagem de fora (Unsplash) é
   uma URL, e buscá-la aqui deixaria a publicação dependendo da internet. Nesse
   caso não declaramos nada, e o CSS acerta a proporção quando a imagem chega.
   ========================================================================== */
function medirImagem(url) {
  const m = /^\/assets\/img\/uploads\/([A-Za-z0-9._-]+)$/.exec(String(url || ""));
  if (!m) return null;
  const arq = path.join(UPLOAD_DIR, m[1]);
  let b;
  try { b = fs.readFileSync(arq); } catch { return null; }

  // PNG: largura e altura em big-endian logo depois do IHDR
  if (b.length > 24 && b.toString("hex", 0, 8) === "89504e470d0a1a0a")
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };

  // GIF: little-endian, no cabeçalho
  if (b.length > 10 && (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a"))
    return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };

  // WEBP (VP8 simples, VP8L sem perdas e VP8X estendido guardam em lugares diferentes)
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const tipo = b.toString("ascii", 12, 16);
    if (tipo === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (tipo === "VP8L") {
      const n = b.readUInt32LE(21);
      return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
    }
    if (tipo === "VP8X") return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
  }

  // JPEG: percorre os segmentos até achar o "start of frame", que carrega o tamanho
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }                 // ressincroniza em byte de preenchimento
      const marca = b[i + 1];
      if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
      const tam = b.readUInt16BE(i + 2);
      /* SOF0..SOF15, menos DHT (c4), JPG (c8) e DAC (cc), que não são frames.
         É onde moram altura e largura — nesta ordem. */
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc)
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      if (tam < 2) break;                                    // tamanho inválido: para em vez de girar
      i += 2 + tam;
    }
  }
  return null;
}

/* Os atributos prontos para entrar no <img>, ou vazio se não dá para saber. */
function medidasDoImg(url) {
  const d = medirImagem(url);
  return d && d.w && d.h ? ` width="${d.w}" height="${d.h}"` : "";
}


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
            <div class="pro__bio">${blocoTexto(m.bio)}</div>
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
    const paragraphs = blocoTexto(p.content);
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
      IMAGE: esc(p.image), IMAGE_DIMS: medidasDoImg(p.image),
      DATE_ISO: esc(p.date), DATE_BR: dateBR(p.date),
      CONTENT_HTML: paragraphs,
      JSONLD: `<script type="application/ld+json">\n  ${JSON.stringify(pj, null, 2).replace(/\n/g, "\n  ")}\n  </script>`,
    }));
  }

  /* ---------- índice de busca (search-index.json) ----------

     Um arquivo pequeno com título, endereço e resumo de cada página. A busca
     roda no NAVEGADOR sobre ele: o site tem algumas dezenas de páginas, o
     índice cabe em poucos KB, e assim não é preciso um endpoint de busca no
     servidor — que seria mais uma porta para sondar e um banco consultado a
     cada tecla digitada. */
  const semTags = (x) => String(x || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const indiceBusca = [
    { t: "Início — Forms Fitness Academia Aquática", u: "/", tipo: "Página", d: semTags(S.hero_lead) },
    { t: "A Academia — 33 anos formando nadadores", u: "/#academia", tipo: "Página", d: semTags(S.about_lead) },
    { t: "Preparação para o TAF", u: "/#taf", tipo: "Modalidade", d: "Preparação para o Teste de Aptidão Física de concursos: PM, Bombeiros e Forças Armadas, com professores experientes em Caruaru-PE." },
    { t: "Estrutura da academia", u: "/#estrutura", tipo: "Página", d: "As fotos da piscina, dos vestiários e dos espaços da Forms Fitness." },
    { t: "Contato e aula experimental", u: "/#contato", tipo: "Página", d: `Fale com a Forms Fitness pelo WhatsApp ${S.whatsapp_display || ""} ou pelo e-mail ${S.contact_email || ""}.` },
    ...services.map((x) => ({ t: x.title, u: "/#modalidades", tipo: "Modalidade", d: semTags(x.text) })),
    ...team.map((m) => ({ t: m.name, u: "/#equipe", tipo: "Equipe", d: `${semTags(m.role)}. ${semTags(m.bio)}` })),
    ...posts.map((p) => ({ t: p.title, u: `/blog/${p.slug}/`, tipo: "Blog", d: semTags(p.excerpt) + " " + semTags(p.content).slice(0, 300) })),
    { t: "Política de Privacidade", u: "/privacidade/", tipo: "Institucional", d: "Como tratamos os seus dados pessoais: o que coletamos, por quê, com quem compartilhamos, prazos de guarda e como exercer os seus direitos pela LGPD." },
  ];
  fs.mkdirSync(path.join(ROOT, "assets", "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "assets", "data", "search-index.json"), JSON.stringify(indiceBusca));

  /* ---------- páginas fixas geradas de src/ ----------
     Ficam aqui, e não em arquivos soltos, para que o número do WhatsApp
     acompanhe o que o cliente salvou no painel — em vez de continuar o
     placeholder do dia em que a página foi escrita. */
  for (const pagina of ["busca", "privacidade"]) {
    const tpl = path.join(ROOT, "src", `${pagina}.html`);
    if (!fs.existsSync(tpl)) continue;
    fs.mkdirSync(path.join(ROOT, pagina), { recursive: true });
    fs.writeFileSync(path.join(ROOT, pagina, "index.html"),
      fs.readFileSync(tpl, "utf8").replace(/wa\.me\/\d+(?![?\d])/g, `wa.me/${S.whatsapp}`));
  }

  /* ------------------------------ Sitemap --------------------------------- */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${SITE}/blog/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ...posts.map((p) => `  <url><loc>${SITE}/blog/${p.slug}/</loc><lastmod>${p.date || today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
    /* A /busca/ fica de FORA de propósito: é noindex, porque o conteúdo dela
       muda a cada termo e não é uma página de verdade. */
    `  <url><loc>${SITE}/privacidade/</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>`,
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

/* ============================== BACKUP ==================================
   Todo o site vive num arquivo só. As cópias ficam FORA de `data/` para que
   um comando errado na pasta do banco não leve as cópias junto — o backup
   guardado ao lado do original protege contra defeito, não contra engano. */
const BACKUP_CFG = {
  destino: path.join(ROOT, "backups"),
  bancos: [path.join(ROOT, "data", "site.db")],
  intervaloHoras: Number(process.env.BACKUP_HORAS) || 24,
  manter: Number(process.env.BACKUP_MANTER) || 30,
};

/* `node server.js --backup` força uma cópia agora, SEM subir o servidor. É o
   que o deploy.sh chama antes de encostar em qualquer coisa: se a atualização
   der errado, existe um ponto de retorno de segundos atrás. */
if (process.argv.includes("--backup")) {
  const { rodarBackup } = require("./backup");
  const feitos = rodarBackup(BACKUP_CFG, "manual");
  process.exit(feitos.length ? 0 : 1);
}
/* `--backup-status` lista a situação em JSON — usado pelo verificar.sh. */
if (process.argv.includes("--backup-status")) {
  const { statusBackup } = require("./backup");
  console.log(JSON.stringify(statusBackup(BACKUP_CFG), null, 2));
  process.exit(0);
}

/* ==========================================================================
   MODO MANUTENÇÃO — duas camadas, porque uma sozinha não cobre tudo:

   1) Aqui no app: com a chave ligada, todo visitante recebe a página de aviso
      com HTTP 503. Quem está logado no painel continua vendo o site normal,
      para poder conferir antes de reabrir.

   2) No nginx: o MESMO arquivo é servido quando o app está FORA DO AR
      (502/503/504). É o que cobre restart, deploy e queda — momentos em que
      não existe app para responder coisa nenhuma, e sem o qual o visitante
      veria a tela cinza de "502 Bad Gateway".

   Por isso a página é gravada em DISCO como arquivo estático: o nginx precisa
   conseguir lê-la sem depender do Node. E por isso ela não referencia nenhum
   arquivo externo — CSS e desenho vão embutidos, senão apareceriam quebrados
   justamente na hora em que o servidor não responde.
   ========================================================================== */
const emManutencao = () => getS("manutencao") === "1";

function gerarPaginaManutencao(S) {
  const titulo = S.manutencao_titulo || "Estamos atualizando o site";
  const texto = S.manutencao_texto || "Volte em instantes.";
  const zap = String(S.whatsapp || "").replace(/\D/g, "");
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${esc(titulo)} — Forms Fitness</title>
  <style>
    /* CSS embutido de propósito: se o app estiver fora do ar, o styles.css
       também não é servido — esta página tem de se sustentar sozinha. As
       fontes são as do sistema pelo mesmo motivo. */
    *{box-sizing:border-box;margin:0}
    body{min-height:100vh;display:grid;place-items:center;padding:2rem;
      background:radial-gradient(700px 420px at 80% 0%,rgba(31,168,220,.16),transparent 60%),
                 radial-gradient(560px 380px at 0% 100%,rgba(126,211,33,.12),transparent 60%),#F4FAFE;
      font-family:"Nunito Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0E2A4A;line-height:1.65}
    .caixa{max-width:34rem;text-align:center;background:#fff;border-radius:20px;padding:3rem 2.4rem;
      box-shadow:0 18px 46px -16px rgba(8,59,126,.28)}
    h1{font-family:Archivo,system-ui,sans-serif;font-weight:900;font-size:clamp(1.5rem,4vw,2.1rem);
      line-height:1.15;margin-bottom:.8rem;color:#0B4EA2}
    p{color:#48617E}
    .onda{margin:0 auto 1.6rem;display:block}
    .zap{display:inline-flex;align-items:center;gap:.5rem;margin-top:1.6rem;padding:.85rem 1.7rem;
      border-radius:999px;background:linear-gradient(120deg,#8FE334,#7ED321);color:#072B5C;
      text-decoration:none;font-weight:800;font-family:Archivo,system-ui,sans-serif}
    .marca{margin-top:2rem;padding-top:1.4rem;border-top:1px solid rgba(11,78,162,.14);
      font-family:Archivo,system-ui,sans-serif;letter-spacing:.06em;color:#0B4EA2;font-weight:800;font-size:.9rem}
    .pulso{animation:pulso 2.6s ease-in-out infinite}
    @keyframes pulso{0%,100%{opacity:1;transform:translateY(0)}50%{opacity:.7;transform:translateY(-6px)}}
    @media(prefers-reduced-motion:reduce){.pulso{animation:none}}
  </style>
</head>
<body>
  <main class="caixa">
    <svg class="onda pulso" width="96" height="96" viewBox="0 0 24 24" fill="none"
         stroke="#1FA8DC" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
         role="img" aria-label="Forms Fitness">
      <circle cx="16.5" cy="6.5" r="2.2" fill="#7ED321" stroke="none"/>
      <path d="m4 13 4.5-3.5L14 12l4-2.5" stroke="#0B4EA2"/>
      <path d="M2 18c1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0"/>
      <path d="M2 21.5c1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0 1.7 1.4 3.3 1.4 5 0" opacity=".45"/>
    </svg>
    <h1>${esc(titulo)}</h1>
    <p>${esc(texto)}</p>
    ${zap ? `<a class="zap" href="https://wa.me/${esc(zap)}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ""}
    <p class="marca">FORMS FITNESS · ACADEMIA AQUÁTICA</p>
  </main>
</body>
</html>`;
  fs.writeFileSync(path.join(ROOT, "manutencao.html"), html);
  return html;
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

  /* ==========================================================================
     CABEÇALHOS DE PROTEÇÃO — em TODA resposta, antes de qualquer rota

     · nosniff       — impede o navegador de "adivinhar" que um .txt é script
     · frame-options — impede o site dentro de um iframe alheio (clickjacking)
     · referrer      — o endereço da nossa página não vaza para terceiros
     · permissions   — nega câmera, microfone e localização a qualquer script
     · HSTS          — só sob HTTPS: manda o navegador nunca mais tentar http,
                       o que fecha a janela do ataque de downgrade. Emitido pelo
                       app e não pelo nginx para valer em todas as áreas.
     ========================================================================== */
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  if (req.headers["x-forwarded-proto"] === "https")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  try {
    /* Modo manutenção: barra o visitante, mas deixa passar o painel, a API e
       os assets. Quem tem sessão de administrador continua vendo o site
       normal — é assim que se confere o resultado antes de reabrir. */
    if (emManutencao() && !p.startsWith("/admin") && !p.startsWith("/api/")
        && !p.startsWith("/assets/") && !p.startsWith("/.well-known/") && !authed(req)) {
      const arq = path.join(ROOT, "manutencao.html");
      const corpo = fs.existsSync(arq) ? fs.readFileSync(arq) : "Estamos atualizando o site. Volte em instantes.";
      /* 503 + Retry-After diz ao Google que é TEMPORÁRIO. Com 200 ele
         indexaria a página de aviso no lugar do site; com 404 concluiria que
         as páginas sumiram e as tiraria do índice. */
      res.writeHead(503, { "Content-Type": MIME[".html"], "Retry-After": "3600", "Cache-Control": "no-store" });
      return res.end(corpo);
    }

    if (p.startsWith("/api/")) {
      if (p === "/api/login" && req.method === "POST") {
        const ip = ipDoCliente(req);
        /* O painel tem um dono só, então a "conta" é sempre a mesma — e é
           justamente isso que faz o balde por conta valer aqui: ele soma os
           erros de TODOS os endereços, que é como o ataque distribuído era
           invisível para a trava por IP. */
        const v = limite.verificar("painel", ip, "admin");
        if (!v.ok) { res.setHeader("Retry-After", String(v.esperar)); return json(res, 429, { error: v.mensagem }); }
        const { password } = await readBody(req);
        const guardado = getS("admin_password_hash");
        const certa = guardado ? confereSenha(password, guardado) : (confereSenha(password, HASH_ISCA), false);
        if (!certa) { limite.errou("painel", ip, "admin"); return json(res, 401, { error: "Senha incorreta" }); }
        limite.acertou("painel", ip, "admin");
        // acertou com o formato antigo: regrava em scrypt e o velho some
        if (!guardado.startsWith("scrypt$")) setS("admin_password_hash", hashSenha(password));
        const t = crypto.randomBytes(24).toString("hex");
        sessions.set(t, Date.now());
        const https = req.headers["x-forwarded-proto"] === "https";
        /* Max-Age: sessão sem prazo é sessão eterna — um cookie roubado valeria
           para sempre. Secure sob HTTPS impede que ele trafegue em claro. */
        res.setHeader("Set-Cookie",
          `sid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSAO_HORAS * 3600}${https ? "; Secure" : ""}`);
        return json(res, 200, { ok: true });
      }
      if (!authed(req)) return json(res, 401, { error: "Não autenticado" });
      if (p === "/api/me") return json(res, 200, { ok: true, version: APP_VERSION });

      /* Liga/desliga o modo manutenção e devolve o estado atual. O GET serve
         para a tela do painel abrir já preenchida. */
      if (p === "/api/stats") return json(res, 200, statsAcessos());
      if (p === "/api/manutencao") {
        if (req.method === "POST") {
          const { ligar, titulo, texto } = await readBody(req);
          if (titulo !== undefined) setS("manutencao_titulo", titulo);
          if (texto !== undefined) setS("manutencao_texto", texto);
          setS("manutencao", ligar ? "1" : "0");
          const S = {}; for (const r of db.prepare("SELECT key,value FROM settings").all()) S[r.key] = r.value;
          gerarPaginaManutencao(S);   // regrava o arquivo que o nginx usa nas quedas
          console.log("  · modo manutenção " + (ligar ? "LIGADO" : "desligado"));
        }
        return json(res, 200, { ok: true, ligado: emManutencao(),
          titulo: getS("manutencao_titulo") || "", texto: getS("manutencao_texto") || "" });
      }
      if (p === "/api/logout" && req.method === "POST") {
        const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); if (m) sessions.delete(m[1]);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/password" && req.method === "POST") {
        /* Aqui também se adivinha senha: este endereço recebe a senha ATUAL.
           Sem freio, quem roubasse um cookie de sessão poderia testar a senha
           atual à vontade por aqui, contornando o login. */
        const ipT = ipDoCliente(req);
        const vT = limite.verificar("troca-senha", ipT, "admin");
        if (!vT.ok) { res.setHeader("Retry-After", String(vT.esperar)); return json(res, 429, { error: vT.mensagem }); }
        const { current, next } = await readBody(req);
        if (!confereSenha(current, getS("admin_password_hash"))) {
          limite.errou("troca-senha", ipT, "admin");
          return json(res, 400, { error: "Senha atual incorreta" });
        }
        limite.acertou("troca-senha", ipT, "admin");
        if (!next || String(next).length < 8) return json(res, 400, { error: "A nova senha precisa de ao menos 8 caracteres." });
        if (confereSenha(next, getS("admin_password_hash"))) return json(res, 400, { error: "A nova senha é igual à atual." });
        setS("admin_password_hash", hashSenha(next));
        /* Trocar a senha derruba as OUTRAS sessões: se alguém tinha um cookie
           roubado, é agora que ele para de valer. */
        const meu = (/sid=([a-f0-9]+)/.exec(req.headers.cookie || "") || [])[1];
        for (const k of [...sessions.keys()]) if (k !== meu) sessions.delete(k);
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
          limparRicos(table, b);
          const use = cols.filter((c) => c in b);
          db.prepare(`INSERT INTO ${table}(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`).run(...use.map((c) => b[c]));
          return json(res, 200, { ok: true });
        }
        if (req.method === "PUT" && id) {
          limparRicos(table, b);
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
        /* SVG fica DE FORA de propósito: é XML e pode carregar <script> dentro.
           Servido como image/svg+xml a partir do nosso domínio, ele executaria
           na origem do site — XSS armazenado por upload. Foi uma das falhas
           reais encontradas na auditoria do BemEstar. As fotos do painel são
           todas raster; os SVGs do layout são arquivos do projeto. */
        const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/.exec(dataUrl || "");
        if (!m) return json(res, 400, { error: "Envie uma imagem PNG, JPG, WEBP ou GIF." });
        const safe = slug(path.parse(name || "foto").name).slice(0, 40) || "foto";
        const ext = "." + m[1].split("/")[1].replace("jpeg", "jpg");
        const file = `${Date.now().toString(36)}-${safe}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], "base64"));
        return json(res, 200, { ok: true, path: `/assets/img/uploads/${file}` });
      }
      if (p === "/api/publish" && req.method === "POST") return json(res, 200, { ok: true, ...publish() });
      return json(res, 404, { error: "Rota não encontrada" });
    }

    if (p === "/admin" || p === "/admin/") {
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": CSP_PAINEL });
      return res.end(fs.readFileSync(path.join(ROOT, "admin", "index.html")));
    }
    /* ======================================================================
       O QUE NUNCA É SERVIDO

       A lista antiga cobria só /data, /src e o server.js. Ficavam acessíveis
       pela web coisas que não são página: dotfiles (o /.git inteiro, com todo
       o histórico), scripts de operação e arquivos de banco.

       Na auditoria do BemEstar, um `deploy.sh` servido em HTTP 200 entregava o
       nome do serviço, o usuário do systemd e o caminho da aplicação — mapa
       pronto para quem estivesse sondando. Por isso o bloqueio é por PASTA e
       por EXTENSÃO, e não por uma lista de nomes.
       ====================================================================== */
    const dirProibido = /^\/(data|src|backups|node_modules|\.[^/]+)(\/|$)/i;
    const extProibida = /\.(sh|bash|service|env|conf|ini|sql|db|db-wal|db-shm|pem|key|crt|backup|old|orig|swp|tmp|log|md)$/i;
    if (dirProibido.test(p) || extProibida.test(p) || /(^|\/)(server|db)\.js$/i.test(p) ||
        /(^|\/)\.[^/]+$/.test(p) || /(^|\/)package(-lock)?\.json$/i.test(p)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("404");
    }

    let file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
    if (p === "/") file = path.join(ROOT, "index.html");
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404"); }
    /* Conta só PÁGINA, não imagem nem CSS: senão um acesso viraria dezenas.
       Fica aqui, no ponto em que o arquivo já foi resolvido — antes disso não
       se sabe se a URL era mesmo uma página. */
    if (path.extname(file) === ".html") trackVisit(req, p);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  } catch (e) { json(res, 500, { error: e.message }); }
/* Escuta só no localhost: quem fala com o mundo é o nginx. Sem isto, o painel
   ficaria acessível por http://IP:5186/admin/ — sem HTTPS, com o cookie de
   sessão trafegando em claro e sem nenhum dos cabeçalhos que o proxy aplica.
   Para expor direto (ambiente sem proxy), rode com HOST=0.0.0.0 */
}).listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`\n  Forms Fitness — site + gerenciador v${APP_VERSION}`);
  console.log(`  · Site:   http://localhost:${PORT}/`);
  console.log(`  · Painel: http://localhost:${PORT}/admin/`);
  console.log(`  · Banco:  ${DRIVER_NOME}${DRIVER_AVISO ? "  ⚠ " + DRIVER_AVISO : ""}`);
  /* Depois do listen, nunca antes: o backup não pode atrasar o site subir. */
  agendarBackups(BACKUP_CFG);
  /* Testa a escrita no boot. Sem isto, um banco somente-leitura só aparece
     quando o cliente tenta salvar algo e nada acontece — e o log fica mudo. */
  try {
    setS("_teste_escrita", String(Date.now()));
    db.prepare("DELETE FROM settings WHERE key='_teste_escrita'").run();
  } catch (e) {
    const usuario = (() => { try { return require("node:os").userInfo().username; } catch { return "root"; } })();
    console.error(`  ✖ BANCO SEM PERMISSÃO DE ESCRITA: ${e.message}`);
    console.error(`    O painel não vai conseguir salvar nada. O processo roda como: ${usuario}`);
    console.error(`    Corrija com: sudo chown -R ${usuario}: "${ROOT}/data" "${ROOT}/assets/img/uploads"`);
  }
  // avisa sem imprimir a senha: em produção este log vai parar no journalctl
  if (confereSenha("forms-admin", getS("admin_password_hash")))
    console.log(`  ⚠ A senha do painel ainda é a padrão. Troque em Senha antes de publicar.`);
  console.log("");
});
