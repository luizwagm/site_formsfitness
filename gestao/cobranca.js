/* ==========================================================================
   gestao/cobranca.js — o carnê de boletos do aluno (1.26.0)

   Junta o cadastro do aluno, a matemática (gestao/boleto.js) e o banco
   (gestao/sicredi.js). É aqui que mora a regra que mais custa se falhar:

       NENHUM MÊS É COBRADO DUAS VEZES.

   Três travas, cada uma para um caminho diferente até a cobrança dobrada:

   1. NO BANCO DE DADOS. Um índice único deixa existir só um boleto vivo por
      aluno por mês. Dois cliques, duas abas, duas secretarias: o segundo
      esbarra no índice e o mês é pulado.

   2. O NOSSO NÚMERO NASCE AQUI, ANTES DE IR AO SICREDI. A linha é gravada
      como "registrando" com o número já escolhido. Se a rede cai depois de o
      pedido chegar ao banco e antes de a resposta voltar, a linha fica em
      "registrando" — e a próxima tentativa PERGUNTA ao banco por aquele
      número antes de registrar de novo. Se existe, adota; se não, registra.

   3. A CONFERÊNCIA DO QUE VOLTOU. Achando um boleto com o nosso número, ele só
      é adotado se o "seu número" e o valor forem os nossos. Um boleto emitido
      por outro caminho (o Internet Banking) com o mesmo número não é
      confundido com o do aluno: o número é trocado e o registro segue.
   ========================================================================== */
"use strict";

const B = require("./boleto");
const U = require("./util");

const SITUACOES_VIVAS = ["registrando", "aberto", "pago", "recusado"];

/* Texto para o banco: sem acento e sem símbolo. O manual não promete aceitar
   UTF-8 em nome e endereço, e o boleto recusado por um "ç" só aparece como
   erro genérico do lado de lá. */
const ascii = (v, max) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[^A-Za-z0-9 .,/@&'()-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const so = (v) => String(v ?? "").replace(/\D/g, "");
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const competenciaTexto = (c) => { const [a, m] = String(c).split("-"); return `${U.MESES[Number(m) - 1]}/${a}`; };

function criarCobranca({ db, cfg, sicredi, hoje = U.hojeLocal, agora = () => new Date().toISOString(), beneficiario }) {
  const um = (sql, ...a) => db.prepare(sql).get(...a);
  const todos = (sql, ...a) => db.prepare(sql).all(...a);
  const roda = (sql, ...a) => db.prepare(sql).run(...a);
  const emAndamento = new Set();        /* boletos com pedido saindo AGORA neste processo */

  /* ----------------------------------------------------- quem paga o boleto
     O mesmo critério do contrato: aluno menor paga pelo responsável. O CPF é
     obrigatório para o banco; o endereço, só se o convênio da academia
     exigir — então falta de endereço é AVISO, e falta de CPF é BLOQUEIO. */
  function pagadorDe(a) {
    const menor = U.ehMenor(a.nascimento);
    const nome = menor ? a.resp_nome : a.nome;
    const documento = so(menor ? a.resp_cpf : a.cpf);
    const bloqueios = [], avisos = [];
    if (!a.codigo) bloqueios.push("efetive a matrícula antes (o boleto leva o código do aluno)");
    if (!(a.mensalidade > 0)) bloqueios.push("a mensalidade do aluno está zerada");
    if (!nome) bloqueios.push(menor ? "falta o nome do responsável" : "falta o nome do aluno");
    if (!documento) bloqueios.push(menor ? "falta o CPF do responsável" : "falta o CPF do aluno");
    else if (!U.cpfValido(documento)) bloqueios.push(menor ? "o CPF do responsável não confere" : "o CPF do aluno não confere");
    const faltaEnd = [["logradouro", "rua"], ["numero", "número"], ["cidade", "cidade"], ["uf", "UF"], ["cep", "CEP"]]
      .filter(([c]) => !a[c]).map(([, r]) => r);
    if (faltaEnd.length) avisos.push(`o endereço está incompleto (${faltaEnd.join(", ")}) — o boleto sai sem ele`);
    return {
      menor, nome: nome || "", documento, bloqueios, avisos,
      paraBanco: {
        tipoPessoa: "PESSOA_FISICA",
        documento,
        nome: ascii(nome, 40),
        ...(faltaEnd.length ? {} : {
          endereco: ascii(`${a.logradouro}, ${a.numero}${a.complemento ? " " + a.complemento : ""}`, 40),
          cidade: ascii(a.cidade, 25), uf: String(a.uf).toUpperCase(), cep: so(a.cep).slice(0, 8),
        }),
        ...(so(menor ? a.resp_fone : a.fone1).length >= 10 ? { telefone: so(menor ? a.resp_fone : a.fone1).slice(0, 11) } : {}),
        ...(a.email && a.email.length <= 40 ? { email: a.email } : {}),
      },
    };
  }

  /* O dia do mês: o do cadastro; sem ele, o da matrícula; sem os dois, 10. */
  function diaDe(a) {
    const d = Number(a.dia_vencimento);
    if (d >= 1 && d <= 31) return d;
    const m = /^\d{4}-\d{2}-(\d{2})$/.exec(a.data_matricula || "");
    return m ? Number(m[1]) : 10;
  }

  const vivosDo = (alunoId) => todos(`SELECT * FROM g_boletos WHERE ambiente=? AND aluno_id=? AND situacao <> 'baixado'`,
    cfg.ambiente, alunoId);

  /* As parcelas que AINDA NÃO têm boleto vivo, até dezembro. */
  function previa(a) {
    const jaTem = new Set(vivosDo(a.id).map((b) => b.competencia));
    return B.parcelasAteDezembro({ hoje: hoje(), dia: diaDe(a) })
      .filter((p) => !jaTem.has(p.competencia))
      .map((p) => ({ ...p, valor: a.mensalidade, rotulo: competenciaTexto(p.competencia) }));
  }

  function listar(alunoId) {
    return todos(`SELECT * FROM g_boletos WHERE aluno_id=? AND ambiente=? ORDER BY competencia, id`, alunoId, cfg.ambiente)
      .map(publico);
  }
  const publico = (b) => ({
    id: b.id, competencia: b.competencia, rotulo: competenciaTexto(b.competencia), vencimento: b.vencimento,
    valor: b.valor, situacao: b.situacao, situacao_banco: b.situacao_banco, erro: b.erro,
    nosso_numero: B.nossoNumeroFormatado(b.nosso_numero), linha: B.linhaFormatada(b.linha_digitavel),
    pago_em: b.pago_em, valor_pago: b.valor_pago, criado_em: b.criado_em, criado_por: b.criado_por,
    baixado_em: b.baixado_em, baixado_por: b.baixado_por, imprimivel: imprimivel(b),
  });

  /* Só vai ao carnê o que está registrado, em aberto e conferido. Em produção,
     boleto que não passa na conferência NÃO é impresso: um carnê com código de
     barras errado é pior que nenhum. */
  function imprimivel(b) {
    if (b.situacao !== "aberto" || !b.codigo_barras) return false;
    if (cfg.ambiente !== "producao") return true;
    return B.conferirBoleto({ codigoBarras: b.codigo_barras, linhaDigitavel: b.linha_digitavel, valor: b.valor }).length === 0;
  }

  /* --------------------------------------------------- reservar a linha */
  const anoDeHoje = () => Number(hoje().slice(2, 4));
  function proximoNumero() {
    const ano = anoDeHoje();
    const seq = um("SELECT COALESCE(MAX(nn_seq), 0) + 1 AS s FROM g_boletos WHERE ambiente=? AND nn_ano=?", cfg.ambiente, ano).s;
    if (seq > 99999) throw new Error("Acabaram os números de boleto deste ano (99.999).");
    return { ano, seq, nosso: B.nossoNumero({ cooperativa: cfg.cooperativa, posto: cfg.posto, beneficiario: cfg.beneficiario,
      ano, byte: 2, sequencial: seq }) };
  }

  /* Cria a linha em "registrando", já com o nosso número. Devolve null se o
     mês já tem boleto vivo — é o índice único respondendo. */
  const reservar = db.transaction((a, parcela, pagador, quem) => {
    const n = proximoNumero();
    try {
      const r = roda(`INSERT INTO g_boletos(aluno_id, ambiente, competencia, vencimento, valor, seu_numero,
          nn_ano, nn_seq, nosso_numero, situacao, pagador_nome, pagador_documento, multa_percentual, juros_dia,
          criado_em, criado_por)
        VALUES(?,?,?,?,?,?,?,?,?,'registrando',?,?,?,?,?,?)`,
        a.id, cfg.ambiente, parcela.competencia, parcela.vencimento, a.mensalidade,
        /* Seu número: código do aluno (6) + AAMM = 10 caracteres, o limite. */
        String(a.codigo).padStart(6, "0").slice(-6) + parcela.competencia.slice(2, 4) + parcela.competencia.slice(5, 7),
        n.ano, n.seq, n.nosso, pagador.nome, pagador.documento, B.MULTA_PERCENTUAL, B.jurosPorDiaCentavos(a.mensalidade),
        agora(), quem);
      return um("SELECT * FROM g_boletos WHERE id=?", Number(r.lastInsertRowid));
    } catch (e) {
      /* Só o índice do MÊS vira "pular". Colisão de nosso número é defeito, e
         tem de aparecer. */
      if (/UNIQUE/.test(e.message) && /g_boletos\.competencia/.test(e.message)) return null;
      throw e;
    }
  });

  function payload(b, pagador) {
    const reais = (c) => Number((c / 100).toFixed(2));
    return {
      tipoCobranca: "HIBRIDO",                         /* boleto + QR Code Pix */
      codigoBeneficiario: cfg.beneficiario,
      pagador: pagador.paraBanco,
      especieDocumento: "DUPLICATA_SERVICO_INDICACAO",
      nossoNumero: b.nosso_numero,
      seuNumero: b.seu_numero,
      dataVencimento: b.vencimento,
      valor: reais(b.valor),
      tipoJuros: "VALOR",
      juros: reais(b.juros_dia),
      multa: b.multa_percentual,
      /* SEM diasProtestoAuto e SEM diasNegativacaoAuto: a academia decide caso
         a caso (decisão de 16/09/2026). Negativar quem pagou em dinheiro no
         balcão é dano moral. */
      mensagens: [
        ascii(`Mensalidade de ${competenciaTexto(b.competencia)} - ${beneficiario().nome}`, 80),
        ascii(`Apos o vencimento: multa de ${B.MULTA_PERCENTUAL}% e juros de ${B.JUROS_MES_PERCENTUAL}% ao mes`, 80),
      ],
    };
  }

  /* Grava o que o banco devolveu (no cadastro ou na consulta). */
  function adotar(b, d, situacaoBanco = "") {
    roda(`UPDATE g_boletos SET situacao='aberto', situacao_banco=?, linha_digitavel=?, codigo_barras=?, txid=?, qr_code=?,
        erro='', atualizado_em=? WHERE id=?`,
      situacaoBanco, so(d.linhaDigitavel), so(d.codigoBarras), String(d.txid || d.txId || ""),
      String(d.qrCode || d.codigoQrCode || "").trim(), agora(), b.id);
    const novo = um("SELECT * FROM g_boletos WHERE id=?", b.id);
    const erros = B.conferirBoleto({ codigoBarras: novo.codigo_barras, linhaDigitavel: novo.linha_digitavel, valor: novo.valor });
    if (erros.length) roda("UPDATE g_boletos SET erro=? WHERE id=?", `Conferência: ${erros.join("; ")}.`, b.id);
    if (situacaoBanco) aplicarSituacao(novo, { situacao: situacaoBanco });
    return um("SELECT * FROM g_boletos WHERE id=?", b.id);
  }

  /* O boleto do banco é o NOSSO? Mesmo "seu número" e mesmo valor. */
  const ehNosso = (b, d) => String(d.seuNumero || "").trim() === b.seu_numero
    && Math.round(Number(d.valorNominal ?? d.valor) * 100) === b.valor;

  function trocarNumero(b) {
    const n = proximoNumero();
    roda("UPDATE g_boletos SET nn_ano=?, nn_seq=?, nosso_numero=?, atualizado_em=? WHERE id=?", n.ano, n.seq, n.nosso, agora(), b.id);
    return um("SELECT * FROM g_boletos WHERE id=?", b.id);
  }

  /* ---------------------------------------------------------- registrar */
  async function registrar(b, aluno) {
    if (emAndamento.has(b.id)) return { ...b, erro: "já está sendo registrado" };
    emAndamento.add(b.id);
    try {
      const pagador = pagadorDe(aluno);
      for (let volta = 0; volta < 3; volta++) {
        /* Já houve tentativa: pergunta ao banco ANTES de registrar de novo.
           Sem resposta nem para a pergunta, a parcela fica como está — e as
           outras do carnê seguem. */
        if (b.tentativas > 0) {
          let achado;
          try { achado = await sicredi.consultar(b.nosso_numero); }
          catch (e) {
            roda("UPDATE g_boletos SET erro=?, atualizado_em=? WHERE id=?",
              `Não foi possível conferir no Sicredi: ${e.message} Tente de novo.`, agora(), b.id);
            return um("SELECT * FROM g_boletos WHERE id=?", b.id);
          }
          if (achado && ehNosso(b, achado)) return adotar(b, achado, achado.situacao || "");
          if (achado) { b = trocarNumero(b); continue; }      /* número de outro boleto */
        }
        roda("UPDATE g_boletos SET tentativas=tentativas+1, atualizado_em=? WHERE id=?", agora(), b.id);
        b = um("SELECT * FROM g_boletos WHERE id=?", b.id);
        try {
          const d = await sicredi.registrar(payload(b, pagador));
          return adotar(b, d);
        } catch (e) {
          if (e.incerto) {
            roda("UPDATE g_boletos SET situacao='registrando', erro=?, atualizado_em=? WHERE id=?",
              `${e.message} O boleto pode ter sido registrado: tente de novo, que o sistema confere antes.`, agora(), b.id);
            return um("SELECT * FROM g_boletos WHERE id=?", b.id);
          }
          /* Recusado. Pode ser o nosso número já usado por outro boleto: a
             consulta desempata. */
          const achado = await sicredi.consultar(b.nosso_numero).catch(() => null);
          if (achado && ehNosso(b, achado)) return adotar(b, achado, achado.situacao || "");
          if (achado) { b = trocarNumero(b); continue; }
          roda("UPDATE g_boletos SET situacao='recusado', erro=?, atualizado_em=? WHERE id=?",
            `O Sicredi recusou: ${e.message}`, agora(), b.id);
          return um("SELECT * FROM g_boletos WHERE id=?", b.id);
        }
      }
      roda("UPDATE g_boletos SET situacao='recusado', erro=?, atualizado_em=? WHERE id=?",
        "Não foi possível obter um nosso número livre.", agora(), b.id);
      return um("SELECT * FROM g_boletos WHERE id=?", b.id);
    } finally {
      emAndamento.delete(b.id);
    }
  }

  /* Gera as parcelas pedidas (ou todas as da prévia). Uma de cada vez, em
     ordem: o banco limita pedidos por segundo (429), e um carnê de três meses
     não justifica o risco. */
  async function gerar(aluno, competencias, quem) {
    const pagador = pagadorDe(aluno);
    if (pagador.bloqueios.length) {
      const e = new Error(`Não dá para gerar: ${pagador.bloqueios.join("; ")}.`); e.status = 400; throw e;
    }
    const candidatas = previa(aluno);
    const pedidas = Array.isArray(competencias) && competencias.length
      ? candidatas.filter((p) => competencias.includes(p.competencia)) : candidatas;
    /* Retomar o que ficou pela metade: "registrando" (sem resposta) e
       "recusado" (depois de corrigir o cadastro) voltam ao banco. */
    const pendentes = vivosDo(aluno.id).filter((b) => (b.situacao === "registrando" || b.situacao === "recusado")
      && (!competencias || !competencias.length || competencias.includes(b.competencia)));

    const resultado = [];
    for (const b of pendentes) {
      if (b.situacao === "recusado") {
        /* Recusado não chegou a existir no banco: volta com os dados do
           cadastro de agora (é para isso que a secretaria corrigiu). O que está
           "registrando" pode existir lá, e fica com os dados que foram. */
        roda("UPDATE g_boletos SET valor=?, juros_dia=?, pagador_nome=?, pagador_documento=?, situacao='registrando' WHERE id=?",
          aluno.mensalidade, B.jurosPorDiaCentavos(aluno.mensalidade), pagador.nome, pagador.documento, b.id);
      }
      resultado.push(await registrar(um("SELECT * FROM g_boletos WHERE id=?", b.id), aluno));
    }
    for (const p of pedidas) {
      const linha = reservar(aluno, p, pagador, quem);
      if (!linha) continue;                                   /* o mês já tinha boleto */
      resultado.push(await registrar(linha, aluno));
    }
    return resultado.map(publico);
  }

  /* ------------------------------------------------ a situação no banco */
  function aplicarSituacao(b, d) {
    const s = String(d.situacao || "").toUpperCase();
    let situacao = b.situacao;
    if (s.startsWith("LIQUIDADO")) situacao = "pago";
    else if (s.startsWith("BAIXADO")) situacao = "baixado";
    else if (s === "REJEITADO") situacao = "recusado";
    else if (s) situacao = "aberto";
    const liq = d.dadosLiquidacao || {};
    roda(`UPDATE g_boletos SET situacao=?, situacao_banco=?, pago_em=CASE WHEN ?<>'' THEN ? ELSE pago_em END,
        valor_pago=CASE WHEN ?>0 THEN ? ELSE valor_pago END, atualizado_em=? WHERE id=?`,
      situacao, s, String(liq.data || ""), String(liq.data || ""),
      Math.round(Number(liq.valor || 0) * 100), Math.round(Number(liq.valor || 0) * 100), agora(), b.id);
  }

  async function atualizar(alunoId) {
    const lista = todos(`SELECT * FROM g_boletos WHERE ambiente=? AND aluno_id=? AND situacao IN ('aberto','registrando')`,
      cfg.ambiente, alunoId);
    for (const b of lista) {
      const d = await sicredi.consultar(b.nosso_numero);
      if (!d) continue;
      if (b.situacao === "registrando") { if (ehNosso(b, d)) adotar(b, d, d.situacao || ""); continue; }
      aplicarSituacao(b, d);
    }
    return listar(alunoId);
  }

  async function baixar(boletoId, quem) {
    const b = um("SELECT * FROM g_boletos WHERE id=? AND ambiente=?", boletoId, cfg.ambiente);
    if (!b) { const e = new Error("Boleto não encontrado."); e.status = 404; throw e; }
    if (b.situacao === "pago") { const e = new Error("Boleto pago não se cancela."); e.status = 409; throw e; }
    if (b.situacao === "baixado") return publico(b);
    /* Recusado nunca existiu no banco: só sai da lista de vivos. */
    if (b.situacao !== "recusado") await sicredi.baixar(b.nosso_numero);
    roda("UPDATE g_boletos SET situacao='baixado', baixado_em=?, baixado_por=?, atualizado_em=? WHERE id=?",
      agora(), quem, agora(), b.id);
    return publico(um("SELECT * FROM g_boletos WHERE id=?", b.id));
  }

  const paraCarne = (alunoId, ids) => todos(`SELECT * FROM g_boletos WHERE ambiente=? AND aluno_id=? ORDER BY competencia`,
    cfg.ambiente, alunoId).filter((b) => imprimivel(b) && (!ids || ids.includes(b.id)));

  return { pagadorDe, diaDe, previa, listar, gerar, atualizar, baixar, paraCarne, competenciaTexto, SITUACOES_VIVAS, MESES_CURTOS };
}

module.exports = { criarCobranca, ascii };
