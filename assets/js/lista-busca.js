/* ==========================================================================
   lista-busca.js — lista de opções com BUSCA e várias escolhas (1.35.0)

   Usada na matrícula do site e na ficha do painel para "questões de saúde" e
   "transtornos". Um <select multiple> nativo não serve: não tem busca, e no
   computador exige Ctrl+clique, que ninguém sabe. Aqui se digita "asm" e
   aparece "Asma"; cada escolha vira uma etiqueta com ×.

   Script CLÁSSICO (window.ListaBusca), e não módulo: o painel não carrega
   módulos, e o site o lê antes do main.js. Um arquivo só para os dois — as
   duas telas não podem divergir no jeito de marcar.

   Regras:
     · "Nenhuma"/"Nenhum" é exclusiva: marcá-la limpa as outras, e marcar
       outra tira o "Nenhuma";
     · "Outra (especificar)" abre um campo de texto, obrigatório enquanto
       marcada; o valor vai como "Outra: <texto>";
     · o valor vai num <input type="hidden" name="…">, as opções separadas
       por "; " — é o que o FormData das duas telas já envia;
     · obrigatória e vazia, a busca fica :invalid com a mensagem própria, e o
       aviso "faltam N campos" do formulário a encontra como qualquer campo.

   Teclado: ↓/↑ andam na lista, Enter marca/desmarca, Esc fecha, Backspace
   com a busca vazia tira a última etiqueta.
   ========================================================================== */
(function () {
  "use strict";
  const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let seq = 0;

  function montar(caixa, cfg) {
    const id = "lb" + (++seq);
    const { nome, opcoes, nenhuma, outra, prefixo } = cfg;
    let obrigatoria = !!cfg.obrigatoria;
    const msgVazia = cfg.mensagem || "Escolha uma opção da lista.";
    caixa.classList.add("lb");
    caixa.innerHTML = `
      <div class="lb__caixa">
        <ul class="lb__chips" aria-label="Escolhidas"></ul>
        <input class="lb__busca" type="text" id="${esc(cfg.idBusca || id + "-busca")}" role="combobox" autocomplete="off"
          aria-expanded="false" aria-controls="${id}-lista" aria-autocomplete="list"
          placeholder="${esc(cfg.placeholder || "Digite ou toque para escolher")}">
      </div>
      <ul class="lb__lista" id="${id}-lista" role="listbox" aria-multiselectable="true" hidden></ul>
      <input class="lb__outra" type="text" maxlength="120" hidden placeholder="${esc(cfg.placeholderOutra || "Qual? Descreva")}" aria-label="Descreva a opção “${esc(outra)}”">
      <input type="hidden" name="${esc(nome)}">`;
    const chips = caixa.querySelector(".lb__chips");
    const dicaVazia = cfg.placeholder || "Digite ou toque para escolher";
    const busca = caixa.querySelector(".lb__busca");
    const lista = caixa.querySelector(".lb__lista");
    const campoOutra = caixa.querySelector(".lb__outra");
    const oculto = caixa.querySelector('input[type="hidden"]');
    const marcadas = new Set();
    let ativo = -1, visiveis = [];

    function valor() {
      return opcoes.filter((o) => marcadas.has(o)).map((o) => (o === outra ? prefixo + campoOutra.value.replace(/;/g, ",").trim() : o)).join("; ");
    }
    function validar() {
      busca.setCustomValidity(obrigatoria && !marcadas.size ? msgVazia : "");
      campoOutra.required = obrigatoria && marcadas.has(outra);   // fora do obrigatório (bloco escondido), não trava o envio
      /* O vermelho só aparece depois que a pessoa passou pelo campo (ou tentou
         enviar): ficha nova toda vermelha ao abrir só assusta. */
      if (marcadas.size) caixa.classList.remove("lb--erro");
      busca.setAttribute("aria-invalid", String(caixa.classList.contains("lb--erro")));
    }
    function sincronizar() {
      oculto.value = valor();
      validar();
      oculto.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function pintarChips() {
      chips.innerHTML = opcoes.filter((o) => marcadas.has(o)).map((o) => `<li class="lb__chip${o === nenhuma ? " lb__chip--nenhuma" : ""}">
          <span>${esc(o === outra ? (campoOutra.value.trim() ? prefixo + campoOutra.value.trim() : o) : o)}</span>
          <button type="button" aria-label="Tirar ${esc(o)}" data-tirar="${esc(o)}">×</button></li>`).join("");
      campoOutra.hidden = !marcadas.has(outra);
      /* com etiqueta na caixa, a dica longa não cabe ao lado dela no celular */
      busca.placeholder = marcadas.size ? "Adicionar outra…" : dicaVazia;
    }
    function pintarLista() {
      const q = semAcento(busca.value.trim());
      visiveis = opcoes.filter((o) => !q || semAcento(o).includes(q));
      if (ativo >= visiveis.length) ativo = visiveis.length - 1;
      lista.innerHTML = visiveis.length
        ? visiveis.map((o, i) => `<li role="option" id="${id}-o${i}" data-op="${esc(o)}" aria-selected="${marcadas.has(o)}"
            class="lb__op${i === ativo ? " lb__op--ativa" : ""}${o === nenhuma ? " lb__op--nenhuma" : ""}">${esc(o)}</li>`).join("")
        : '<li class="lb__vazio">Nada encontrado. Use “' + esc(outra) + '”.</li>';
      busca.setAttribute("aria-activedescendant", ativo >= 0 ? `${id}-o${ativo}` : "");
      const a = lista.querySelector(".lb__op--ativa");
      if (a) a.scrollIntoView({ block: "nearest" });
    }
    function abrir() { if (!lista.hidden) return; lista.hidden = false; busca.setAttribute("aria-expanded", "true"); ativo = -1; pintarLista(); }
    function fechar() { lista.hidden = true; busca.setAttribute("aria-expanded", "false"); ativo = -1; }
    function alternar(o) {
      if (marcadas.has(o)) marcadas.delete(o);
      else {
        if (o === nenhuma) marcadas.clear();
        else marcadas.delete(nenhuma);
        marcadas.add(o);
      }
      busca.value = "";
      pintarChips(); pintarLista(); sincronizar();
      if (o === outra && marcadas.has(outra)) { fechar(); campoOutra.focus(); }
      else if (o === nenhuma && marcadas.has(nenhuma)) fechar();
    }

    busca.addEventListener("focus", abrir);
    busca.addEventListener("click", abrir);
    busca.addEventListener("input", () => { abrir(); ativo = 0; pintarLista(); });
    busca.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); abrir(); ativo = Math.min(visiveis.length - 1, ativo + 1); pintarLista(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); ativo = Math.max(0, ativo - 1); pintarLista(); }
      else if (e.key === "Enter") { if (!lista.hidden && visiveis[ativo]) { e.preventDefault(); alternar(visiveis[ativo]); } }
      else if (e.key === "Escape") { if (!lista.hidden) { e.preventDefault(); fechar(); } }
      else if (e.key === "Backspace" && !busca.value && marcadas.size) {
        const ultima = opcoes.filter((o) => marcadas.has(o)).pop();
        marcadas.delete(ultima); pintarChips(); pintarLista(); sincronizar();
      }
    });
    /* mousedown, e não click: o clique tiraria o foco da busca antes, e a
       lista fecharia antes de a escolha acontecer. */
    lista.addEventListener("mousedown", (e) => {
      const li = e.target.closest("[data-op]");
      if (!li) return;
      e.preventDefault();
      alternar(li.dataset.op);
    });
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tirar]");
      if (!b) return;
      marcadas.delete(b.dataset.tirar);
      pintarChips(); pintarLista(); sincronizar();
      busca.focus();
    });
    campoOutra.addEventListener("input", () => { pintarChips(); sincronizar(); });
    document.addEventListener("mousedown", (e) => { if (!caixa.contains(e.target)) fechar(); });
    caixa.addEventListener("focusout", () => setTimeout(() => {
      if (caixa.contains(document.activeElement)) return;
      fechar();
      if (obrigatoria && !marcadas.size) { caixa.classList.add("lb--erro"); validar(); }
    }, 0));
    busca.addEventListener("invalid", () => { caixa.classList.add("lb--erro"); busca.setAttribute("aria-invalid", "true"); });

    /* Valor inicial (ficha que já tem a resposta): "Asma; Outra: x". */
    function definir(texto) {
      marcadas.clear(); campoOutra.value = "";
      String(texto || "").split(";").map((x) => x.trim()).filter(Boolean).forEach((item) => {
        if (opcoes.includes(item) && item !== outra) marcadas.add(item);
        else if (item.startsWith(prefixo)) { marcadas.add(outra); campoOutra.value = item.slice(prefixo.length); }
      });
      pintarChips(); sincronizar();
    }
    definir(cfg.valor);
    return {
      valor, definir, busca,
      obrigatoria(sim) { obrigatoria = !!sim; validar(); },
    };
  }
  window.ListaBusca = { montar };
})();
