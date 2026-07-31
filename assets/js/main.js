/* ==========================================================================
   main.js — Forms Fitness Academia Aquática · interações leves
   Header no scroll · menu mobile · reveal · form → WhatsApp · FAB WhatsApp
   ========================================================================== */
import { WHATSAPP_NUMBER, GA4_ID, GTM_ID, META_PIXEL_ID, CLARITY_ID, HOTJAR_ID } from "./config.js";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

function initHeader() {
  const h = $(".site-header");
  if (!h) return;
  const on = () => h.classList.toggle("is-scrolled", window.scrollY > 8);
  on();
  window.addEventListener("scroll", on, { passive: true });
}

function initMobileNav() {
  const t = $(".nav-toggle"), nav = $("#primary-nav");
  if (!t || !nav) return;
  const set = (o) => { nav.classList.toggle("is-open", o); t.setAttribute("aria-expanded", String(o)); };
  t.addEventListener("click", () => set(t.getAttribute("aria-expanded") !== "true"));
  $$("a", nav).forEach((a) => a.addEventListener("click", () => set(false)));
}

function initReveal() {
  const els = $$("[data-reveal]");
  if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("is-visible"));
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}

let toastT;
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("is-visible"));
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("is-visible"), 2800);
}

function initForm() {
  const form = $("#lead-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const msg = encodeURIComponent(
      `*Aula experimental — Forms Fitness* 🏊\n\nNome: ${d.nome}\nModalidade: ${d.modalidade}\nIdade do aluno: ${d.idade || "-"}\n\nMensagem:\n${d.mensagem || "-"}\n\nWhatsApp: ${d.whatsapp}`
    );
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank", "noopener");
    toast("Abrindo o WhatsApp com o seu pedido…");
    form.reset();
  });
}

/* O cartão do vídeo na Estrutura é EM PÉ (9/16), que é o formato de quem
   grava no celular. Se o arquivo for deitado, preencher o cartão cortaria as
   laterais — e num vídeo de piscina é justamente a lateral que mostra o
   espaço. Aqui a proporção real é medida quando os metadados chegam, e o
   cartão passa a CONTER o vídeo em vez de cortá-lo.

   Só o arquivo local dá para medir. Link do YouTube vem em iframe, e o
   conteúdo de outro domínio não pode ser inspecionado — nesse caso o player
   se vira sozinho dentro do cartão. */
function initVideoEstrutura() {
  const cartao = $(".video-coluna");
  if (!cartao) return;
  const v = cartao.querySelector("video");
  if (!v) return;
  const medir = () => {
    if (!v.videoWidth || !v.videoHeight) return;
    cartao.classList.toggle("e-deitado", v.videoWidth > v.videoHeight);
  };
  if (v.readyState >= 1) medir();
  v.addEventListener("loadedmetadata", medir);
}

function initFab() {
  if ($(".wa-fab")) return;
  const msg = encodeURIComponent("Olá! Vim pelo site da Forms Fitness e quero agendar uma aula experimental. 🏊");
  const a = document.createElement("a");
  a.className = "wa-fab";
  a.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
  a.target = "_blank"; a.rel = "noopener";
  a.setAttribute("aria-label", "Falar com a Forms Fitness no WhatsApp");
  /* Sem o rótulo escrito, o title é o que explica o botão a quem passa o
     mouse — o ícone sozinho é claro para a maioria, mas não para todos. */
  a.setAttribute("title", "Falar no WhatsApp");
  a.innerHTML = `<svg class="wa-fab__icon" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3C9 3 3.5 8.5 3.5 15.5c0 2.4.7 4.7 1.9 6.7L4 29l7-1.8c1.9 1 4 1.6 6 1.6 7 0 12.5-5.5 12.5-12.5S23 3 16 3Zm0 22.7c-1.8 0-3.6-.5-5.2-1.4l-.4-.2-4.1 1.1 1.1-4-.2-.4a10 10 0 0 1-1.6-5.4C5.6 9.7 10.3 5 16 5s10.4 4.7 10.4 10.5S21.7 25.7 16 25.7Zm5.7-7.8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 0 1-2.4-1.5 9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.9s1.2 3.4 1.4 3.6c.2.2 2.4 3.7 5.8 5.1.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 2-.8 2.2-1.6.3-.8.3-1.4.2-1.6l-.6-.3Z"/></svg>`;
  document.body.appendChild(a);
}

/* ==========================================================================
   CONSENTIMENTO DE COOKIES (LGPD)

   Hoje o site não grava cookie nenhum por conta própria. O banner existe para
   controlar os scripts de MEDIÇÃO (GA4/GTM/Pixel/Clarity/Hotjar): eles só são
   carregados depois do "Aceitar cookies".

   Isso é o ponto todo. Um aviso que apenas informa — e carrega o rastreamento
   de qualquer jeito — não cumpre a LGPD, que exige consentimento PRÉVIO. Aqui,
   sem escolha explícita, nada de terceiros roda.

   Os IDs de medição estão vazios em config.js à espera do cliente. No dia em
   que forem preenchidos, o site já sabe respeitar a escolha do visitante — o
   contrário (preencher primeiro e lembrar do banner depois) é o caminho comum
   para tomar multa.
   ========================================================================== */
const CONSENT_COOKIE = "ff_consent";
const CONSENT_DIAS = 180;

const lerConsent = () =>
  (new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(aceito|essenciais)`).exec(document.cookie) || [])[1] || null;

function gravarConsent(valor) {
  const seguro = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${valor}; Max-Age=${CONSENT_DIAS * 86400}; Path=/; SameSite=Lax${seguro}`;
}

/* Injeta os scripts de medição — só é chamado com consentimento explícito. */
let medicaoCarregada = false;
function carregarMedicao() {
  if (medicaoCarregada) return;
  medicaoCarregada = true;
  const script = (src) => {
    const s = document.createElement("script");
    s.async = true; s.src = src;
    document.head.appendChild(s);
  };
  const inline = (code) => {
    const s = document.createElement("script");
    s.textContent = code;
    document.head.appendChild(s);
  };

  if (GA4_ID) {
    script(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
    inline(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
      gtag('js',new Date());gtag('config','${GA4_ID}',{anonymize_ip:true});`);
  }
  if (GTM_ID) {
    inline(`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
      var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
      j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
      })(window,document,'script','dataLayer','${GTM_ID}');`);
  }
  if (META_PIXEL_ID) {
    inline(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`);
  }
  if (CLARITY_ID) {
    inline(`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_ID}");`);
  }
  if (HOTJAR_ID) {
    inline(`(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
      h._hjSettings={hjid:${HOTJAR_ID},hjsv:6};a=o.getElementsByTagName('head')[0];
      r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j;a.appendChild(r);
      })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`);
  }
}

function montarBanner() {
  if ($(".cookie-bar")) return;
  const bar = document.createElement("div");
  bar.className = "cookie-bar";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-live", "polite");
  bar.setAttribute("aria-label", "Aviso sobre cookies");
  bar.innerHTML = `
    <div class="cookie-bar__text">
      <b>A gente usa cookies. 🍪</b>
      <p>Alguns são necessários para o site funcionar. Com a sua autorização, usamos também cookies de medição — só para entender como as pessoas chegam até a academia e melhorar o site. <a href="/privacidade/">Ler a Política de Privacidade</a>.</p>
    </div>
    <div class="cookie-bar__acoes">
      <button type="button" class="btn btn--ghost btn--sm" data-consent="essenciais">Só os essenciais</button>
      <button type="button" class="btn btn--lime btn--sm" data-consent="aceito">Aceitar cookies</button>
    </div>`;
  document.body.appendChild(bar);

  /* O botão do WhatsApp é criado ANTES do banner, então seletor de irmão não
     alcança: marcamos o body e publicamos a ALTURA REAL do aviso para o CSS
     subir o botão exatamente o quanto precisa — o texto quebra em mais linhas
     no celular, e um valor fixo deixaria um deles por cima do outro. */
  const marcarAltura = () => {
    document.body.classList.add("has-cookie-bar");
    document.body.style.setProperty("--cookie-bar-h", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  };
  marcarAltura();
  window.addEventListener("resize", marcarAltura);
  requestAnimationFrame(() => bar.classList.add("is-open"));

  bar.addEventListener("click", (e) => {
    const escolha = e.target.closest("[data-consent]")?.dataset.consent;
    if (!escolha) return;
    gravarConsent(escolha);
    if (escolha === "aceito") carregarMedicao();
    bar.classList.remove("is-open");
    document.body.classList.remove("has-cookie-bar");
    window.removeEventListener("resize", marcarAltura);
    setTimeout(() => bar.remove(), 350);
    toast(escolha === "aceito" ? "Preferência salva. Obrigado! 🏊" : "Certo — só os cookies essenciais.");
  });
}

/* Links legais no rodapé de TODAS as páginas, injetados aqui para não precisar
   editar cada template. A LGPD exige que REVER a escolha seja tão fácil quanto
   fazê-la — por isso o "Preferências de cookies" fica sempre à mão. */
function linksRodape() {
  const alvo = $(".footer__bottom p") || $(".footer__bottom");
  if (!alvo || $(".cookie-prefs")) return;

  if (!alvo.querySelector('a[href="/privacidade/"]') && location.pathname !== "/privacidade/") {
    const p = document.createElement("a");
    p.href = "/privacidade/";
    p.textContent = "Privacidade";
    alvo.append(" · ", p);
  }

  const a = document.createElement("button");
  a.type = "button";
  a.className = "cookie-prefs";
  a.textContent = "Preferências de cookies";
  a.addEventListener("click", () => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    montarBanner();
  });
  alvo.append(" · ", a);
}

/* Lupa no topo → abre o campo → leva para /busca/?q= */
function initHeaderSearch() {
  const inner = $(".site-header .header__inner");
  if (!inner || $(".search-toggle")) return;

  const btn = document.createElement("button");
  btn.className = "search-toggle";
  btn.type = "button";
  btn.setAttribute("aria-label", "Pesquisar no site");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;

  const bar = document.createElement("div");
  bar.className = "site-search";
  bar.innerHTML = `
    <form class="site-search__form" role="search" action="/busca/" method="get">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="search" name="q" class="site-search__input" placeholder="Busque modalidades, matérias, professores…" autocomplete="off" aria-label="Buscar no site">
      <button type="submit" class="site-search__go">Buscar</button>
      <button type="button" class="site-search__close" aria-label="Fechar busca">✕</button>
    </form>`;

  const navToggle = $(".nav-toggle", inner);
  inner.insertBefore(btn, navToggle || null);
  $(".site-header").appendChild(bar);

  const input = $(".site-search__input", bar);
  const abrir = () => { bar.classList.add("is-open"); btn.setAttribute("aria-expanded", "true"); setTimeout(() => input.focus(), 60); };
  const fechar = () => { bar.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", () => bar.classList.contains("is-open") ? fechar() : abrir());
  $(".site-search__close", bar).addEventListener("click", fechar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
  /* Busca vazia recarregaria a página de resultados sem termo nenhum — melhor
     não sair do lugar e devolver o foco ao campo. */
  $(".site-search__form", bar).addEventListener("submit", (e) => {
    if (!input.value.trim()) { e.preventDefault(); input.focus(); }
  });
}

/* ==========================================================================
   Página /busca/: lê o ?q=, filtra o índice e desenha os resultados.

   A busca é feita NO NAVEGADOR, sobre um índice pequeno gerado na publicação
   (assets/data/search-index.json). Não há endpoint de busca no servidor: o
   site tem algumas dezenas de páginas, o índice cabe em poucos KB, e assim a
   busca não vira uma porta a mais para sondar nem custa banco a cada tecla.
   ========================================================================== */
async function initSearchResults() {
  const results = $("#busca-results");
  if (!results) return;
  const status = $("#busca-status");
  const form = $("#busca-form"), input = $("#busca-input");
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const q = new URLSearchParams(location.search).get("q") || "";
  input.value = q;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const nq = input.value.trim();
    location.href = "/busca/" + (nq ? "?q=" + encodeURIComponent(nq) : "");
  });

  if (!q.trim()) { status.textContent = "Digite um termo para buscar."; return; }
  document.title = `Busca: ${q} — Forms Fitness`;

  let data = [];
  try { data = await (await fetch("/assets/data/search-index.json")).json(); }
  catch { status.textContent = "Não foi possível carregar a busca agora."; return; }

  /* Acerto no TÍTULO vale mais que no texto: quem procura "TAF" quer a página
     do TAF, não toda matéria que cita a sigla de passagem. */
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const scored = data.map((it) => {
    const hayT = norm(it.t), hayD = norm(it.d);
    let score = 0;
    for (const term of terms) {
      if (hayT.includes(term)) score += 10;
      if (hayD.includes(term)) score += 3;
    }
    return { it, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  status.textContent = scored.length
    ? `${scored.length} resultado${scored.length > 1 ? "s" : ""} para “${q}”.`
    : `Nenhum resultado para “${q}”. Tente outro termo — ou fale com a gente no WhatsApp.`;

  const escapar = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const destacar = (texto) => {
    let t = escapar(texto.slice(0, 180));
    /* Escapa o termo antes de virar regex: quem buscar "c++" ou "(taf)" faria
       a expressão explodir, e a página ficaria em branco sem explicação. */
    terms.forEach((term) => { t = t.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); });
    return t;
  };

  results.innerHTML = scored.map(({ it }) => `
    <a class="busca-item" href="${escapar(it.u)}">
      <span class="busca-item__tag">${escapar(it.tipo)}</span>
      <h3 class="busca-item__title">${escapar(it.t)}</h3>
      <p class="busca-item__desc">${destacar(it.d)}…</p>
    </a>`).join("");
}

/* ==========================================================================
   MATRÍCULA ONLINE (/matricula/)

   Monta a mensagem e abre o WhatsApp da academia — o número vem do painel,
   pelo config.js, e não fica escrito aqui.

   NADA É GRAVADO NO SITE. É decisão, não limitação: a ficha tem RG, CPF,
   endereço e filiação, inclusive de criança. Guardar isso num servidor cria
   uma obrigação de proteção que a academia não precisa assumir para um
   formulário que termina numa conversa de WhatsApp de qualquer jeito.
   ========================================================================== */
function initMatricula() {
  const form = $("#matricula-form");
  if (!form) return;

  const erro = $("#mat-erro");
  const blocoResp = $("#mat-responsavel");
  const blocoDocs = $("#mat-docs");
  const nasc = $("#m-nasc");

  /* Idade em anos completos. Comparar só o ano erraria em quem faz aniversário
     depois de hoje — e a diferença entre 17 e 18 é justamente o que decide se
     o responsável precisa entrar. */
  const idadeEm = (iso) => {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return null;
    const hoje = new Date();
    let a = hoje.getFullYear() - d.getFullYear();
    const m = hoje.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) a--;
    return a;
  };

  /* Menor de idade → pede responsável. Maior → pede RG e CPF. Os dois blocos
     se revezam, e o `required` acompanha: campo escondido e obrigatório trava
     o envio sem mostrar onde está o problema. */
  function ajustarPorIdade() {
    const idade = idadeEm(nasc.value);
    const menor = idade !== null && idade < 18;
    const maior = idade !== null && idade >= 18;

    blocoResp.hidden = !menor;
    blocoDocs.hidden = !maior;

    ["m-r-nome", "m-r-rg", "m-r-cpf"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.required = menor;
    });
  }
  nasc.addEventListener("change", ajustarPorIdade);
  nasc.addEventListener("blur", ajustarPorIdade);
  ajustarPorIdade();

  /* Máscaras leves: ajudam a digitar sem impedir colar nem atrapalhar quem usa
     leitor de tela. Só formatam o que já é número. */
  const soDig = (v) => String(v || "").replace(/\D/g, "");
  const mascara = (el, fn) => el && el.addEventListener("input", () => { el.value = fn(el.value); });
  mascara($("#m-cep"), (v) => soDig(v).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2"));
  const cpf = (v) => soDig(v).slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  mascara($("#m-cpf"), cpf);
  mascara($("#m-r-cpf"), cpf);
  const fone = (v) => soDig(v).slice(0, 11)
    .replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
  mascara($("#m-whats"), fone);

  const dataBR = (iso) => {
    const [a, m, d] = String(iso || "").split("-");
    return d ? `${d}/${m}/${a}` : (iso || "—");
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    erro.hidden = true;

    /* `reportValidity` só aponta o primeiro campo. A mensagem própria diz
       QUANTOS faltam e leva até o primeiro — numa ficha longa, sair rolando
       atrás do campo vermelho é o que faz a pessoa desistir. */
    if (!form.checkValidity()) {
      const faltando = [...form.querySelectorAll(":invalid")].filter((el) => !el.disabled);
      const primeiro = faltando[0];
      erro.textContent = faltando.length === 1
        ? "Falta preencher um campo obrigatório."
        : `Faltam ${faltando.length} campos obrigatórios.`;
      erro.hidden = false;
      if (primeiro) {
        primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => primeiro.focus({ preventScroll: true }), 350);
      }
      return;
    }

    const d = Object.fromEntries(new FormData(form).entries());
    const idade = idadeEm(d.nascimento);
    const menor = idade !== null && idade < 18;
    const v = (x) => (String(x || "").trim() || "—");

    const linhas = ["*MATRÍCULA ONLINE — FORMS FITNESS* 🏊", "", "*DADOS DO ALUNO*"];

    /* Numeração em sequência, e não fixa de 1 a 10. RG e CPF só entram quando
       o aluno é maior; com números fixos, a lista de um menor saltaria de "2"
       para "5" e pareceria que dois campos ficaram sem resposta. */
    let i = 0;
    const item = (rotulo, valor) => linhas.push(`${++i}. ${rotulo}: ${valor}`);

    item("Nome", v(d.nome));
    item("Nascimento", `${dataBR(d.nascimento)}${idade !== null ? ` (${idade} anos)` : ""}`);
    if (!menor) { item("RG", v(d.rg)); item("CPF", v(d.cpf)); }
    item("Endereço", `${v(d.endereco)} — CEP ${v(d.cep)}`);
    item("Profissão", v(d.profissao));
    item("Estado civil", v(d.estado_civil));
    item("Mãe", v(d.mae));
    item("Pai", v(d.pai));
    item("Horário escolhido", v(d.horario));

    if (menor) {
      linhas.push(
        "", "*RESPONSÁVEL* (aluno menor de idade)",
        `• Nome: ${v(d.resp_nome)}`,
        `• RG: ${v(d.resp_rg)}`,
        `• CPF: ${v(d.resp_cpf)}`,
        `• Profissão: ${v(d.resp_profissao)}`,
        `• Estado civil: ${v(d.resp_estado_civil)}`,
      );
    }

    linhas.push(
      "", "*CONTATO*",
      `📞 WhatsApp: ${v(d.whatsapp)}`,
      `📷 Instagram: ${v(d.instagram)}`,
      "", "*AUTORIZAÇÃO*",
      "(X) Declaro que realizei a matrícula online e sou responsável pelas informações fornecidas.",
      "(X) Reconheço que devo cumprir com os pagamentos e com o horário fixo escolhido, conforme contrato.",
      "(X) Autorizo a efetivação da matrícula.",
      "", "_Falta enviar: foto do aluno e comprovante de pagamento._",
    );

    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(linhas.join("\n"))}`, "_blank", "noopener");
    toast("Abrindo o WhatsApp com a sua matrícula…");
  });
}

function initConsent() {
  linksRodape();
  const escolha = lerConsent();
  if (!escolha) montarBanner();
  else if (escolha === "aceito") carregarMedicao();
}

function initYear() { const y = $("#year"); if (y) y.textContent = new Date().getFullYear(); }

function boot() { initHeader(); initMobileNav(); initHeaderSearch(); initReveal(); initForm(); initFab(); initYear(); initSearchResults(); initMatricula(); initVideoEstrutura(); initConsent(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
