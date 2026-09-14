/* ==========================================================================
   admin/gestao.js — as telas da gestão da academia

   Usa o que o painel já tem (api, toast, escA, editorRico, edSync) e escuta o
   aviso "painel" para montar cada tela na hora em que ela é aberta.

   Nada aqui é regra de negócio: a tela esconde o botão de apagar um aluno com
   contrato, mas quem impede é a rota (gestao/rotas.js). A tela serve para não
   OFERECER o que não vai funcionar — não para garantir.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const e = (s) => escA(s).replace(/>/g, "&gt;");
  const G = { resumo: null, filtro: "", busca: "", turmas: [], atividades: [], professores: [], ag: null };

  const DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
    "setembro", "outubro", "novembro", "dezembro"];
  const dataBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const idadeDe = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return null;
    const h = new Date(); let a = h.getFullYear() - +m[1];
    if (h.getMonth() + 1 < +m[2] || (h.getMonth() + 1 === +m[2] && h.getDate() < +m[3])) a--;
    return a >= 0 && a < 130 ? a : null;
  };

  /* ------------------------------------------------------------ resumo */
  async function resumo() {
    G.resumo = await api("/api/gestao/resumo");
    const n = G.resumo.pendentes || 0;
    for (const b of [$("#badge-pendentes"), $("#chip-pend")]) if (b) { b.hidden = !n; b.textContent = n; }
    return G.resumo;
  }
  async function carregarTurmasEAtividades() {
    const [t, a, p] = await Promise.all([api("/api/gestao/turmas"), api("/api/gestao/atividades"), api("/api/gestao/professores")]);
    G.turmas = t.turmas; G.atividades = a.atividades; G.professores = p.professores;
  }
  /* As opções de professor: os ATIVOS, mais o que já está escolhido mesmo
     inativo — senão abrir e salvar sem mexer trocaria o professor calado. */
  const opcoesProfessor = (atual, vazio) => `<option value="">${e(vazio)}</option>` + G.professores
    .filter((p) => p.ativo || p.id === atual)
    .map((p) => `<option value="${p.id}"${p.id === atual ? " selected" : ""}>${e(p.nome)}${p.ativo ? "" : " (inativo)"}</option>`).join("");

  const TELAS = {
    "g-alunos": telaAlunos, "g-atividades": telaAtividades, "g-turmas": telaTurmas,
    "g-agenda": telaAgenda, "g-indicadores": telaIndicadores, "g-professores": telaProfessores, "g-relatorios": telaRelatorios, "g-contrato": telaContrato,
    "g-config": telaConfig, "g-usuarios": telaUsuarios, "g-auditoria": telaAuditoria, "g-sobre": telaSobre,
  };
  document.addEventListener("painel", (ev) => {
    const f = TELAS[ev.detail];
    if (f) f().catch((err) => toast(err.message, true));
  });

  /* ------------------------------------------------------------ diálogos */
  function abrir(dlg, html) {
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const primeiro = $("input:not([type=hidden]):not([disabled]),select,textarea", dlg);
    if (primeiro && !dlg.dataset.semFoco) primeiro.focus();
  }
  document.addEventListener("click", (ev) => {
    const f = ev.target.closest("[data-fechar]");
    if (f) f.closest("dialog").close();
  });
  /* Clicar no fundo escurecido fecha — mas só nos diálogos pequenos. No
     cadastro do aluno um clique distraído fora jogaria fora o formulário. */
  $("#dlg-pequeno").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });

  const cab = (titulo) => `<div class="g-dlg-cab"><h2>${e(titulo)}</h2><button type="button" class="g-fechar" data-fechar aria-label="Fechar">×</button></div>`;
  const imprimirEm = (url) => window.open(url, "_blank", "noopener");

  /* Dinheiro na tela: "R$ 1.234,56". O servidor aceita esse formato como
     está (paraCentavos tira o "R$" e os pontos de milhar). */
  const moeda = (centavos) => "R$ " + (Number(centavos || 0) / 100)
    .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* Máscaras: só ajudam a digitar; quem valida é o servidor.
     A de moeda enche da direita para a esquerda, como caixa de banco: digitar
     1-1-0-0-0 dá R$ 110,00. Não há vírgula para errar de lugar. */
  function mascarar(raiz) {
    $$("[data-mask]", raiz).forEach((el) => el.addEventListener("input", () => {
      const d = el.value.replace(/\D/g, "");
      if (el.dataset.mask === "cpf") el.value = d.slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
      if (el.dataset.mask === "cep") el.value = d.slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
      if (el.dataset.mask === "fone") el.value = d.slice(0, 11).replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d)(\d{4})$/, "$1-$2");
      if (el.dataset.mask === "moeda") el.value = d ? moeda(Number(d.replace(/^0+/, "").slice(0, 10) || 0)) : "";
    }));
  }

  /* ==========================================================================
     ALUNOS
     ========================================================================== */
  async function telaAlunos() {
    const P = $("#p-g-alunos");
    if (!P.dataset.pronto) {
      P.innerHTML = `
        <div class="topbar"><h1>Alunos</h1><button class="btn btn-mint" data-acao="novo-aluno">+ Novo aluno</button></div>
        <div class="g-barra">
          <input class="g-busca" type="search" id="g-busca" placeholder="Buscar por nome, código ou CPF…" autocomplete="off">
          <div class="g-chips" id="g-filtros">
            <button class="g-chip on" data-filtro="">Todos</button>
            <button class="g-chip" data-filtro="ativo">Ativos</button>
            <button class="g-chip" data-filtro="inativo">Inativos</button>
            <button class="g-chip" data-filtro="pendente">Pré-matrículas do site <span class="navbadge" id="chip-pend" hidden></span></button>
          </div>
        </div>
        <div class="g-tabela-caixa" id="g-lista-alunos"><p class="g-vazio">Carregando…</p></div>
        <div id="g-pag-alunos"></div>`;
      P.dataset.pronto = "1";
      let t;
      $("#g-busca").addEventListener("input", (ev) => {
        clearTimeout(t); t = setTimeout(() => { G.busca = ev.target.value.trim(); G.pagAlunos = 1; listarAlunos(); }, 250);
      });
      $("#g-filtros").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-filtro]"); if (!b) return;
        $$("#g-filtros .g-chip").forEach((c) => c.classList.toggle("on", c === b));
        G.filtro = b.dataset.filtro; G.pagAlunos = 1; listarAlunos();
      });
      P.addEventListener("click", acaoAluno);
    }
    await Promise.all([resumo(), carregarTurmasEAtividades()]);
    await listarAlunos();
  }

  /* A lista de alunos vem em PÁGINAS do servidor: a academia tem milhares
     de alunos no histórico. Trocar filtro ou busca volta para a página 1. */
  async function listarAlunos() {
    const por = porPaginaSalvo("alunos");
    const qs = new URLSearchParams({ status: G.filtro, q: G.busca, pagina: G.pagAlunos || 1, por });
    const r = await api(`/api/gestao/alunos?${qs}`);
    const { alunos } = r;
    G.pagAlunos = r.pagina;
    const caixa = $("#g-lista-alunos");
    barraPaginas($("#g-pag-alunos"), { total: r.total, pagina: r.pagina, por: r.por, ir: (pagina, n) => {
      if (n !== por) salvarPorPagina("alunos", n);
      G.pagAlunos = pagina; listarAlunos().catch((err) => toast(err.message, true));
    } });
    if (!alunos.length) {
      caixa.innerHTML = `<p class="g-vazio">${G.busca || G.filtro ? "Nenhum aluno encontrado com esse filtro." : "Nenhum aluno cadastrado ainda. Use “+ Novo aluno” ou aguarde as matrículas do site."}</p>`;
      return;
    }
    caixa.innerHTML = `<table class="g-tabela g-alunos" data-paginacao="servidor">
      <thead><tr><th>Código</th><th>Nome</th><th>Idade</th><th>Turma</th><th>Telefone</th><th>Status</th><th></th></tr></thead>
      <tbody>${alunos.map((a) => `<tr>
        <td class="cod">${a.codigo_fmt || '<span class="fraco">—</span>'}</td>
        <td><b>${e(a.nome)}</b>${a.origem === "site" && a.status === "pendente" ? ' <span class="selo selo--site">site</span>' : ""}
          ${a.menor && a.resp_nome ? `<br><small class="fraco">resp.: ${e(a.resp_nome)}</small>` : ""}</td>
        <td>${a.idade ?? ""}</td>
        <td class="nw">${e(a.turma || "")}</td>
        <td class="nw">${e(a.fone1 || a.resp_fone || "")}</td>
        <td><span class="selo selo--${a.status}">${a.status === "pendente" ? "pré-matrícula" : a.status}</span></td>
        <td class="acoes">
          ${a.status === "pendente"
            ? `<button class="btn btn-mint btn-sm" data-acao="editar" data-id="${a.id}">Revisar</button>`
            : `<button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${a.id}">Editar</button>
               <button class="btn btn-ghost btn-sm" data-acao="ficha" data-id="${a.id}">Ficha</button>
               <button class="btn btn-ghost btn-sm" data-acao="contratos" data-id="${a.id}" data-nome="${e(a.nome)}">Contrato${a.contratos ? ` (${a.contratos})` : ""}</button>`}
        </td></tr>`).join("")}</tbody></table>`;
  }

  function acaoAluno(ev) {
    const b = ev.target.closest("[data-acao]"); if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.acao === "novo-aluno") formAluno(null);
    if (b.dataset.acao === "editar") formAluno(id);
    if (b.dataset.acao === "ficha") imprimirEm(`/admin/imprimir/ficha/${id}`);
    if (b.dataset.acao === "contratos") abrirContratos(id, b.dataset.nome);
  }

  /* ------------------------------------------------ o formulário do aluno */
  async function formAluno(id) {
    if (!G.resumo) await resumo();
    /* Sempre de novo: a ocupação de cada turma (o "10/12 vagas" da grade)
       muda a cada aluno salvo. */
    await carregarTurmasEAtividades();
    const a = id ? (await api(`/api/gestao/alunos/${id}`)).aluno : { status: "ativo", nacionalidade: "Brasileira", resp_nacionalidade: "Brasileira", cidade: "Caruaru", uf: "PE" };
    const pend = a.status === "pendente";
    const R = G.resumo;
    const opcoes = (lista, atual, vazio = "Selecione…") => `<option value="">${vazio}</option>` +
      lista.map((o) => `<option${o === atual ? " selected" : ""}>${e(o)}</option>`).join("");
    const campo = (nome, rotulo, cls, extra = "") =>
      `<div class="${cls}"><label for="fa-${nome}"${/obrig/.test(extra) ? ' class="obrig"' : ""}>${rotulo}</label>
       <input id="fa-${nome}" name="${nome}" value="${e(a[nome] ?? "")}" ${extra.replace("obrig", "")}></div>`;

    /* A grade de atividades, como a aba "Atividades" do sistema antigo:
       atividade, os dias marcados (Seg a Sáb) e o horário. Domingo só aparece
       se a academia abrir nele ou se alguém já tiver aula nele. */
    const diasPadrao = R.dias_aula || [2, 3, 5];
    const diasCols = diasPadrao.includes(0) || (a.matriculas || []).some((m) => m.dias.includes(0))
      ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];

    let origem = "";
    if (a.origem === "site") {
      let c = {}; try { c = JSON.parse(a.consentimento || "{}"); } catch {}
      origem = `<p class="gf-nota">Chegou pelo formulário do site em ${e(dataBR(a.criado_em))}.
        ${c.dados ? `Autorização de uso dos dados dada por ${e(c.por || "")}.` : ""}</p>`;
    }

    abrir($("#dlg-aluno"), `<form id="form-aluno" novalidate>${cab(id ? (pend ? "Revisar pré-matrícula" : `Aluno ${a.codigo_fmt}`) : "Novo aluno")}
    <div class="g-dlg-corpo">
      ${origem}
      ${pend ? `<p class="gf-nota gf-nota--alerta">Pré-matrícula enviada pelo site. Confira os dados, escolha a turma e a mensalidade,
         e clique em <b>Efetivar matrícula</b> — só aí o aluno recebe o código.</p>` : ""}
      <div class="gf-topo">
        <div>
          <p class="gf-sec">Matrícula</p>
          <div class="gf">
            <div class="c3"><label for="fa-codigo">Código</label>
              <input id="fa-codigo" name="codigo" inputmode="numeric" value="${e(a.codigo ?? "")}"
                ${pend ? 'disabled placeholder="ao efetivar"' : `placeholder="automático: ${String(R.proximo_codigo).padStart(6, "0")}"`}></div>
            <div class="c3"><label for="fa-status">Status</label>
              ${pend ? `<input value="Pré-matrícula" disabled>` : `<select id="fa-status" name="status">
                <option value="ativo"${a.status === "ativo" ? " selected" : ""}>Ativo</option>
                <option value="inativo"${a.status === "inativo" ? " selected" : ""}>Inativo</option></select>`}</div>
            ${campo("data_matricula", "Data da matrícula", "c3", 'type="date"')}
            <div class="c3"><label for="fa-total">Mensalidade total</label>
              <input id="fa-total" value="${a.mensalidade ? moeda(a.mensalidade) : ""}" disabled title="A soma das mensalidades das atividades, lá embaixo"></div>
          </div>
        </div>
        <div class="gf-foto">
          <div class="quadro" id="fa-foto">${a.foto_id ? `<img src="/admin/arquivo/${a.foto_id}" alt="Foto do aluno">` : "sem foto"}</div>
          ${id ? `<input type="file" id="fa-foto-arq" accept="image/jpeg,image/png,image/webp" hidden>
            <button type="button" class="btn btn-ghost btn-sm" data-foto="enviar">${a.foto_id ? "Trocar foto" : "Enviar foto"}</button>
            ${a.foto_id ? '<button type="button" class="btn btn-danger btn-sm" data-foto="remover">Remover</button>' : ""}`
            : '<small class="fraco" style="text-align:center">A foto entra depois de salvar.</small>'}
        </div>
      </div>

      <p class="gf-sec">Dados do aluno</p>
      <div class="gf">
        ${campo("nome", "Nome completo", "c8", "obrig maxlength=120")}
        <div class="c4"><label for="fa-sexo">Sexo</label><select id="fa-sexo" name="sexo">${opcoes(R.sexos, a.sexo)}</select></div>
        ${campo("nascimento", "Data de nascimento", "c3", 'type="date"')}
        <div class="c2"><label>Idade</label><input id="fa-idade" value="${a.idade ?? ""}" disabled></div>
        <div class="c3"><label for="fa-estado_civil">Estado civil</label><select id="fa-estado_civil" name="estado_civil">${opcoes(R.estados_civis, a.estado_civil)}</select></div>
        ${campo("nacionalidade", "Nacionalidade", "c4")}
        ${campo("rg", "RG", "c3")}
        ${campo("rg_emissor", "Órgão emissor", "c2", 'placeholder="SDS/PE"')}
        ${campo("cpf", "CPF", "c3", 'data-mask="cpf" inputmode="numeric"')}
        ${campo("profissao", "Profissão", "c4", 'placeholder="Estudante"')}
        ${campo("email", "E-mail", "c8", 'type="email"')}
      </div>

      <p class="gf-sec">Endereço</p>
      <div class="gf">
        ${campo("logradouro", "Rua / avenida", "c6")}
        ${campo("numero", "Número", "c2")}
        ${campo("complemento", "Complemento", "c4")}
        ${campo("bairro", "Bairro", "c4")}
        ${campo("cidade", "Cidade", "c4")}
        <div class="c2"><label for="fa-uf">UF</label><select id="fa-uf" name="uf">${opcoes(R.ufs, a.uf, "—")}</select></div>
        ${campo("cep", "CEP", "c2", 'data-mask="cep" inputmode="numeric"')}
      </div>

      <p class="gf-sec">Contato e filiação</p>
      <div class="gf">
        ${campo("fone1", "Fone 1 (WhatsApp)", "c4", 'data-mask="fone" inputmode="tel"')}
        ${campo("fone2", "Fone 2", "c4", 'data-mask="fone" inputmode="tel"')}
        ${campo("instagram", "Instagram", "c4")}
        ${campo("pai", "Pai", "c6")}
        ${campo("mae", "Mãe", "c6")}
      </div>

      <p class="gf-sec">Responsável</p>
      <p class="gf-nota" id="fa-nota-menor" hidden>Aluno <b>menor de idade</b>: o contrato sai no nome do responsável — preencha nome, RG e CPF dele.</p>
      <div class="gf">
        ${campo("resp_nome", "Nome do responsável", "c6")}
        ${campo("resp_cpf", "CPF", "c3", 'data-mask="cpf" inputmode="numeric"')}
        ${campo("resp_rg", "RG", "c2")}
        ${campo("resp_rg_emissor", "Emissor", "c1")}
        ${campo("resp_nascimento", "Data de nasc.", "c3", 'type="date"')}
        ${campo("resp_fone", "Fone do responsável", "c3", 'data-mask="fone" inputmode="tel"')}
        ${campo("resp_profissao", "Profissão", "c3")}
        <div class="c3"><label for="fa-resp_estado_civil">Estado civil</label><select id="fa-resp_estado_civil" name="resp_estado_civil">${opcoes(R.estados_civis, a.resp_estado_civil)}</select></div>
        ${campo("resp_nacionalidade", "Nacionalidade", "c3")}
        ${campo("resp_end_trabalho", "Endereço do trabalho", "c6")}
        ${campo("resp_fone_trabalho", "Fone do trabalho", "c3", 'data-mask="fone" inputmode="tel"')}
      </div>

      <p class="gf-sec">Observação</p>
      <textarea name="observacao" maxlength="1000" rows="3">${e(a.observacao || "")}</textarea>

      <p class="gf-sec">Atividades</p>
      ${a.origem === "site" && pend ? '<p class="gf-nota">A primeira linha é o horário que a pessoa escolheu no site. Confira os dias e a mensalidade.</p>' : ""}
      ${a.horario_desejado ? `<p class="gf-nota gf-nota--alerta">No site foi escrito: “${e(a.horario_desejado)}” — escolha abaixo o horário correspondente.</p>` : ""}
      <div class="g-tabela-caixa"><table class="g-tabela ativ-grade" data-sem-paginacao>
        <thead><tr><th>Atividade</th>${diasCols.map((d) => `<th class="dia">${DIAS_CURTO[d]}</th>`).join("")}
          <th>Horário</th><th>Professor</th><th>Mensalidade</th><th></th></tr></thead>
        <tbody id="fa-ativ"></tbody></table></div>
      <button type="button" class="btn btn-ghost btn-sm mt" data-la="add-ativ">+ Adicionar atividade</button>
    </div>
    <div class="g-dlg-rodape">
      <div class="esq">
        ${id && !pend ? `<button type="button" class="btn btn-ghost btn-sm" data-la="ficha">Ficha</button>
          <button type="button" class="btn btn-ghost btn-sm" data-la="contratos">Contrato</button>` : ""}
        ${pend ? `<button type="button" class="btn btn-danger btn-sm" data-la="apagar">Apagar</button>` : ""}
      </div>
      <button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>
      <button type="submit" class="btn ${pend ? "btn-ghost" : "btn-navy"}">Salvar</button>
      ${pend ? `<button type="button" class="btn btn-mint" data-la="efetivar">Salvar e efetivar matrícula</button>` : ""}
    </div></form>`);

    const F = $("#form-aluno");
    mascarar(F);
    const nasc = $("#fa-nascimento", F);
    const menorOuNao = () => {
      const i = idadeDe(nasc.value);
      $("#fa-idade", F).value = i ?? "";
      const menor = i !== null && i < 18;
      $("#fa-nota-menor", F).hidden = !menor;
      for (const n of ["resp_nome", "resp_rg", "resp_cpf"]) $(`label[for="fa-${n}"]`, F).classList.toggle("obrig", menor);
    };
    nasc.addEventListener("change", menorOuNao); menorOuNao();

    /* ------------------------------------------------ a grade de atividades
       Atividade → Horário: o horário lista só as turmas daquela atividade
       (e a inativa em que o aluno JÁ está, para não tirá-lo sem ninguém ver).
       Mensalidade vazia recebe a da atividade — vale também ao ABRIR a
       pré-matrícula do site, que chega com a turma e sem valor. */
    const TB = $("#fa-ativ", F);
    const jaNas = new Set((a.matriculas || []).map((m) => m.turma_id));
    const centavos = (v) => Number(String(v || "").replace(/\D/g, "")) || 0;
    const opcAtiv = (atId) => '<option value="">Selecione…</option>' + G.atividades
      .filter((x) => x.ativo || x.id === atId).map((x) => `<option value="${x.id}"${x.id === atId ? " selected" : ""}>${e(x.nome)}</option>`).join("");
    const opcTurma = (atId, turmaId) => {
      const ts = G.turmas.filter((t) => t.atividade_id === atId && (t.ativo || jaNas.has(t.id)));
      return `<option value="">${atId ? (ts.length ? "Horário…" : "nenhuma turma") : "—"}</option>` + ts.map((t) =>
        `<option value="${t.id}"${t.id === turmaId ? " selected" : ""}>${e(t.horario)}${t.horario_fim ? "–" + e(t.horario_fim) : ""}${t.ativo ? "" : " (inativa)"}</option>`).join("");
    };
    const total = () => { $("#fa-total", F).value = moeda($$('[data-c="mens"]', TB).reduce((s, i) => s + centavos(i.value), 0)); };
    /* O professor da linha: "o da turma" (vazio) ou outro do cadastro, só
       para este aluno. A primeira opção diz QUEM é o da turma. */
    function montarProfessor(tr, t) {
      const sel = $('[data-c="prof"]', tr);
      const atual = Number(sel.value || sel.dataset.inicial) || null;
      sel.innerHTML = opcoesProfessor(atual, t ? (t.professor ? `o da turma (${t.professor})` : "o da turma (sem professor)") : "—");
      delete sel.dataset.inicial;
    }
    function atualizarLinha(tr, sugerir) {
      const t = G.turmas.find((x) => x.id === Number($('[data-c="turma"]', tr).value));
      montarProfessor(tr, t);
      /* A vaga: quantos ativos a turma tem e o limite. Passar do limite é
         permitido — o sistema só avisa. */
      const vaga = $('[data-c="vaga"]', tr);
      if (t && t.vagas) {
        /* Quem já é ativo nesta turma já está na conta; quem entra agora
           (ou é pré-matrícula) soma um. */
        const contaEle = a.status === "ativo" && jaNas.has(t.id);
        const depois = t.alunos_ativos + (contaEle ? 0 : 1);
        const aviso = depois <= t.vagas ? "" : contaEle ? " · acima do limite" : " · passará do limite";
        vaga.textContent = `${t.alunos_ativos} de ${t.vagas} ${t.vagas === 1 ? "vaga" : "vagas"}${aviso}`;
        vaga.classList.toggle("alerta", !!aviso);
      } else { vaga.textContent = t ? "sem limite de vagas" : ""; vaga.classList.remove("alerta"); }
      if (sugerir) {
        const at = G.atividades.find((x) => x.id === Number($('[data-c="atividade"]', tr).value));
        const mi = $('[data-c="mens"]', tr);
        if (at && at.mensalidade && !mi.value.trim()) mi.value = moeda(at.mensalidade);
      }
      total();
    }
    function linhaAtividade(m = {}) {
      const turma = m.turma_id ? G.turmas.find((x) => x.id === m.turma_id) : null;
      const atId = m.atividade_id || (turma && turma.atividade_id) || 0;
      const dias = m.dias && m.dias.length ? m.dias : diasPadrao;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><select data-c="atividade" aria-label="Atividade">${opcAtiv(atId)}</select></td>
        ${diasCols.map((d) => `<td class="dia"><input type="checkbox" data-dia="${d}" aria-label="${DIAS_CURTO[d]}"${dias.includes(d) ? " checked" : ""}></td>`).join("")}
        <td><select data-c="turma" aria-label="Horário">${opcTurma(atId, m.turma_id)}</select><small data-c="vaga" class="fraco"></small></td>
        <td><select data-c="prof" aria-label="Professor" data-inicial="${m.professor_id || ""}"></select></td>
        <td><input data-c="mens" data-mask="moeda" inputmode="numeric" placeholder="R$ 0,00" aria-label="Mensalidade"
          value="${m.mensalidade ? moeda(m.mensalidade) : ""}"></td>
        <td><button type="button" class="g-fechar" data-la="rm-ativ" aria-label="Tirar esta atividade" title="Tirar esta atividade">×</button></td>`;
      TB.appendChild(tr);
      mascarar(tr);
      atualizarLinha(tr, !m.mensalidade && !!m.turma_id);
    }
    (a.matriculas && a.matriculas.length ? a.matriculas : [{}]).forEach(linhaAtividade);
    TB.addEventListener("change", (ev) => {
      const tr = ev.target.closest("tr"); if (!tr) return;
      if (ev.target.dataset.c === "atividade") {
        const sel = $('[data-c="turma"]', tr);
        sel.innerHTML = opcTurma(Number(ev.target.value) || 0, 0);
        if (sel.options.length === 2) sel.selectedIndex = 1;   // uma turma só: já escolhe
        atualizarLinha(tr, true);
      }
      if (ev.target.dataset.c === "turma") atualizarLinha(tr, true);
    });
    TB.addEventListener("input", (ev) => { if (ev.target.dataset.c === "mens") total(); });

    const dados = () => {
      const d = Object.fromEntries(new FormData(F).entries());
      if (pend) delete d.codigo;
      const linhas = $$("tr", TB);
      const incompleta = linhas.find((tr) => $('[data-c="atividade"]', tr).value && !$('[data-c="turma"]', tr).value);
      if (incompleta) throw new Error(`Escolha o horário da atividade ${$('[data-c="atividade"]', incompleta).selectedOptions[0].textContent}.`);
      d.matriculas = linhas.filter((tr) => $('[data-c="turma"]', tr).value).map((tr) => ({
        turma_id: Number($('[data-c="turma"]', tr).value),
        dias: $$("[data-dia]:checked", tr).map((c) => Number(c.dataset.dia)),
        professor_id: Number($('[data-c="prof"]', tr).value) || null,
        mensalidade: $('[data-c="mens"]', tr).value,
      }));
      return d;
    };
    /* Confere o que o servidor gravou. Um servidor desatualizado (a tela é
       lida do disco na hora; o servidor, só quando reinicia) responde "ok" e
       descarta as atividades em silêncio — a tela fechava como se tivesse
       salvo. Agora ela diz. */
    const conferir = (d, r) => {
      if (d.matriculas.length && r.matriculas !== d.matriculas.length)
        throw new Error("As atividades NÃO foram gravadas: o servidor parece estar numa versão antiga. Reinicie o servidor e salve de novo.");
      return r;
    };
    const salvar = async () => {
      const d = dados();
      const r = conferir(d, await api(id ? `/api/gestao/alunos/${id}` : "/api/gestao/alunos", id ? "PUT" : "POST", d));
      return { id: id || r.id, avisos: r.avisos || [] };
    };
    /* Turma cheia não impede o cadastro: o aviso vai JUNTO da confirmação,
       e fica mais tempo na tela que um "salvo" comum. */
    const confirmar = (texto, avisos) => avisos.length ? toast(`${texto} ⚠ ${avisos.join(" ")}`, true, 9000) : toast(texto);

    F.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const { id: novoId, avisos } = await salvar();
        confirmar(id ? "Cadastro salvo." : "Aluno cadastrado.", avisos);
        if (!id) { await listarAlunos(); await resumo(); return formAluno(novoId); }   // reabre já com a foto disponível
        $("#dlg-aluno").close(); listarAlunos(); resumo();
      } catch (err) { toast(err.message, true); }
    });

    F.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-la],[data-foto]"); if (!b) return;
      try {
        if (b.dataset.la === "add-ativ") { linhaAtividade({}); $$('[data-c="atividade"]', TB).pop().focus(); return; }
        if (b.dataset.la === "rm-ativ") { b.closest("tr").remove(); total(); return; }
        if (b.dataset.la === "ficha") imprimirEm(`/admin/imprimir/ficha/${id}`);
        if (b.dataset.la === "contratos") { $("#dlg-aluno").close(); abrirContratos(id, a.nome); }
        if (b.dataset.la === "apagar") {
          if (!confirm(`Apagar a pré-matrícula de ${a.nome}? Use para envio repetido ou de teste. Não tem volta.`)) return;
          await api(`/api/gestao/alunos/${id}`, "DELETE");
          toast("Pré-matrícula apagada."); $("#dlg-aluno").close(); listarAlunos(); resumo();
        }
        if (b.dataset.la === "efetivar") {
          await salvar();
          const r = await api(`/api/gestao/alunos/${id}/efetivar`, "POST", {});
          confirmar(`Matrícula efetivada — código ${r.codigo_fmt}.`, r.avisos || []);
          $("#dlg-aluno").close(); await listarAlunos(); await resumo(); formAluno(id);
        }
        if (b.dataset.foto === "enviar") $("#fa-foto-arq", F).click();
        if (b.dataset.foto === "remover") {
          if (!confirm("Remover a foto do aluno?")) return;
          await api(`/api/gestao/alunos/${id}/foto`, "DELETE");
          $("#fa-foto", F).innerHTML = "sem foto"; b.remove(); toast("Foto removida.");
        }
      } catch (err) { toast(err.message, true); }
    });

    $("#fa-foto-arq", F)?.addEventListener("change", async (ev) => {
      const arq = ev.target.files[0]; if (!arq) return;
      try {
        const dataUrl = await reduzirImagem(arq, 640, 0.85);
        const r = await api(`/api/gestao/alunos/${id}/foto`, "POST", { dataUrl });
        $("#fa-foto", F).innerHTML = `<img src="/admin/arquivo/${r.foto_id}" alt="Foto do aluno">`;
        toast("Foto salva.");
      } catch (err) { toast(err.message, true); }
    });
  }

  /* A foto é reduzida NO NAVEGADOR antes de subir: a do celular tem 4 MB e
     12 megapixels para ocupar 3×4 cm na ficha. Redesenhar no canvas também
     descarta os metadados EXIF — que numa foto de celular incluem a
     localização GPS de onde ela foi tirada, muitas vezes a casa da criança.
     Lê por FileReader (data:) porque a CSP do painel não aceita blob:. */
  function reduzirImagem(arq, max, qualidade) {
    return new Promise((ok, falha) => {
      if (!/^image\/(jpeg|png|webp)$/.test(arq.type)) return falha(new Error("Envie uma foto JPG, PNG ou WEBP."));
      const leitor = new FileReader();
      leitor.onerror = () => falha(new Error("Não foi possível ler a foto."));
      leitor.onload = () => {
        const img = new Image();
        img.onerror = () => falha(new Error("A foto parece estar corrompida."));
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

  /* ==========================================================================
     CONTRATOS DO ALUNO — o histórico em modal
     ========================================================================== */
  async function abrirContratos(id, nome) {
    const d = await api(`/api/gestao/alunos/${id}/contratos`);
    const dlg = $("#dlg-contratos");
    abrir(dlg, `${cab(`Contratos — ${nome}`)}
      <div class="g-dlg-corpo">
        ${d.menor ? '<p class="gf-nota">Aluno menor de idade: o contrato sai no nome do <b>responsável</b>.</p>' : ""}
        ${d.vazios.length ? `<p class="gf-nota gf-nota--alerta">Estes campos estão em branco no cadastro e sairiam vazios no contrato:
          <b>${d.vazios.map(e).join(", ")}</b>. Complete o cadastro antes de gerar, se possível.</p>` : ""}
        ${d.pode_gerar ? "" : '<p class="gf-nota gf-nota--alerta">Efetive a matrícula antes: o contrato leva o código do aluno.</p>'}
        <p class="hint mb">Cada contrato gerado fica guardado exatamente como saiu — editar o cadastro ou o modelo depois não muda os já gerados.</p>
        ${d.contratos.length ? `<div class="g-tabela-caixa"><table class="g-tabela g-hist">
          <thead><tr><th>Gerado em</th><th>Por</th><th>Situação</th><th></th></tr></thead>
          <tbody>${d.contratos.map((c, i) => `<tr>
            <td><span class="quando">${e(c.gerado_txt)}</span>${i === 0 ? '<small>o mais recente</small>' : ""}</td>
            <td>${e(c.gerado_por)}</td>
            <td>${c.assinado ? `<span class="selo selo--ok">assinado</span><small>${e(c.assinado_txt)} · ${e(c.assinado_por)}</small>`
              : '<span class="selo selo--nao">não assinado</span>'}</td>
            <td class="acoes">
              <button class="btn btn-ghost btn-sm" data-c="abrir" data-id="${c.id}">Abrir / imprimir</button>
              <button class="btn btn-ghost btn-sm" data-c="${c.assinado ? "desassinar" : "assinar"}" data-id="${c.id}">${c.assinado ? "Desfazer" : "Marcar assinado"}</button>
            </td></tr>`).join("")}</tbody></table></div>`
          : '<p class="g-vazio">Nenhum contrato gerado ainda.</p>'}
      </div>
      <div class="g-dlg-rodape">
        <button type="button" class="btn btn-ghost" data-fechar>Fechar</button>
        <button type="button" class="btn btn-mint" data-c="gerar"${d.pode_gerar ? "" : " disabled"}>Gerar contrato atualizado</button>
      </div>`);

    dlg.onclick = async (ev) => {
      const b = ev.target.closest("[data-c]"); if (!b) return;
      try {
        if (b.dataset.c === "abrir") imprimirEm(`/admin/imprimir/contrato/${b.dataset.id}`);
        if (b.dataset.c === "assinar" || b.dataset.c === "desassinar") {
          await api(`/api/gestao/contratos/${b.dataset.id}/assinatura`, "PUT", { assinado: b.dataset.c === "assinar" });
          abrirContratos(id, nome);
        }
        if (b.dataset.c === "gerar") {
          if (d.vazios.length && !confirm(`Campos em branco vão sair vazios no contrato (${d.vazios.join(", ")}). Gerar mesmo assim?`)) return;
          /* A aba nova é aberta AGORA, dentro do clique: aberta depois do
             await, o navegador a trataria como pop-up e bloquearia. */
          const aba = window.open("", "_blank");
          const r = await api(`/api/gestao/alunos/${id}/contratos`, "POST", {});
          if (aba) aba.location = `/admin/imprimir/contrato/${r.id}`;
          toast("Contrato gerado e guardado no histórico.");
          abrirContratos(id, nome); listarAlunos();
        }
      } catch (err) { toast(err.message, true); }
    };
  }

  /* ==========================================================================
     ATIVIDADES
     ========================================================================== */
  async function telaAtividades() {
    const P = $("#p-g-atividades");
    const { atividades } = await api("/api/gestao/atividades");
    G.atividades = atividades;
    P.innerHTML = `<div class="topbar"><h1>Atividades</h1><button class="btn btn-mint" data-ac="nova">+ Nova atividade</button></div>
      <p class="hint mb">A mensalidade daqui é sugerida no cadastro do aluno quando se escolhe a turma — e cada aluno pode ter a sua.</p>
      <div class="g-tabela-caixa">${atividades.length ? `<table class="g-tabela">
        <thead><tr><th>Atividade</th><th>Mensalidade</th><th>Turmas</th><th>Status</th><th></th></tr></thead>
        <tbody>${atividades.map((a) => `<tr><td><b>${e(a.nome)}</b>${a.descricao ? `<br><small class="fraco">${e(a.descricao)}</small>` : ""}</td>
          <td>${e(a.mensalidade_txt || "—")}</td><td>${a.turmas}</td>
          <td><span class="selo selo--${a.ativo ? "ativo" : "inativo"}">${a.ativo ? "ativa" : "inativa"}</span></td>
          <td class="acoes"><button class="btn btn-ghost btn-sm" data-ac="editar" data-id="${a.id}">Editar</button>
            ${a.turmas ? "" : `<button class="btn btn-danger btn-sm" data-ac="apagar" data-id="${a.id}">Apagar</button>`}</td></tr>`).join("")}</tbody></table>`
        : '<p class="g-vazio">Nenhuma atividade.</p>'}</div>`;
    P.onclick = async (ev) => {
      const b = ev.target.closest("[data-ac]"); if (!b) return;
      const a = G.atividades.find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.ac === "apagar") {
        if (!confirm(`Apagar a atividade ${a.nome}?`)) return;
        try { await api(`/api/gestao/atividades/${a.id}`, "DELETE"); toast("Atividade apagada."); telaAtividades(); }
        catch (err) { toast(err.message, true); }
        return;
      }
      const x = a || { ativo: 1 };
      abrir($("#dlg-pequeno"), `<form id="f-ativ">${cab(a ? "Editar atividade" : "Nova atividade")}<div class="g-dlg-corpo">
        <label class="obrig">Nome</label><input name="nome" value="${e(x.nome || "")}" maxlength="60" required>
        <label>Mensalidade padrão</label><input name="mensalidade" data-mask="moeda" inputmode="numeric" placeholder="R$ 0,00"
          value="${x.mensalidade ? moeda(x.mensalidade) : ""}">
        <label>Descrição</label><textarea name="descricao" maxlength="400">${e(x.descricao || "")}</textarea>
        <label class="gf-check"><input type="checkbox" name="ativo"${x.ativo ? " checked" : ""}> Atividade ativa</label>
      </div><div class="g-dlg-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>
        <button class="btn btn-navy">Salvar</button></div></form>`);
      mascarar($("#f-ativ"));
      $("#f-ativ").onsubmit = async (evt) => {
        evt.preventDefault();
        const d = Object.fromEntries(new FormData(evt.target)); d.ativo = !!evt.target.ativo.checked;
        try {
          await api(a ? `/api/gestao/atividades/${a.id}` : "/api/gestao/atividades", a ? "PUT" : "POST", d);
          $("#dlg-pequeno").close(); toast("Atividade salva."); telaAtividades();
        } catch (err) { toast(err.message, true); }
      };
    };
  }

  /* ==========================================================================
     PROFESSORES — o cadastro que alimenta o professor da turma e o de cada
     atividade do aluno
     ========================================================================== */
  async function telaProfessores() {
    const P = $("#p-g-professores");
    await carregarTurmasEAtividades();
    P.innerHTML = `<div class="topbar"><h1>Professores</h1><button class="btn btn-mint" data-pr="novo">+ Novo professor</button></div>
      <p class="hint mb">O professor escolhido na turma vale para todos os alunos dela; no cadastro do aluno dá para escolher outro só para
        aquela atividade. Professor que saiu se marca como <b>inativo</b>: some das listas de escolha e continua nas turmas e fichas antigas.</p>
      <div class="g-tabela-caixa">${G.professores.length ? `<table class="g-tabela">
        <thead><tr><th>Nome</th><th>CREF</th><th>Telefone</th><th>E-mail</th><th>Turmas ativas</th><th>Alunos ativos</th><th>Status</th><th></th></tr></thead>
        <tbody>${G.professores.map((p) => `<tr><td><b>${e(p.nome)}</b>${p.observacao ? `<br><small class="fraco">${e(p.observacao)}</small>` : ""}</td>
          <td class="nw">${e(p.cref || "")}</td><td class="nw">${e(p.telefone || "")}</td><td>${e(p.email || "")}</td>
          <td>${p.turmas}</td><td>${p.alunos}</td>
          <td><span class="selo selo--${p.ativo ? "ativo" : "inativo"}">${p.ativo ? "ativo" : "inativo"}</span></td>
          <td class="acoes"><button class="btn btn-ghost btn-sm" data-pr="editar" data-id="${p.id}">Editar</button>
            ${p.turmas || p.alunos ? "" : `<button class="btn btn-danger btn-sm" data-pr="apagar" data-id="${p.id}">Apagar</button>`}</td></tr>`).join("")}</tbody></table>`
        : '<p class="g-vazio">Nenhum professor cadastrado. Cadastre para escolher na turma e nas atividades dos alunos.</p>'}</div>`;

    P.onclick = async (ev) => {
      const b = ev.target.closest("[data-pr]"); if (!b) return;
      const p = G.professores.find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.pr === "apagar") {
        if (!confirm(`Apagar o professor ${p.nome}?`)) return;
        try { await api(`/api/gestao/professores/${p.id}`, "DELETE"); toast("Professor apagado."); telaProfessores(); }
        catch (err) { toast(err.message, true); }
        return;
      }
      const x = p || { ativo: 1 };
      abrir($("#dlg-pequeno"), `<form id="f-prof">${cab(p ? "Editar professor" : "Novo professor")}<div class="g-dlg-corpo">
        <label class="obrig">Nome</label><input name="nome" value="${e(x.nome || "")}" maxlength="80" required>
        <div class="gf"><div class="c6"><label>CREF</label><input name="cref" value="${e(x.cref || "")}" maxlength="30" placeholder="ex.: 001058-G/PE"></div>
          <div class="c6"><label>Telefone</label><input name="telefone" data-mask="fone" inputmode="tel" value="${e(x.telefone || "")}" maxlength="20"></div></div>
        <label>E-mail</label><input name="email" type="email" value="${e(x.email || "")}" maxlength="120">
        <label>Observação</label><input name="observacao" value="${e(x.observacao || "")}" maxlength="300" placeholder="ex.: turmas infantis, hidroginástica">
        <label class="gf-check"><input type="checkbox" name="ativo"${x.ativo ? " checked" : ""}> Professor ativo</label>
      </div><div class="g-dlg-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>
        <button class="btn btn-navy">Salvar</button></div></form>`);
      mascarar($("#f-prof"));
      $("#f-prof").onsubmit = async (evt) => {
        evt.preventDefault();
        const d = Object.fromEntries(new FormData(evt.target)); d.ativo = !!evt.target.ativo.checked;
        try {
          await api(p ? `/api/gestao/professores/${p.id}` : "/api/gestao/professores", p ? "PUT" : "POST", d);
          $("#dlg-pequeno").close(); toast("Professor salvo."); telaProfessores();
        } catch (err) { toast(err.message, true); }
      };
    };
  }

  /* ==========================================================================
     TURMAS
     ========================================================================== */
  async function telaTurmas() {
    const P = $("#p-g-turmas");
    await carregarTurmasEAtividades();
    const { dias_aula } = await api("/api/gestao/config");
    const dias = dias_aula.map((d) => DIAS_CURTO[d]).join(", ");
    P.innerHTML = `<div class="topbar"><h1>Turmas</h1><button class="btn btn-mint" data-tu="nova">+ Nova turma</button></div>
      <p class="hint mb">A turma é a atividade num horário. Os dias de cada aluno se marcam no cadastro dele (o padrão são os da academia:
        ${e(dias)}). Só as turmas marcadas “no site” aparecem no formulário de matrícula. <b>Vagas é um limite de aviso</b>: dá para
        matricular além dele, e a turma fica marcada como excedente.</p>
      <div class="g-tabela-caixa">${G.turmas.length ? `<table class="g-tabela">
        <thead><tr><th>Atividade</th><th>Horário</th><th>Professor</th><th>Vagas</th><th>Alunos ativos</th><th>No site</th><th>Status</th><th></th></tr></thead>
        <tbody>${G.turmas.map((t) => `<tr><td><b>${e(t.atividade_nome)}</b></td>
          <td class="cod">${e(t.horario)}${t.horario_fim ? "–" + e(t.horario_fim) : ""}</td>
          <td>${e(t.professor || "")}</td><td>${t.vagas || '<span class="fraco">sem limite</span>'}</td>
          <td class="nw">${t.alunos_ativos}${t.vagas ? ` <span class="fraco">de ${t.vagas}</span>` : ""}
            ${t.excedente ? `<span class="selo selo--inativo" title="Passou do limite de vagas">⚠ excedente +${t.excedente}</span>`
              : t.vagas && t.alunos_ativos >= t.vagas ? ' <span class="selo selo--pendente">lotada</span>' : ""}
            ${t.pendentes ? `<br><small class="fraco">+${t.pendentes} pré-matrícula(s)</small>` : ""}</td>
          <td>${t.publica ? "sim" : '<span class="fraco">não</span>'}</td>
          <td><span class="selo selo--${t.ativo ? "ativo" : "inativo"}">${t.ativo ? "ativa" : "inativa"}</span></td>
          <td class="acoes"><button class="btn btn-ghost btn-sm" data-tu="editar" data-id="${t.id}">Editar</button>
            ${t.alunos_ativos ? "" : `<button class="btn btn-danger btn-sm" data-tu="apagar" data-id="${t.id}">Apagar</button>`}</td></tr>`).join("")}</tbody></table>`
        : '<p class="g-vazio">Nenhuma turma. Crie a primeira — sem turma, o formulário do site pede o horário por escrito.</p>'}</div>`;

    P.onclick = async (ev) => {
      const b = ev.target.closest("[data-tu]"); if (!b) return;
      const t = G.turmas.find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.tu === "apagar") {
        if (!confirm(`Apagar a turma ${t.rotulo}?`)) return;
        try { await api(`/api/gestao/turmas/${t.id}`, "DELETE"); toast("Turma apagada."); telaTurmas(); }
        catch (err) { toast(err.message, true); }
        return;
      }
      const x = t || { ativo: 1, publica: 1 };
      abrir($("#dlg-pequeno"), `<form id="f-turma">${cab(t ? "Editar turma" : "Nova turma")}<div class="g-dlg-corpo">
        <label class="obrig">Atividade</label><select name="atividade_id" required>${G.atividades.filter((a) => a.ativo || a.id === x.atividade_id)
          .map((a) => `<option value="${a.id}"${a.id === x.atividade_id ? " selected" : ""}>${e(a.nome)}</option>`).join("")}</select>
        <div class="gf"><div class="c6"><label class="obrig">Início</label><input type="time" name="horario" value="${e(x.horario || "")}" required></div>
          <div class="c6"><label>Término</label><input type="time" name="horario_fim" value="${e(x.horario_fim || "")}"></div></div>
        <div class="gf"><div class="c4"><label>Vagas</label><input type="number" min="0" name="vagas" value="${x.vagas || ""}" placeholder="sem limite"></div>
          <div class="c8"><label>Professor</label><select name="professor_id">${opcoesProfessor(x.professor_id || null, "Sem professor definido")}</select>
            ${G.professores.length ? "" : '<small class="fraco">Nenhum professor cadastrado — cadastre em Professores.</small>'}</div></div>
        <label>Observação</label><input name="observacao" value="${e(x.observacao || "")}" maxlength="300">
        <label class="gf-check"><input type="checkbox" name="publica"${x.publica ? " checked" : ""}> Aparece no formulário de matrícula do site</label>
        <label class="gf-check"><input type="checkbox" name="ativo"${x.ativo ? " checked" : ""}> Turma ativa</label>
      </div><div class="g-dlg-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>
        <button class="btn btn-navy">Salvar</button></div></form>`);
      $("#f-turma").onsubmit = async (evt) => {
        evt.preventDefault();
        const f = evt.target, d = Object.fromEntries(new FormData(f));
        d.publica = f.publica.checked; d.ativo = f.ativo.checked;
        try {
          await api(t ? `/api/gestao/turmas/${t.id}` : "/api/gestao/turmas", t ? "PUT" : "POST", d);
          $("#dlg-pequeno").close(); toast("Turma salva."); telaTurmas();
        } catch (err) { toast(err.message, true); }
      };
    };
  }

  /* ==========================================================================
     AGENDA — o mês em tons pastéis: aula em azul, feriado em vermelho e outra
     atividade (exame de pele, capacitação da equipe) em amarelo
     ========================================================================== */
  const CATEGORIA = {
    feriado: { rotulo: "Feriado", dica: "sem aula" },
    aula: { rotulo: "Dia de aula", dica: "aula fora da regra da semana, como uma reposição" },
    atividade: { rotulo: "Outra atividade", dica: "exame de pele, capacitação da equipe…" },
  };
  async function telaAgenda() {
    const P = $("#p-g-agenda");
    if (!G.ag) { const h = new Date(); G.ag = { ano: h.getFullYear(), mes: h.getMonth() + 1 }; }
    const d = await api(`/api/gestao/agenda?ano=${G.ag.ano}&mes=${G.ag.mes}`);
    const vazios = d.dias[0].semana;
    const doMes = d.dias.filter((x) => x.eventos.length);
    /* O que vai escrito dentro do quadradinho: o nome do que venceu o dia; sem
       nada cadastrado, "aula" nos dias da regra da semana. */
    const legenda = (x) => {
      const vale = x.eventos.filter((v) => v.vale && v.categoria === x.cor).map((v) => v.nome);
      return vale.length ? vale.join(" · ") : x.cor === "aula" ? "aula" : "";
    };
    P.innerHTML = `<div class="topbar"><h1>Agenda</h1><div class="g-acoes-topo">
        <button class="btn btn-ghost btn-sm" data-ag="compartilhar">🖼 Imagem e impressão do mês</button>
        <button class="btn btn-mint btn-sm" data-ag="nova">+ Nova data</button></div></div>
      <div class="card">
        <div class="ag-cab">
          <button class="btn btn-ghost btn-sm" data-ag="-1" aria-label="Mês anterior">‹</button>
          <h2>${MESES[d.mes - 1]} de ${d.ano}</h2>
          <button class="btn btn-ghost btn-sm" data-ag="1" aria-label="Próximo mês">›</button>
          <button class="btn btn-ghost btn-sm" data-ag="hoje">Hoje</button>
        </div>
        <div class="ag-grade">
          ${DIAS_CURTO.map((s) => `<div class="ag-sem">${s}</div>`).join("")}
          ${'<div class="ag-dia fora"></div>'.repeat(vazios)}
          ${d.dias.map((x) => `<button type="button" class="ag-dia${x.cor ? " " + x.cor : ""}${x.data === d.hoje ? " hoje" : ""}" data-dia="${x.data}"
              title="${e(legenda(x) || "Sem aula")} — clique para cadastrar uma data neste dia">
            <span class="n">${x.dia}</span>${legenda(x) ? `<small>${e(legenda(x))}</small>` : ""}</button>`).join("")}
        </div>
        <div class="ag-legenda"><span class="l-aula">Dia de aula</span><span class="l-feriado">Feriado</span>
          <span class="l-atividade">Outra atividade</span><span class="l-livre">Sem aula</span></div>
        <p class="hint mt">Clique num dia para cadastrar um feriado, um dia de aula extra ou outra atividade só naquela data.</p>
      </div>
      <div class="card mt"><h3 style="margin:0 0 .4rem">Datas de ${MESES[d.mes - 1]}</h3>
        ${doMes.length ? `<ul class="ag-lista">${doMes.map((x) => x.eventos.map((v) =>
          `<li class="${v.vale ? "" : "vencida"}"><span class="ag-bola ${v.categoria}"></span><b>${dataBR(x.data)}</b> — ${e(v.nome)}
            <small class="fraco">${CATEGORIA[v.categoria].rotulo.toLowerCase()}</small>
            ${!v.vale ? '<span class="selo selo--inativo">não vale neste dia: há uma data cadastrada só para ele</span>'
              : v.categoria === "feriado" && x.diaDeAulaComFeriado ? '<span class="selo selo--pendente">cai em dia de aula</span>' : ""}</li>`).join("")).join("")}</ul>`
          : '<p class="hint">Nenhuma data cadastrada neste mês.</p>'}
        <p class="hint mt">A lista completa — feriados, dias de aula extra e atividades — fica em Configurações.</p></div>`;
    P.onclick = (ev) => {
      const dia = ev.target.closest("[data-dia]");
      if (dia) return formData({ categoria: "atividade", tipo: "data", data: dia.dataset.dia }, telaAgenda, true);
      const b = ev.target.closest("[data-ag]"); if (!b) return;
      if (b.dataset.ag === "nova") return formData(null, telaAgenda);
      if (b.dataset.ag === "compartilhar") return compartilharAgenda(d).catch((err) => toast(err.message, true));
      if (b.dataset.ag === "hoje") { const h = new Date(); G.ag = { ano: h.getFullYear(), mes: h.getMonth() + 1 }; }
      else {
        let m = G.ag.mes + Number(b.dataset.ag), a = G.ag.ano;
        if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; }
        G.ag = { ano: a, mes: m };
      }
      telaAgenda().catch((err) => toast(err.message, true));
    };
  }

  /* ==========================================================================
     AGENDA PARA REDES SOCIAIS — a imagem do mês, desenhada no navegador

     Canvas puro: sem biblioteca (a CSP do painel não deixa script de fora, e
     não precisa). Dois formatos: feed (1080×1350, o 4:5 que o Instagram
     mostra maior) e stories (1080×1920). Mostra só o que o aluno precisa —
     dias de aula, feriados e atividades; a data que perdeu para outra no
     mesmo dia não aparece.
     ========================================================================== */
  const CORES_DIA = {
    aula: { fundo: "#dcecfb", borda: "#b9d8f5", tinta: "#0B4EA2" },
    feriado: { fundo: "#fbdde2", borda: "#f3b8c2", tinta: "#8f2340" },
    atividade: { fundo: "#fdf1c7", borda: "#f0d982", tinta: "#7a5700" },
    "": { fundo: "#ffffff", borda: "#dce6f0", tinta: "#8aa4bf" },
  };
  function carregarImagem(src) {
    return new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = falha; i.src = src; });
  }
  function caixa(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /* Quebra o texto em até `max` linhas; a última ganha "…" se sobrar. */
  function linhasDe(ctx, texto, largura, max) {
    const palavras = String(texto).split(/\s+/), saida = [];
    let atual = "";
    for (const p of palavras) {
      const teste = atual ? atual + " " + p : p;
      if (ctx.measureText(teste).width <= largura) { atual = teste; continue; }
      if (atual) saida.push(atual);
      atual = p;
      if (saida.length === max) break;
    }
    if (saida.length < max && atual) saida.push(atual);
    if (saida.length === max && palavras.join(" ") !== saida.join(" ")) {
      let u = saida[max - 1];
      while (u.length > 1 && ctx.measureText(u + "…").width > largura) u = u.slice(0, -1);
      saida[max - 1] = u + "…";
    }
    return saida.slice(0, max);
  }
  async function desenharAgenda(d, formato) {
    const W = 1080, H = formato === "stories" ? 1920 : 1350;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const F = '"Nunito Sans", system-ui, sans-serif';
    try { await Promise.all([document.fonts.load(`800 40px "Nunito Sans"`), document.fonts.load(`700 20px "Nunito Sans"`)]); } catch {}
    const logo = await carregarImagem("/assets/img/logo-original.svg").catch(() => null);

    ctx.fillStyle = "#F4FAFE"; ctx.fillRect(0, 0, W, H);
    /* Faixa azul do topo, com a onda da identidade embaixo. */
    const topo = formato === "stories" ? 360 : 290;
    const g = ctx.createLinearGradient(0, 0, W, topo);
    g.addColorStop(0, "#0B4EA2"); g.addColorStop(1, "#083B7E");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, topo - 30);
    ctx.bezierCurveTo(W * 0.7, topo + 20, W * 0.35, topo - 60, 0, topo - 10); ctx.closePath(); ctx.fill();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#7ED321"; ctx.font = `800 30px ${F}`;
    ctx.fillText("A G E N D A   D A S   A U L A S", 70, formato === "stories" ? 120 : 92);
    ctx.fillStyle = "#fff"; ctx.font = `800 ${formato === "stories" ? 120 : 104}px ${F}`;
    const mesTxt = MESES[d.mes - 1][0].toUpperCase() + MESES[d.mes - 1].slice(1);
    const yMes = formato === "stories" ? 245 : 196;
    ctx.fillText(mesTxt, 66, yMes);
    const wMes = ctx.measureText(mesTxt).width;
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = `700 ${formato === "stories" ? 64 : 56}px ${F}`;
    ctx.fillText(String(d.ano), 66 + wMes + 22, yMes);
    ctx.fillStyle = "#fff"; ctx.font = `700 30px ${F}`;
    ctx.fillText(`Aulas às ${d.dias_txt}`, 70, yMes + (formato === "stories" ? 62 : 52));

    /* O calendário, num cartão branco. */
    const semanas = Math.ceil((d.dias[0].semana + d.dias.length) / 7);
    const cx = 50, cw = W - 100, cy = topo + 30;
    /* O espaço de baixo é o que a legenda e a lista de datas PRECISAM (com
       teto): o resto vai para o calendário. Reservar fixo deixava um vão
       vazio no stories de um mês com duas datas. */
    const datas = d.dias.flatMap((x) => x.eventos.filter((v) => v.vale).map((v) => ({ x, v })));
    const rodape = 150;
    const espacoLista = 100 + Math.min(datas.length, formato === "stories" ? 10 : 5) * 38;
    const cartaoH = H - cy - rodape - espacoLista - 40;
    ctx.save(); ctx.shadowColor = "rgba(8,59,126,.14)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#fff"; caixa(ctx, cx, cy, cw, cartaoH, 28); ctx.fill(); ctx.restore();
    const pad = 22, gap = 8, colW = (cw - pad * 2 - gap * 6) / 7;
    ctx.fillStyle = "#48617e"; ctx.font = `800 24px ${F}`; ctx.textAlign = "center";
    DIAS_CURTO.forEach((s, i) => ctx.fillText(s.toUpperCase(), cx + pad + i * (colW + gap) + colW / 2, cy + pad + 26));
    ctx.textAlign = "left";
    const gy = cy + pad + 46, rowH = (cartaoH - (gy - cy) - pad - gap * (semanas - 1)) / semanas;
    d.dias.forEach((x, i) => {
      const pos = d.dias[0].semana + i, col = pos % 7, lin = Math.floor(pos / 7);
      const X = cx + pad + col * (colW + gap), Y = gy + lin * (rowH + gap);
      const c = CORES_DIA[x.cor] || CORES_DIA[""];
      ctx.fillStyle = c.fundo; caixa(ctx, X, Y, colW, rowH, 14); ctx.fill();
      ctx.strokeStyle = c.borda; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = c.tinta; ctx.font = `800 ${Math.round(Math.min(40, rowH * 0.34))}px ${F}`;
      ctx.fillText(String(x.dia), X + 12, Y + Math.min(44, rowH * 0.38));
      const nomes = x.eventos.filter((v) => v.vale && v.categoria === x.cor).map((v) => v.nome).join(" · ");
      if (nomes && rowH > 70) {
        ctx.font = `700 ${Math.round(Math.min(19, rowH * 0.16))}px ${F}`;
        linhasDe(ctx, nomes, colW - 20, rowH > 150 ? 4 : 2)
          .forEach((l, k) => ctx.fillText(l, X + 10, Y + Math.min(44, rowH * 0.38) + 26 + k * Math.min(22, rowH * 0.19)));
      }
    });

    /* Legenda e a lista de datas do mês. */
    let y = cy + cartaoH + 50;
    let lx = 70;
    ctx.font = `700 26px ${F}`;
    for (const [cor, rot] of [["aula", "Dia de aula"], ["feriado", "Feriado (sem aula)"], ["atividade", "Outra atividade"]]) {
      ctx.fillStyle = CORES_DIA[cor].fundo; caixa(ctx, lx, y - 22, 28, 28, 7); ctx.fill();
      ctx.strokeStyle = CORES_DIA[cor].borda; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#0e2a4a"; ctx.fillText(rot, lx + 40, y);
      lx += 40 + ctx.measureText(rot).width + 44;
    }
    y += 50;
    const cabem = Math.max(0, Math.floor((H - rodape - 20 - y) / 38));
    ctx.font = `700 27px ${F}`;
    datas.slice(0, cabem).forEach(({ x, v }, k) => {
      const Y = y + k * 38;
      ctx.fillStyle = CORES_DIA[v.categoria].borda; ctx.beginPath(); ctx.arc(78, Y - 9, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0e2a4a";
      const txt = `${String(x.dia).padStart(2, "0")}/${String(d.mes).padStart(2, "0")} — ${v.nome}`;
      ctx.fillText(linhasDe(ctx, txt, W - 180, 1)[0], 100, Y);
    });
    if (datas.length > cabem && cabem > 0) {
      ctx.fillStyle = "#48617e"; ctx.font = `600 22px ${F}`;
      ctx.fillText(`+ ${datas.length - cabem} data(s) — veja a agenda completa na academia`, 100, y + cabem * 38);
    }

    /* Rodapé branco com o logotipo e o contato público. */
    ctx.fillStyle = "#fff"; ctx.fillRect(0, H - rodape, W, rodape);
    ctx.fillStyle = "#7ED321"; ctx.fillRect(0, H - rodape, W, 6);
    if (logo) { const lh = 96, lw = lh * (logo.naturalWidth / logo.naturalHeight || 1.95); ctx.drawImage(logo, 50, H - rodape + (rodape - lh) / 2 + 3, lw, lh); }
    ctx.textAlign = "right"; ctx.fillStyle = "#0e2a4a";
    const contatos = [d.contato.instagram, d.contato.whatsapp && `WhatsApp ${d.contato.whatsapp}`, d.contato.site].filter(Boolean);
    contatos.forEach((c, k) => { ctx.font = `${k === 0 ? 800 : 700} ${k === 0 ? 30 : 26}px ${F}`; ctx.fillText(c, W - 55, H - rodape + 52 + k * 36); });
    ctx.textAlign = "left";
    return cv;
  }

  async function compartilharAgenda(d) {
    let formato = "feed";
    abrir($("#dlg-pequeno"), `<form id="f-comp">${cab(`Agenda de ${MESES[d.mes - 1]} de ${d.ano}`)}<div class="g-dlg-corpo">
      <div class="g-chips" id="comp-fmt" role="group" aria-label="Formato">
        <button type="button" class="g-chip on" data-fmt="feed">Feed · 1080×1350</button>
        <button type="button" class="g-chip" data-fmt="stories">Stories · 1080×1920</button>
      </div>
      <div class="comp-previa" id="comp-previa"><p class="g-vazio">Desenhando…</p></div>
      <p class="hint mt">A imagem mostra os dias de aula, os feriados e as atividades do mês, com o contato da academia. Para o mural e
        para entregar aos alunos, use <b>Imprimir</b>.</p>
    </div><div class="g-dlg-rodape">
      <button type="button" class="btn btn-ghost" data-comp="imprimir">🖨 Imprimir para os alunos</button>
      <button type="button" class="btn btn-mint" data-comp="baixar">⬇ Baixar imagem</button></div></form>`);
    let atual = null;
    const desenhar = async () => {
      atual = await desenharAgenda(d, formato);
      $("#comp-previa").innerHTML = "";
      const img = new Image(); img.alt = "Prévia da imagem da agenda"; img.src = atual.toDataURL("image/png");
      $("#comp-previa").appendChild(img);
    };
    $("#f-comp").onclick = async (ev) => {
      const f = ev.target.closest("[data-fmt]");
      if (f) {
        formato = f.dataset.fmt;
        $$("#comp-fmt .g-chip").forEach((c) => c.classList.toggle("on", c === f));
        return desenhar().catch((err) => toast(err.message, true));
      }
      const b = ev.target.closest("[data-comp]"); if (!b) return;
      if (b.dataset.comp === "imprimir") imprimirEm(`/admin/imprimir/agenda?ano=${d.ano}&mes=${d.mes}`);
      if (b.dataset.comp === "baixar" && atual) {
        const a = document.createElement("a");
        a.href = atual.toDataURL("image/png");
        a.download = `agenda-forms-fitness-${d.ano}-${String(d.mes).padStart(2, "0")}-${formato}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      }
    };
    await desenhar();
  }

  /* ==========================================================================
     INDICADORES — alunos por turma e por atividade

     Uma série só (alunos ativos), em uma cor só: sem legenda, o título diz o
     que é. O limite de vagas é um traço fino na barra; o que passa dele sai
     em vermelho de ALERTA, sempre com o texto "excedente" ao lado — a cor
     nunca carrega o aviso sozinha. Pré-matrícula não entra na barra (ainda
     não é aluno): aparece no detalhe e na tabela.
     ========================================================================== */
  /* Passo do eixo em número redondo (1, 2, 5, 10…) e nunca abaixo de 1:
     é contagem de gente, não existe meio aluno. */
  function passoRedondo(max) {
    const bruto = Math.max(1, max) / 4, pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    return Math.max(1, [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto) || pot * 10);
  }
  function graficoBarras(itens, { titulo, vazio }) {
    if (!itens.length) return `<p class="g-vazio">${e(vazio)}</p>`;
    const max = Math.max(1, ...itens.map((i) => Math.max(i.valor, i.limite || 0)));
    const passo = passoRedondo(max), topo = Math.ceil(max / passo) * passo;
    const pct = (v) => (v / topo) * 100;
    const ticks = []; for (let v = 0; v <= topo; v += passo) ticks.push(v);
    return `<div class="gb" role="img" aria-label="${e(titulo)}">
      <div class="gb-eixo" aria-hidden="true">${ticks.map((v) => `<span style="left:${pct(v)}%">${v}</span>`).join("")}</div>
      ${itens.map((i, k) => {
        const dentro = i.limite ? Math.min(i.valor, i.limite) : i.valor;
        const fora = i.limite ? Math.max(0, i.valor - i.limite) : 0;
        return `<div class="gb-linha" data-gb="${k}">
          <div class="gb-rot">${e(i.rotulo)}</div>
          <div class="gb-trilho">
            ${ticks.map((v) => `<i class="gb-grade" style="left:${pct(v)}%"></i>`).join("")}
            ${dentro ? `<span class="gb-barra${fora ? " corta" : ""}" style="width:${pct(dentro)}%"></span>` : ""}
            ${fora ? `<span class="gb-barra fora" style="left:calc(${pct(dentro)}% + 2px);width:calc(${pct(fora)}% - 2px)"></span>` : ""}
            ${i.limite ? `<i class="gb-limite" style="left:${pct(i.limite)}%" title="Limite: ${i.limite} vagas"></i>` : ""}
            <span class="gb-valor" style="left:calc(${pct(i.valor)}% + 8px)">${i.valor}${i.limite ? ` <small>de ${i.limite}</small>` : ""}${fora
              ? ` <b class="gb-alerta">⚠ excedente +${fora}</b>` : ""}</span>
          </div></div>`;
      }).join("")}
      <div class="gb-dica" hidden></div>
    </div>`;
  }
  function ligarDicas(raiz, itens) {
    const dica = $(".gb-dica", raiz); if (!dica) return;
    raiz.addEventListener("mousemove", (ev) => {
      const l = ev.target.closest("[data-gb]");
      if (!l) { dica.hidden = true; return; }
      const i = itens[Number(l.dataset.gb)];
      dica.innerHTML = i.dica;
      dica.hidden = false;
      const r = dica.offsetParent.getBoundingClientRect();
      dica.style.left = Math.min(ev.clientX - r.left + 14, r.width - 240) + "px";
      dica.style.top = (ev.clientY - r.top + 14) + "px";
    });
    raiz.addEventListener("mouseleave", () => { dica.hidden = true; });
  }
  async function telaIndicadores() {
    const P = $("#p-g-indicadores");
    const d = await api("/api/gestao/indicadores");
    const porTurma = d.turmas.map((t) => ({ rotulo: t.rotulo, valor: t.ativos, limite: t.vagas || 0,
      dica: `<b>${e(t.rotulo)}</b><br>${t.ativos} aluno(s) ativo(s)${t.vagas ? ` · limite de ${t.vagas} ${t.vagas === 1 ? "vaga" : "vagas"}` : " · sem limite de vagas"}
        ${t.excedente ? `<br>⚠ excedente: ${t.excedente} acima do limite` : ""}${t.pendentes ? `<br>+${t.pendentes} pré-matrícula(s) esperando` : ""}
        ${t.professor ? `<br>Professor: ${e(t.professor)}` : ""}` }));
    const porAtividade = d.atividades.map((a) => ({ rotulo: a.nome, valor: a.ativos,
      dica: `<b>${e(a.nome)}</b><br>${a.ativos} aluno(s) ativo(s)` }));
    const tile = (rot, val, cls = "") => `<div class="gi-tile ${cls}"><span>${e(rot)}</span><b>${val}</b></div>`;
    P.innerHTML = `<div class="topbar"><h1>Indicadores</h1><button class="btn btn-ghost btn-sm" data-gi="atualizar">↻ Atualizar</button></div>
      <div class="gi-tiles">
        ${tile("Alunos ativos", d.ativos, "hero")}
        ${tile("Pré-matrículas esperando", d.pendentes)}
        ${tile("Inativos", d.inativos)}
        ${tile("Turmas acima do limite", d.acima_do_limite ? `⚠ ${d.acima_do_limite}` : "0", d.acima_do_limite ? "alerta" : "")}
      </div>
      ${d.sem_atividade ? `<p class="gf-nota gf-nota--alerta">${d.sem_atividade} aluno(s) ativo(s) sem nenhuma atividade cadastrada — não entram nos gráficos.</p>` : ""}
      <div class="card mt" id="gi-turmas"><h3 class="gi-tit">Alunos ativos por turma</h3>
        <p class="hint">O traço marca o limite de vagas da turma. Passar dele é permitido; o excedente fica em vermelho.</p>
        ${graficoBarras(porTurma, { titulo: "Alunos ativos por turma", vazio: "Nenhuma turma ativa ainda." })}</div>
      <div class="card mt" id="gi-ativ"><h3 class="gi-tit">Alunos ativos por atividade</h3>
        <p class="hint">Quem faz duas turmas da mesma atividade conta uma vez.</p>
        ${graficoBarras(porAtividade, { titulo: "Alunos ativos por atividade", vazio: "Nenhuma atividade ativa." })}</div>
      <details class="card mt gi-tabela"><summary>Ver os números em tabela</summary>
        <div class="g-tabela-caixa mt"><table class="g-tabela"><thead><tr><th>Turma</th><th>Professor</th><th>Ativos</th><th>Vagas</th>
          <th>Pré-matrículas</th><th>Situação</th></tr></thead><tbody>${d.turmas.map((t) => `<tr><td>${e(t.rotulo)}</td><td>${e(t.professor || "")}</td>
          <td>${t.ativos}</td><td>${t.vagas || '<span class="fraco">sem limite</span>'}</td><td>${t.pendentes}</td>
          <td>${t.excedente ? `<span class="selo selo--inativo">⚠ excedente +${t.excedente}</span>` : t.vagas && t.ativos >= t.vagas
            ? '<span class="selo selo--pendente">completa</span>' : '<span class="selo selo--ativo">com vaga</span>'}</td></tr>`).join("")}</tbody></table></div>
      </details>`;
    ligarDicas($("#gi-turmas"), porTurma);
    ligarDicas($("#gi-ativ"), porAtividade);
    P.onclick = (ev) => { if (ev.target.closest('[data-gi="atualizar"]')) telaIndicadores().catch((err) => toast(err.message, true)); };
  }

  /* ==========================================================================
     RELATÓRIOS
     ========================================================================== */
  async function telaRelatorios() {
    const P = $("#p-g-relatorios");
    const { alunos } = await api("/api/gestao/alunos");
    const mesAtual = new Date().getMonth() + 1;
    P.innerHTML = `<div class="topbar"><h1>Relatórios</h1></div>
      <p class="hint mb">Cada relatório abre numa aba nova, pronto para imprimir ou salvar em PDF.</p>
      <div class="g-cartoes">
        <div class="g-cartao"><h3>Ficha de aluno</h3><p>A ficha completa com as condições da matrícula, em uma folha.</p>
          <select id="rel-aluno">${alunos.filter((a) => a.status !== "pendente").map((a) =>
            `<option value="${a.id}">${e(a.codigo_fmt)} — ${e(a.nome)}</option>`).join("") || "<option value=''>Nenhum aluno</option>"}</select>
          <button class="btn btn-navy btn-sm" data-rel="ficha">Abrir ficha</button></div>
        <div class="g-cartao"><h3>Aniversariantes</h3><p>Alunos ativos que fazem aniversário no mês.</p>
          <select id="rel-mes">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === mesAtual ? " selected" : ""}>${m}</option>`).join("")}</select>
          <button class="btn btn-navy btn-sm" data-rel="aniversariantes">Abrir</button></div>
        <div class="g-cartao"><h3>Alunos ativos</h3><p>Lista com código, turma, telefone e responsável.</p>
          <button class="btn btn-navy btn-sm" data-rel="alunos-ativo">Abrir</button></div>
        <div class="g-cartao"><h3>Alunos inativos</h3><p>Quem já saiu — para retomar contato ou conferir.</p>
          <button class="btn btn-navy btn-sm" data-rel="alunos-inativo">Abrir</button></div>
        <div class="g-cartao"><h3>Turmas ativas</h3><p>Horários, professor, vagas e quantos alunos ativos em cada uma.</p>
          <button class="btn btn-navy btn-sm" data-rel="turmas-ativo">Abrir</button></div>
        <div class="g-cartao"><h3>Turmas inativas</h3><p>Turmas encerradas, que não aparecem mais no cadastro.</p>
          <button class="btn btn-navy btn-sm" data-rel="turmas-inativo">Abrir</button></div>
      </div>`;
    P.onclick = (ev) => {
      const b = ev.target.closest("[data-rel]"); if (!b) return;
      const r = b.dataset.rel;
      if (r === "ficha") { const id = $("#rel-aluno").value; if (id) imprimirEm(`/admin/imprimir/ficha/${id}`); return; }
      if (r === "aniversariantes") return imprimirEm(`/admin/imprimir/relatorio/aniversariantes?mes=${$("#rel-mes").value}`);
      const [tipo, status] = r.split("-");
      imprimirEm(`/admin/imprimir/relatorio/${tipo}?status=${status}`);
    };
  }

  /* ==========================================================================
     CONTRATO — o modelo
     ========================================================================== */
  async function telaContrato() {
    const P = $("#p-g-contrato");
    const d = await api("/api/gestao/contrato/modelo");
    P.innerHTML = `<div class="topbar"><h1>Modelo do contrato</h1>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-ghost" data-mc="previa">Pré-visualizar</button>
        <button class="btn btn-navy" data-mc="salvar">Salvar nova versão</button></div></div>
      <p class="gf-nota mb"><b>Os ${d.contratos_gerados} contrato(s) já gerados não mudam.</b> O que você salvar aqui vale para os próximos.
        Cada gravação vira uma versão nova, com data e autor, e as anteriores ficam guardadas.</p>
      <div class="g-duas">
        <div>
          <div id="mc-editor">${editorRico('data-ed="contrato"', d.texto, true)}</div>
          <div class="card mt"><h3 style="margin:0 0 .3rem">Assinaturas da contratada</h3>
            <p class="hint">A imagem com as assinaturas do contratado e das testemunhas, como no contrato em Word. Sai no pé de cada contrato.
              Trocar a imagem não altera os contratos já gerados.</p>
            <div id="mc-ass" class="mt">${d.assinatura_id ? `<img class="g-assinatura-img" src="/admin/arquivo/${d.assinatura_id}" alt="Assinaturas">`
              : '<p class="hint">Sem imagem: o contrato sai com três linhas em branco para assinar à caneta.</p>'}</div>
            <input type="file" id="mc-ass-arq" accept="image/png,image/jpeg,image/webp" hidden>
            <div class="mt"><button class="btn btn-ghost btn-sm" data-mc="ass-enviar">${d.assinatura_id ? "Trocar imagem" : "Enviar imagem"}</button>
              ${d.assinatura_id ? '<button class="btn btn-danger btn-sm" data-mc="ass-remover">Tirar do contrato</button>' : ""}</div>
          </div>
          <div class="card mt"><h3 style="margin:0 0 .3rem">Versões</h3>
            <div class="g-tabela-caixa"><table class="g-tabela"><thead><tr><th>Salva em</th><th>Por</th><th></th></tr></thead>
            <tbody>${d.versoes.map((v, i) => `<tr><td>${e(v.criado_txt)}${i === 0 ? ' <span class="selo selo--ativo">em uso</span>' : ""}</td>
              <td>${e(v.criado_por)}</td><td class="acoes"><button class="btn btn-ghost btn-sm" data-mc="versao" data-id="${v.id}">Ver</button></td></tr>`).join("")}</tbody></table></div></div>
        </div>
        <div class="g-marcadores"><h3>Marcadores</h3>
          <p class="hint" style="margin:0 0 .5rem">Clique para inserir onde está o cursor. No contrato gerado, cada um vira o dado do aluno.</p>
          ${d.marcadores.map(([n, desc]) => `<button type="button" data-ins="{{${n}}}" onmousedown="event.preventDefault()"><code>{{${n}}}</code><small>${e(desc)}</small></button>`).join("")}
          <h3 class="mt">Trechos condicionais</h3>
          <button type="button" data-ins="{{#SE_MENOR}} … {{/SE_MENOR}}" onmousedown="event.preventDefault()"><code>{{#SE_MENOR}}…{{/SE_MENOR}}</code><small>Só sai quando o aluno é menor de idade</small></button>
          <button type="button" data-ins="{{#SE_MAIOR}} … {{/SE_MAIOR}}" onmousedown="event.preventDefault()"><code>{{#SE_MAIOR}}…{{/SE_MAIOR}}</code><small>Só sai quando o aluno é maior de idade</small></button>
        </div>
      </div>`;

    const valor = () => { const inp = $('#mc-editor input[type=hidden]'); edSync(inp.id); return inp.value; };

    P.onclick = async (ev) => {
      const ins = ev.target.closest("[data-ins]");
      if (ins) {
        const area = $("#mc-editor .ed-area");
        area.focus();
        document.execCommand("insertText", false, ins.dataset.ins);
        return;
      }
      const b = ev.target.closest("[data-mc]"); if (!b) return;
      try {
        if (b.dataset.mc === "salvar") {
          const r = await api("/api/gestao/contrato/modelo", "POST", { texto: valor() });
          toast(r.igual ? "Nada mudou — nenhuma versão nova criada." : "Nova versão do contrato salva.");
          if (!r.igual) telaContrato();
        }
        if (b.dataset.mc === "previa") previaContrato(valor());
        if (b.dataset.mc === "versao") {
          const v = await api(`/api/gestao/contrato/modelo/${b.dataset.id}`);
          const r = await api("/api/gestao/contrato/previa", "POST", { texto: v.texto });
          abrir($("#dlg-contratos"), `${cab(`Versão de ${v.criado_txt} — ${v.criado_por}`)}<div class="g-dlg-corpo">
            <div class="g-previa">${r.html}</div></div>
            <div class="g-dlg-rodape"><button class="btn btn-ghost" data-fechar>Fechar</button></div>`);
        }
        if (b.dataset.mc === "ass-enviar") $("#mc-ass-arq").click();
        if (b.dataset.mc === "ass-remover") {
          if (!confirm("Tirar a imagem das assinaturas dos PRÓXIMOS contratos? Os já gerados continuam com ela.")) return;
          await api("/api/gestao/contrato/assinatura", "DELETE"); telaContrato();
        }
      } catch (err) { toast(err.message, true); }
    };
    $("#mc-ass-arq").onchange = async (ev) => {
      const arq = ev.target.files[0]; if (!arq) return;
      try {
        const dataUrl = await reduzirImagem(arq, 1600, 0.92);
        await api("/api/gestao/contrato/assinatura", "POST", { dataUrl });
        toast("Imagem das assinaturas salva."); telaContrato();
      } catch (err) { toast(err.message, true); }
    };
  }

  async function previaContrato(texto) {
    const { alunos } = await api("/api/gestao/alunos?status=ativo");
    const mostrar = async (alunoId) => {
      const r = await api("/api/gestao/contrato/previa", "POST", { texto, aluno_id: alunoId || undefined });
      $("#prv-corpo").innerHTML = `
        ${r.desconhecidos.length ? `<p class="gf-nota gf-nota--alerta">Marcador desconhecido: <b>${r.desconhecidos.map(e).join(", ")}</b> — o contrato não vai salvar assim.</p>` : ""}
        <div class="g-previa">${r.html}</div>`;
    };
    abrir($("#dlg-contratos"), `${cab("Pré-visualização do contrato")}
      <div class="g-dlg-corpo">
        <label>Preencher com</label><select id="prv-aluno"><option value="">Aluno de exemplo (menor, com responsável)</option>
          ${alunos.map((a) => `<option value="${a.id}">${e(a.codigo_fmt)} — ${e(a.nome)}</option>`).join("")}</select>
        <div id="prv-corpo" class="mt"></div></div>
      <div class="g-dlg-rodape"><button class="btn btn-ghost" data-fechar>Fechar</button></div>`);
    $("#prv-aluno").onchange = (ev) => mostrar(ev.target.value).catch((err) => toast(err.message, true));
    await mostrar("");
  }

  /* ==========================================================================
     CONFIGURAÇÕES — dias de aula, feriados, condições da matrícula
     ========================================================================== */
  async function telaConfig() {
    const P = $("#p-g-config");
    const ano = new Date().getFullYear();
    const [cfg, fer] = await Promise.all([api("/api/gestao/config"), api(`/api/gestao/feriados?ano=${ano}`)]);
    const regra = (f) => f.tipo === "anual" ? `todo ano em ${String(f.dia).padStart(2, "0")}/${String(f.mes).padStart(2, "0")}`
      : f.tipo === "data" ? `só em ${dataBR(f.data)}`
        : `Páscoa ${f.pascoa < 0 ? "−" : "+"}${Math.abs(f.pascoa)} dia(s)`;
    P.innerHTML = `<div class="topbar"><h1>Configurações</h1></div>
      <div class="card"><h3 style="margin:0 0 .2rem">Dias de aula</h3>
        <p class="hint">Os dias em que a academia tem aula. Pintam a agenda e entram no contrato (“nos dias de terças, quartas e sextas”).</p>
        <div class="g-dias" id="cfg-dias">${DIAS_CURTO.map((n, i) => `<label><input type="checkbox" value="${i}"${cfg.dias_aula.includes(i) ? " checked" : ""}> ${n}</label>`).join("")}</div>
        <button class="btn btn-navy btn-sm" data-cf="dias">Salvar dias de aula</button></div>

      <div class="card mt"><div class="topbar" style="margin-bottom:.4rem"><h3 style="margin:0">Calendário: feriados e datas especiais</h3>
          <button class="btn btn-mint btn-sm" data-cf="novo-feriado">+ Nova data</button></div>
        <p class="hint mb">Cada data diz o que o dia é: <span class="chip-cat feriado">feriado</span> (vermelho, sem aula),
          <span class="chip-cat aula">dia de aula</span> (azul — uma reposição, por exemplo) ou <span class="chip-cat atividade">outra atividade</span>
          (amarelo — exame de pele, capacitação da equipe). Uma data cadastrada <b>só para um dia</b> vale mais que a que se repete todo ano:
          é assim que se diz “este ano, no São João, tem aula”. Os feriados nacionais, de Pernambuco e de Caruaru já vêm cadastrados; os móveis
          seguem a Páscoa. Carnaval e Corpus Christi são ponto facultativo e ficaram de fora.</p>
        <div class="g-tabela-caixa"><table class="g-tabela"><thead><tr><th>Data</th><th>Tipo</th><th>Quando</th><th>Em ${ano}</th><th>Esfera</th><th></th></tr></thead>
        <tbody>${fer.feriados.map((f) => `<tr><td><b>${e(f.nome)}</b></td>
          <td class="nw"><span class="chip-cat ${e(f.categoria)}">${e((CATEGORIA[f.categoria] || CATEGORIA.feriado).rotulo)}</span></td>
          <td class="nw">${e(regra(f))}</td><td>${e(f.data_no_ano || "—")}</td>
          <td>${f.categoria === "feriado" ? e(f.esfera) : '<span class="fraco">—</span>'}</td>
          <td class="acoes"><button class="btn btn-ghost btn-sm" data-cf="editar-feriado" data-id="${f.id}">Editar</button>
          <button class="btn btn-danger btn-sm" data-cf="apagar-feriado" data-id="${f.id}">Apagar</button></td></tr>`).join("")}</tbody></table></div></div>

      <div class="card mt"><h3 style="margin:0 0 .2rem">Condições da matrícula</h3>
        <p class="hint">O texto que sai no fim da <b>ficha impressa</b>, antes da assinatura. Não aparece no formulário do site.</p>
        <div id="cfg-cond" class="mt">${editorRico('data-ed="condicoes"', cfg.condicoes, true)}</div>
        <button class="btn btn-navy btn-sm mt" data-cf="condicoes">Salvar condições</button></div>`;

    P.onclick = async (ev) => {
      const b = ev.target.closest("[data-cf]"); if (!b) return;
      try {
        if (b.dataset.cf === "dias") {
          const dias = $$("#cfg-dias input:checked").map((i) => Number(i.value));
          await api("/api/gestao/config", "PUT", { dias_aula: dias }); toast("Dias de aula salvos.");
        }
        if (b.dataset.cf === "condicoes") {
          const inp = $('#cfg-cond input[type=hidden]'); edSync(inp.id);
          await api("/api/gestao/config", "PUT", { condicoes: inp.value }); toast("Condições da matrícula salvas.");
        }
        if (b.dataset.cf === "apagar-feriado") {
          const f = fer.feriados.find((x) => x.id === Number(b.dataset.id));
          if (!confirm(`Apagar a data ${f.nome}?`)) return;
          await api(`/api/gestao/feriados/${f.id}`, "DELETE"); toast("Data apagada."); telaConfig();
        }
        if (b.dataset.cf === "novo-feriado" || b.dataset.cf === "editar-feriado") formData(fer.feriados.find((x) => x.id === Number(b.dataset.id)), telaConfig);
      } catch (err) { toast(err.message, true); }
    };
  }

  /* Uma data do calendário. `f` com id edita; sem id (ou nulo) cria — e
     `presetado` é o clique num dia da agenda, que já traz a data. */
  function formData(f, depois, presetado = false) {
    const editando = !!(f && f.id);
    const x = f || { categoria: "feriado", tipo: "anual", esfera: "academia" };
    const cat = x.categoria || "feriado";
    abrir($("#dlg-pequeno"), `<form id="f-fer">${cab(editando ? "Editar data" : presetado ? `Nova data em ${dataBR(x.data)}` : "Nova data no calendário")}<div class="g-dlg-corpo">
      <label>O que é este dia</label>
      <div class="g-cats" id="fer-cat">${Object.entries(CATEGORIA).map(([k, v]) =>
        `<label class="chip-cat ${k}"><input type="radio" name="categoria" value="${k}"${k === cat ? " checked" : ""}> ${v.rotulo}<small>${v.dica}</small></label>`).join("")}</div>
      <label class="obrig">Nome</label><input name="nome" value="${e(x.nome || "")}" maxlength="80" required
        placeholder="ex.: Exame de pele, Capacitação da equipe de natação, Reposição de aula">
      <div data-so="feriado"><label>Esfera</label><select name="esfera">${["nacional", "estadual", "municipal", "academia"].map((s) =>
        `<option value="${s}"${s === x.esfera ? " selected" : ""}>${s === "academia" ? "da academia (recesso…)" : s}</option>`).join("")}</select></div>
      <label>Como se repete</label><select name="tipo" id="fer-tipo">
        <option value="data"${x.tipo === "data" ? " selected" : ""}>Uma data só</option>
        <option value="anual"${x.tipo === "anual" ? " selected" : ""}>Todo ano, no mesmo dia</option>
        <option value="pascoa"${x.tipo === "pascoa" ? " selected" : ""}>Relativo à Páscoa (móvel)</option></select>
      <div class="gf" data-t="anual"><div class="c6"><label>Dia</label><input type="number" min="1" max="31" name="dia" value="${x.dia || ""}"></div>
        <div class="c6"><label>Mês</label><select name="mes">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === x.mes ? " selected" : ""}>${m}</option>`).join("")}</select></div></div>
      <div data-t="data"><label>Data</label><input type="date" name="data" value="${e(x.data || "")}"></div>
      <div data-t="pascoa"><label>Dias em relação à Páscoa</label><input type="number" name="pascoa" value="${x.pascoa ?? ""}" placeholder="ex.: −2 (Sexta-feira Santa), −47 (Carnaval), 60 (Corpus Christi)"></div>
    </div><div class="g-dlg-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button><button class="btn btn-navy">Salvar</button></div></form>`);
    const F = $("#f-fer");
    const mostrar = () => {
      $$("[data-t]", F).forEach((el) => { el.hidden = el.dataset.t !== $("#fer-tipo").value; });
      const c = F.categoria.value;
      $$("[data-so]", F).forEach((el) => { el.hidden = el.dataset.so !== c; });
    };
    $("#fer-tipo").onchange = mostrar;
    $("#fer-cat").onchange = mostrar;
    mostrar();
    F.onsubmit = async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target));
      try {
        await api(editando ? `/api/gestao/feriados/${f.id}` : "/api/gestao/feriados", editando ? "PUT" : "POST", d);
        $("#dlg-pequeno").close(); toast("Data salva."); depois().catch((err) => toast(err.message, true));
      } catch (err) { toast(err.message, true); }
    };
  }

  /* ==========================================================================
     AUDITORIA DO SISTEMA (administrador) — quem fez o quê, e quando
     ========================================================================== */
  async function telaAuditoria() {
    const P = $("#p-g-auditoria");
    const F = G.aud || (G.aud = { usuario: "", de: "", ate: "", q: "" });
    const titulo = '<div class="topbar"><h1>Auditoria do sistema</h1></div>';
    const por = porPaginaSalvo("auditoria");
    let pag;
    try { pag = await api(`/api/gestao/auditoria?${new URLSearchParams({ ...F, pagina: G.pagAud || 1, por })}`); }
    catch (err) { P.innerHTML = `${titulo}<p class="g-vazio">${e(err.message)}</p>`; return; }

    const resultado = (s) => s >= 200 && s < 300 ? '<span class="selo selo--ativo">feito</span>'
      : s >= 400 && s < 500 ? `<span class="selo selo--pendente" title="O sistema recusou (${s})">recusado</span>`
        : `<span class="selo selo--inativo" title="Erro ${s}">erro</span>`;
    const linha = (l) => `<tr><td class="nw">${e(l.em_txt)}</td><td>${e(l.usuario || "—")}</td>
      <td>${e(l.acao)}</td><td>${e(l.alvo || "")}</td><td>${resultado(l.status)}</td><td class="cod">${e(l.ip || "")}</td></tr>`;

    P.innerHTML = `${titulo}
      <p class="hint mb">Tudo o que a equipe altera no sistema fica registrado aqui — cadastros, contratos, configurações, o site — além de
        entradas no sistema e impressões de ficha, contrato e relatório. <b>Ninguém apaga nem edita este registro</b>, nem o administrador:
        o próprio banco recusa. Pré-matrículas do site entram sem o endereço de internet de quem enviou.</p>
      <form class="g-barra g-aud-filtros" id="aud-f">
        <select name="usuario"><option value="">Todas as pessoas</option>${pag.usuarios.map((u) =>
          `<option value="${u.id}"${String(u.id) === String(F.usuario) ? " selected" : ""}>${e(u.nome)} (${e(u.login)})</option>`).join("")}</select>
        <label>de <input type="date" name="de" value="${e(F.de)}"></label>
        <label>até <input type="date" name="ate" value="${e(F.ate)}"></label>
        <input type="search" name="q" value="${e(F.q)}" placeholder="Buscar ação, aluno, pessoa…">
        <button class="btn btn-navy btn-sm">Filtrar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-aud="limpar">Limpar</button>
      </form>
      <div class="g-tabela-caixa">${pag.itens.length ? `<table class="g-tabela g-aud" data-paginacao="servidor"><thead><tr><th>Quando</th><th>Quem</th><th>O que</th>
        <th>Sobre</th><th>Resultado</th><th>Endereço (IP)</th></tr></thead><tbody id="aud-linhas">${pag.itens.map(linha).join("")}</tbody></table>`
        : '<p class="g-vazio">Nenhum registro com esse filtro.</p>'}</div>
      <div id="aud-pag"></div>`;

    barraPaginas($("#aud-pag"), { total: pag.total, pagina: pag.pagina, por: pag.por, ir: (pagina, n) => {
      if (n !== por) salvarPorPagina("auditoria", n);
      G.pagAud = pagina; telaAuditoria().catch((err) => toast(err.message, true));
    } });
    $("#aud-f").onsubmit = (ev) => {
      ev.preventDefault();
      G.aud = Object.fromEntries(new FormData(ev.target)); G.pagAud = 1;
      telaAuditoria().catch((err) => toast(err.message, true));
    };
    P.onclick = async (ev) => {
      const b = ev.target.closest("[data-aud]"); if (!b) return;
      if (b.dataset.aud === "limpar") { G.aud = null; G.pagAud = 1; return telaAuditoria().catch((err) => toast(err.message, true)); }
    };
  }

  /* ==========================================================================
     SOBRE O SISTEMA — versão atual e o histórico, lido do CHANGELOG
     ========================================================================== */
  async function telaSobre() {
    const P = $("#p-g-sobre");
    const s = await api("/api/gestao/sobre");
    /* `v.html` já vem pronto e ESCAPADO do servidor (gestao/sobre.js): o
       conversor de markdown de lá não deixa passar HTML escrito no arquivo. */
    P.innerHTML = `<div class="topbar"><h1>Sobre o sistema</h1></div>
      <div class="card sobre-cab">
        <img src="/assets/img/favicon.svg" alt="" width="56" height="56">
        <div>
          <h2>${e(s.sistema)}</h2>
          <p class="sobre-versao">Versão <b>v${e(s.versao)}</b>${s.versoes[0] && s.versoes[0].versao === s.versao ? ` · de ${e(s.versoes[0].data)}` : ""}</p>
          <dl class="sobre-dados">
            <dt>No ar desde</dt><dd>${e(s.no_ar_desde)} <small class="fraco">(última vez que o servidor foi iniciado)</small></dd>
            <dt>Plataforma</dt><dd>Node.js ${e(s.node)} · banco SQLite (${e(s.banco)})</dd>
            <dt>Desenvolvido por</dt><dd><a href="https://luizaugust.me" target="_blank" rel="noopener">LA Software House</a></dd>
          </dl>
        </div>
      </div>
      <div class="card mt"><h3 style="margin:0 0 .6rem">Histórico de versões</h3>
        <p class="hint mb">O que mudou em cada atualização, da mais nova para a mais antiga.</p>
        ${s.versoes.length ? s.versoes.map((v, i) => `<details class="sobre-v"${i === 0 ? " open" : ""}>
          <summary><b>v${e(v.versao)}</b> <span class="fraco">${e(v.data)}</span>${v.titulo ? ` — ${e(v.titulo)}` : ""}</summary>
          <div class="sobre-corpo">${v.html}</div></details>`).join("") : '<p class="g-vazio">O histórico de versões não foi encontrado no servidor.</p>'}
      </div>`;
  }

  /* ==========================================================================
     USUÁRIOS DO SISTEMA (administrador)
     ========================================================================== */
  async function telaUsuarios() {
    const P = $("#p-g-usuarios");
    let lista;
    try { lista = (await api("/api/gestao/usuarios")).usuarios; }
    catch (err) { P.innerHTML = `<div class="topbar"><h1>Usuários do sistema</h1></div><p class="g-vazio">${e(err.message)}</p>`; return; }
    P.innerHTML = `<div class="topbar"><h1>Usuários do sistema</h1><button class="btn btn-mint" data-us="novo">+ Novo usuário</button></div>
      <p class="hint mb">Cada pessoa com o seu login: é o nome dela que aparece em “gerado por” no histórico de contratos.
        Administrador também gerencia usuários; os demais usam todo o resto do sistema.</p>
      <div class="g-tabela-caixa"><table class="g-tabela"><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Status</th><th>Criado em</th><th></th></tr></thead>
      <tbody>${lista.map((u) => `<tr><td><b>${e(u.nome)}</b>${u.id === (window.EU || {}).id ? ' <span class="selo selo--site">você</span>' : ""}</td>
        <td class="cod">${e(u.login)}</td><td>${u.admin ? "Administrador" : "Secretaria"}</td>
        <td><span class="selo selo--${u.ativo ? "ativo" : "inativo"}">${u.ativo ? "ativo" : "inativo"}</span></td><td>${e(u.criado_txt)}</td>
        <td class="acoes"><button class="btn btn-ghost btn-sm" data-us="editar" data-id="${u.id}">Editar</button>
          <button class="btn btn-ghost btn-sm" data-us="senha" data-id="${u.id}">Redefinir senha</button></td></tr>`).join("")}</tbody></table></div>`;

    P.onclick = (ev) => {
      const b = ev.target.closest("[data-us]"); if (!b) return;
      const u = lista.find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.us === "senha") {
        abrir($("#dlg-pequeno"), `<form id="f-us">${cab(`Nova senha para ${u.nome}`)}<div class="g-dlg-corpo">
          <label class="obrig">Nova senha (mínimo 8 caracteres)</label><input type="password" name="senha" autocomplete="new-password" minlength="8" required>
          <p class="hint mt">As sessões abertas dessa pessoa são encerradas.</p></div>
          <div class="g-dlg-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button><button class="btn btn-navy">Salvar</button></div></form>`);
        $("#f-us").onsubmit = async (evt) => {
          evt.preventDefault();
          try { await api(`/api/gestao/usuarios/${u.id}/senha`, "POST", { senha: evt.target.senha.value }); $("#dlg-pequeno").close(); toast("Senha redefinida."); }
          catch (err) { toast(err.message, true); }
        };
        return;
      }
      const x = u || { ativo: 1, admin: 0 };
      abrir($("#dlg-pequeno"), `<form id="f-us">${cab(u ? "Editar usuário" : "Novo usuário")}<div class="g-dlg-corpo">
        <label class="obrig">Nome</label><input name="nome" value="${e(x.nome || "")}" maxlength="80" required>
        ${u ? `<label>Usuário</label><input value="${e(u.login)}" disabled>` : `<label class="obrig">Usuário (login)</label>
          <input name="login" maxlength="40" required pattern="[a-z0-9._-]{3,40}" placeholder="ex.: maria.secretaria" autocomplete="off">
          <label class="obrig">Senha (mínimo 8 caracteres)</label><input type="password" name="senha" minlength="8" required autocomplete="new-password">`}
        <label class="gf-check"><input type="checkbox" name="admin"${x.admin ? " checked" : ""}> Administrador (gerencia usuários)</label>
        ${u ? `<label class="gf-check"><input type="checkbox" name="ativo"${x.ativo ? " checked" : ""}> Ativo (desmarcar tira o acesso na hora)</label>` : ""}
      </div><div class="g-dlg-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button><button class="btn btn-navy">Salvar</button></div></form>`);
      $("#f-us").onsubmit = async (evt) => {
        evt.preventDefault();
        const f = evt.target, d = Object.fromEntries(new FormData(f));
        d.admin = f.admin.checked; if (u) d.ativo = f.ativo.checked;
        try {
          await api(u ? `/api/gestao/usuarios/${u.id}` : "/api/gestao/usuarios", u ? "PUT" : "POST", d);
          $("#dlg-pequeno").close(); toast("Usuário salvo."); telaUsuarios();
        } catch (err) { toast(err.message, true); }
      };
    };
  }
})();
