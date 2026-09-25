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
  /* Na HOME os links legais moram na coluna "Institucional" do rodapé — o
     template já traz Privacidade e Área da equipe escritos, e aqui só nasce o
     "Preferências de cookies": ele É um botão de JavaScript (reabre o banner),
     e botão que não faz nada sem script não deve existir sem script.

     As páginas INTERNAS têm rodapé reduzido, sem colunas — nelas tudo segue
     na barra, como sempre foi. A LGPD pede que rever a escolha de cookies
     seja tão fácil quanto fazê-la, então o botão existe nos dois mundos. */
  const coluna = $(".footer__legal");
  const alvo = coluna || $(".footer__bottom p") || $(".footer__bottom");
  if (!alvo || $(".cookie-prefs")) return;

  if (!coluna && !alvo.querySelector('a[href="/privacidade/"]') && location.pathname !== "/privacidade/") {
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
  /* Na coluna, o botão entra ANTES do link da equipe: os assuntos do
     visitante (privacidade, cookies) ficam juntos e o atalho interno fecha a
     lista. Na barra, o separador de sempre. */
  const equipe = coluna ? coluna.querySelector(".footer-admin") : null;
  if (equipe) alvo.insertBefore(a, equipe);
  else alvo.append(" · ", a);
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

   A ficha vai para o sistema de gestão da academia (/api/publico/matricula)
   e entra como PRÉ-MATRÍCULA: a secretaria confere, escolhe a mensalidade e
   efetiva — só aí o aluno ganha o código. Um formulário aberto na internet não
   pode gastar número de matrícula nem virar aluno sozinho.

   (1.27.0) A foto do aluno e o comprovante de pagamento vão JUNTO com a ficha,
   e sem eles não há envio. A foto é reduzida aqui no aparelho antes de subir:
   a do celular tem 4 MB e 12 megapixels para ocupar 3×4 cm na ficha, e
   redesenhá-la também descarta os metadados EXIF — que numa foto de celular
   incluem a localização GPS de onde foi tirada, muitas vezes a casa da criança.
   O comprovante sobe como veio: PDF não é imagem, e reduzir um print apaga
   justamente o valor e a data em letra pequena.

   Toda regra aqui é conforto de quem digita. Quem decide é o servidor, que
   confere tudo de novo — este arquivo qualquer um pode editar no navegador.
   ========================================================================== */
function initMatricula() {
  const form = $("#matricula-form");
  if (!form) return;

  /* Página antiga (guardada no navegador de antes da 1.20.0) com este script
     novo: os campos não batem. Em vez de quebrar no meio — e deixar o
     formulário antigo enviar sozinho, por GET, com CPF e endereço na URL —
     recarrega para pegar a página nova. */
  if (!form.querySelector('[name="site_url"]')) {
    form.addEventListener("submit", (e) => { e.preventDefault(); location.reload(); });
    return;
  }

  const erro = $("#mat-erro");
  const blocoResp = $("#mat-responsavel");
  const blocoDocs = $("#mat-docs");
  const nasc = $("#m-nasc");
  const botao = form.querySelector(".mat-enviar");
  const selTurma = $("#m-turma");

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

  /* Menor de idade → pede responsável. Maior → pede CPF. Os dois blocos se
     revezam, e o `required` acompanha: campo escondido e obrigatório trava o
     envio sem mostrar onde está o problema. O texto do consentimento também
     muda: para criança, quem autoriza é o responsável (LGPD, art. 14). */
  const textoDados = $("#mat-texto-dados");
  const linkPriv = '<a href="/privacidade/" target="_blank" rel="noopener">Política de Privacidade</a>';
  function ajustarPorIdade() {
    const idade = idadeEm(nasc.value);
    const menor = idade !== null && idade < 18;
    const maior = idade !== null && idade >= 18;

    blocoResp.hidden = !menor;
    blocoDocs.hidden = !maior;
    ["m-r-nome", "m-r-rg", "m-r-cpf", "m-r-fone"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.required = menor;
    });
    $("#m-cpf").required = maior;

    textoDados.innerHTML = menor
      ? `Como responsável legal pelo aluno, autorizo a Forms Fitness a guardar os dados dele e os meus para a gestão da matrícula, conforme a ${linkPriv}.`
      : `Autorizo a Forms Fitness a guardar estes dados para a gestão da matrícula, conforme a ${linkPriv}.`;
  }
  nasc.addEventListener("change", ajustarPorIdade);
  nasc.addEventListener("blur", ajustarPorIdade);
  ajustarPorIdade();

  /* Os horários vêm da gestão, na hora — só os CADASTRADOS: texto livre
     ("terça às 10h, se tiver") não vira turma, e a secretaria tinha de
     adivinhar. Sem horário aberto (ou sem resposta do servidor), o envio
     fica travado e a pessoa é mandada para a conversa, em vez de preencher
     a ficha inteira para descobrir no fim que não dá. */
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function semHorario(texto) {
    selTurma.innerHTML = `<option value="">${esc(texto)}</option>`;
    selTurma.disabled = true;
    botao.disabled = true;
    const aviso = $("#mat-sem-turma");
    aviso.innerHTML = `${esc(texto)}. Fale com a academia pelo <a href="https://wa.me/${WHATSAPP_NUMBER}" target="_blank" rel="noopener">WhatsApp</a> para ver as vagas.`;
    aviso.hidden = false;
  }
  fetch("/api/publico/turmas", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ turmas, dias }) => {
      if (!turmas || !turmas.length) return semHorario("Nenhum horário aberto para matrícula online no momento");
      selTurma.innerHTML = '<option value="">Selecione o horário…</option>' +
        turmas.map((t) => `<option value="${Number(t.id)}">${esc(t.rotulo)}</option>`).join("");
      if (dias) { const p = $("#mat-dias"); p.textContent = `Aulas: ${dias}.`; p.hidden = false; }
    })
    .catch(() => semHorario("Não foi possível carregar os horários agora"));

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
  const fone = (v) => {
    const d = soDig(v).slice(0, 11);
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(d.length > 10 ? /(\d{5})(\d{1,4})$/ : /(\d{4})(\d{1,4})$/, "$1-$2");
  };
  ["#m-whats", "#m-fone2", "#m-r-fone", "#m-r-ftrab"].forEach((s) => mascara($(s), fone));

  /* Dígito verificador do CPF: pega o erro de digitação aqui, com o dedo
     ainda no campo, e não depois de a pessoa apertar enviar. */
  const cpfOk = (v) => {
    const d = soDig(v);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = (n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  };
  ["#m-cpf", "#m-r-cpf"].forEach((s) => {
    const el = $(s);
    el.addEventListener("input", () => el.setCustomValidity(""));
    el.addEventListener("blur", () => el.setCustomValidity(el.value && !cpfOk(el.value) ? "CPF inválido" : ""));
  });

  /* ------------------------------------------------------- CEP → endereço
     (1.28.0) O mesmo conforto que o painel ganhou na 1.26.0, agora para quem
     se matricula pelo site: ao completar os 8 dígitos, o servidor consulta o
     CEP e a tela preenche rua, bairro, cidade e estado, e salta para o número.
     Quem pergunta é o SERVIDOR (/api/publico/cep) — a página não fala com
     serviço de terceiro, e nenhum deles fica sabendo que alguém está
     preenchendo uma matrícula aqui.

     Só o que VEIO é escrito: CEP de cidade pequena não tem rua, e apagar o que
     a pessoa digitou por causa de uma resposta vazia seria perder trabalho.
     Número e complemento nunca são tocados. Se o CEP mudar enquanto a resposta
     viaja, a resposta velha é descartada — preencher o endereço do CEP
     anterior é o pior erro, porque parece certo. */
  const cepEl = $("#m-cep");
  const cepAviso = $("#mat-cep-aviso");
  const cepPadrao = cepAviso ? cepAviso.textContent : "";
  let cepConsultado = "";
  const cepPreencheu = { logradouro: "", bairro: "", cidade: "" };
  const avisarCep = (msg) => { if (cepAviso) cepAviso.textContent = msg || cepPadrao; };
  if (cepEl) cepEl.addEventListener("input", async () => {
    const cep = soDig(cepEl.value);
    if (cep.length < 8) { cepConsultado = ""; avisarCep(""); return; }
    if (cep === cepConsultado) return;
    cepConsultado = cep;
    avisarCep("Buscando o endereço deste CEP…");
    try {
      const resp = await fetch(`/api/publico/cep/${cep}`, { headers: { Accept: "application/json" } });
      const r = await resp.json().catch(() => ({}));
      if (soDig(cepEl.value) !== cep) return;
      if (!resp.ok) throw new Error(r.error || "Não foi possível consultar o CEP.");
      for (const nome of ["logradouro", "bairro", "cidade"]) {
        const campoEl = $(`#m-${nome === "logradouro" ? "rua" : nome === "bairro" ? "bairro" : "cidade"}`);
        if (!campoEl) continue;
        if (r[nome]) campoEl.value = r[nome];
        else if (cepPreencheu[nome] && campoEl.value === cepPreencheu[nome]) campoEl.value = "";
        cepPreencheu[nome] = r[nome] || "";
      }
      if (r.uf) $("#m-uf").value = r.uf;
      avisarCep(r.logradouro ? "Endereço preenchido — confira e complete o número."
                             : "Este CEP é da cidade inteira: preencha a rua e o bairro.");
      const proximo = $(r.logradouro ? "#m-num" : "#m-rua");
      if (proximo) proximo.focus();
    } catch (err) {
      if (soDig(cepEl.value) !== cep) return;
      /* Deixa tentar de novo: apagar e redigitar o último dígito repete a
         consulta — útil quando o serviço estava fora do ar. O endereço
         continua podendo ser digitado à mão, e o envio não depende disto. */
      cepConsultado = "";
      avisarCep((err.message || "Não foi possível consultar o CEP.") + " Pode digitar o endereço à mão.");
    }
  });

  /* ------------------------------------------------ copiar a chave Pix
     (1.29.0) Digitar 14 números de um CNPJ no aplicativo do banco é onde
     a pessoa erra — e Pix para chave errada não volta sozinho. O botão copia
     só os NÚMEROS, que é o formato que todo aplicativo aceita.

     Sem a API de área de transferência (navegador antigo, página fora de
     HTTPS), o texto da chave é SELECIONADO: o toque seguinte já é "copiar"
     no menu do celular. Falhar em silêncio deixaria a pessoa colando o que
     estava antes na área de transferência. */
  document.querySelectorAll(".mat-pix__copiar").forEach((bt) => {
    const rotulo = bt.textContent;
    bt.addEventListener("click", async () => {
      const chave = bt.dataset.copiar || "";
      try {
        await navigator.clipboard.writeText(chave);
        bt.textContent = "Chave copiada ✓";
        bt.classList.add("copiado");
        setTimeout(() => { bt.textContent = rotulo; bt.classList.remove("copiado"); }, 2500);
      } catch {
        const alvo = bt.parentElement.querySelector(".mat-pix__chave");
        if (alvo) {
          const faixa = document.createRange(); faixa.selectNodeContents(alvo);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(faixa);
        }
        bt.textContent = "Chave selecionada — copie";
        setTimeout(() => { bt.textContent = rotulo; }, 3500);
      }
    });
  });

  /* Nome do arquivo escolhido, embaixo do campo. Num celular, o seletor de
     arquivos some sem dizer o que ficou selecionado, e a pessoa não sabe se o
     toque funcionou. */
  const TETO_ARQUIVO = 4 * 1024 * 1024;
  function ligarArquivo(campoId, saidaId) {
    const campo = $(campoId), saida = $(saidaId);
    if (!campo || !saida) return;
    campo.addEventListener("change", () => {
      const arq = campo.files[0];
      campo.setCustomValidity("");
      if (!arq) { saida.hidden = true; return; }
      saida.textContent = `${arq.name} · ${(arq.size / 1024 / 1024).toFixed(1)} MB`;
      saida.hidden = false;
      /* O teto é conferido aqui e de novo no servidor. Aqui é conforto: dizer
         "grande demais" agora é melhor do que depois de um envio que demorou. */
      if (arq.size > TETO_ARQUIVO) campo.setCustomValidity("Arquivo grande demais (máx. 4 MB).");
    });
  }
  ligarArquivo("#m-foto", "#mat-foto-nome");
  ligarArquivo("#m-comprovante", "#mat-comp-nome");

  /* Imagem redesenhada num canvas: menor, sem EXIF e sempre JPEG. Lê por
     FileReader (data:) porque é o mesmo formato que o servidor espera. */
  function reduzirFoto(arq, max = 1024, qualidade = 0.85) {
    return new Promise((ok, falha) => {
      const leitor = new FileReader();
      leitor.onerror = () => falha(new Error("Não foi possível ler a foto."));
      leitor.onload = () => {
        const img = new Image();
        img.onerror = () => falha(new Error("A foto parece estar corrompida. Tente outra."));
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL("image/jpeg", qualidade));
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arq);
    });
  }

  const lerCru = (arq) => new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
    leitor.onload = () => ok(leitor.result);
    leitor.readAsDataURL(arq);
  });

  function mostrarErro(texto, alvo) {
    erro.textContent = texto;
    erro.hidden = false;
    const foco = alvo || erro;
    foco.scrollIntoView({ behavior: "smooth", block: "center" });
    if (alvo) setTimeout(() => alvo.focus({ preventScroll: true }), 350);
  }

  let enviando = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (enviando) return;
    erro.hidden = true;
    ["#m-cpf", "#m-r-cpf"].forEach((s) => {
      const el = $(s);
      el.setCustomValidity(el.value && !cpfOk(el.value) ? "CPF inválido" : "");
    });

    /* `reportValidity` só aponta o primeiro campo. A mensagem própria diz
       QUANTOS faltam e leva até o primeiro — numa ficha longa, sair rolando
       atrás do campo vermelho é o que faz a pessoa desistir. */
    if (!form.checkValidity()) {
      const faltando = [...form.querySelectorAll(":invalid")].filter((el) => !el.disabled && el.tagName !== "FIELDSET");
      const primeiro = faltando[0];
      const cpfRuim = faltando.find((el) => el.validationMessage === "CPF inválido");
      mostrarErro(cpfRuim ? "O CPF não confere. Verifique os números."
        : faltando.length === 1 ? "Falta preencher um campo obrigatório."
        : `Faltam ${faltando.length} campos obrigatórios.`, cpfRuim || primeiro);
      return;
    }

    const d = Object.fromEntries(new FormData(form).entries());
    /* FormData devolve OBJETO de arquivo nestes dois campos, e JSON.stringify
       transformaria cada um num "{}" vazio — a ficha chegaria sem documento e
       sem erro nenhum. Eles saem daqui e voltam como data URL, mais abaixo. */
    delete d.foto; delete d.comprovante;
    const menor = (idadeEm(d.nascimento) ?? 99) < 18;
    /* O que não vale para a idade não viaja: CPF de adulto escondido num
       cadastro de criança (ou o contrário) iria para o banco sem ninguém ver. */
    const soDoOutro = menor ? ["cpf", "rg", "rg_emissor", "estado_civil"]
      : ["resp_nome", "resp_cpf", "resp_rg", "resp_rg_emissor", "resp_nascimento", "resp_fone",
         "resp_estado_civil", "resp_profissao", "resp_nacionalidade", "resp_end_trabalho", "resp_fone_trabalho"];
    soDoOutro.forEach((k) => delete d[k]);
    d.aceite_termos = Boolean(d.t1 && d.t2 && d.t3);
    d.aceite_dados = Boolean(d.aceite_dados);
    delete d.t1; delete d.t2; delete d.t3;

    enviando = true;
    botao.disabled = true;
    const rotulo = botao.textContent;
    botao.textContent = "Enviando…";
    try {
      /* Preparar os arquivos ANTES do pedido: se a foto estiver corrompida, a
         pessoa descobre agora, com tudo ainda preenchido na tela. */
      const arqFoto = $("#m-foto").files[0];
      const arqComp = $("#m-comprovante").files[0];
      if (!arqFoto) { mostrarErro("Escolha a foto do aluno.", $("#m-foto")); return; }
      if (!arqComp) { mostrarErro("Escolha o comprovante de pagamento.", $("#m-comprovante")); return; }
      d.foto = await reduzirFoto(arqFoto);
      d.comprovante = arqComp.type === "application/pdf" ? await lerCru(arqComp) : await reduzirFoto(arqComp, 1600, 0.9);
      botao.textContent = "Enviando documentos…";
      const r = await fetch("/api/publico/matricula", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(d),
      });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) {
        const lista = Array.isArray(resp.erros) && resp.erros.length > 1 ? " " + resp.erros.slice(1).join(" ") : "";
        mostrarErro((resp.error || "Não foi possível enviar agora.") + lista);
        return;
      }
      const ok = $("#mat-ok");
      const msg = `Olá! Acabei de enviar pelo site a matrícula de *${d.nome.trim()}*, com a foto e o comprovante.`;
      $("#mat-ok-zap").href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
      form.hidden = true;
      ok.hidden = false;
      ok.scrollIntoView({ behavior: "smooth", block: "center" });
      ok.focus({ preventScroll: true });
    } catch {
      /* Sem rede não se perde nada: o formulário continua preenchido. */
      mostrarErro("Sem conexão com a academia agora. Seus dados continuam aqui — tente enviar de novo em instantes.");
    } finally {
      enviando = false;
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  });
}

function initConsent() {
  linksRodape();
  const escolha = lerConsent();
  if (!escolha) montarBanner();
  else if (escolha === "aceito") carregarMedicao();
}

function initYear() { const y = $("#year"); if (y) y.textContent = new Date().getFullYear(); }

function boot() { initHeader(); initMobileNav(); initHeaderSearch(); initReveal(); initForm(); initFab(); initYear(); initSearchResults(); initMatricula(); initConsent(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
