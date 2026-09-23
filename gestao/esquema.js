/* ==========================================================================
   gestao/esquema.js — as tabelas da gestão da academia

   Mora no MESMO banco do site (data/site.db), de propósito: um arquivo só
   para o backup diário levar, uma cópia só para o deploy proteger, e o
   `VACUUM INTO` que já existe cobre tudo sem uma linha nova.

   Tudo aqui é idempotente: roda a cada subida do servidor e só cria o que
   falta. As SEMENTES (feriados, modelo do contrato, condições da matrícula)
   seguem a regra de semeadura do parque — criam UMA vez e nunca mais tocam.
   Um feriado que a secretaria apagou não pode ressuscitar no próximo deploy,
   e um contrato que a direção reescreveu não pode voltar ao texto de fábrica.
   ========================================================================== */
"use strict";

const { MODELO_CONTRATO, CONDICOES_MATRICULA } = require("./textos-iniciais");

/* O código de matrícula continua a numeração do sistema anterior da academia:
   os cadastros antigos vão até 4148 (ajustado na 1.24.2 — era 4147). */
const CODIGO_INICIAL = 4149;

/* Terça, quarta e sexta: os dias em que a academia funciona hoje, conforme a
   cláusula 2ª do contrato. 0 = domingo … 6 = sábado, como o Date do JS. */
const DIAS_AULA_PADRAO = [2, 3, 5];

function instalar({ db, getS, setS, hashSenha }) {
  const agora = new Date().toISOString();

  db.exec(`
    /* ------------------------------------------------------------ usuários
       Até a 1.19 o painel tinha uma senha só. A gestão precisa saber QUEM fez
       cada coisa — o histórico de contratos pede "quem gerou" —, e com uma
       conta única a resposta seria sempre "admin". */
    CREATE TABLE IF NOT EXISTS usuarios (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT NOT NULL,
      login     TEXT NOT NULL UNIQUE COLLATE NOCASE,
      senha     TEXT NOT NULL,
      admin     INTEGER NOT NULL DEFAULT 0,
      ativo     INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS g_atividades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome        TEXT NOT NULL,
      descricao   TEXT NOT NULL DEFAULT '',
      mensalidade INTEGER NOT NULL DEFAULT 0,     -- em centavos: dinheiro não é float
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_em   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS g_turmas (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      atividade_id INTEGER NOT NULL REFERENCES g_atividades(id),
      horario      TEXT NOT NULL,                  -- 'HH:MM'
      horario_fim  TEXT NOT NULL DEFAULT '',
      vagas        INTEGER NOT NULL DEFAULT 0,     -- 0 = sem limite
      professor    TEXT NOT NULL DEFAULT '',
      observacao   TEXT NOT NULL DEFAULT '',
      publica      INTEGER NOT NULL DEFAULT 1,     -- aparece no formulário do site
      ativo        INTEGER NOT NULL DEFAULT 1,
      criado_em    TEXT NOT NULL
    );

    /* -------------------------------------------------------------- alunos
       status: 'pendente' (chegou pelo site, ainda sem código), 'ativo' ou
       'inativo'. O código só nasce na efetivação — senão um formulário de
       spam queimaria números da sequência, e a numeração existe para bater
       com os cadastros antigos. */
    CREATE TABLE IF NOT EXISTS g_alunos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo             INTEGER UNIQUE,
      status             TEXT NOT NULL DEFAULT 'ativo',
      origem             TEXT NOT NULL DEFAULT 'sistema',
      nome               TEXT NOT NULL,
      sexo               TEXT NOT NULL DEFAULT '',
      nascimento         TEXT NOT NULL DEFAULT '',
      estado_civil       TEXT NOT NULL DEFAULT '',
      nacionalidade      TEXT NOT NULL DEFAULT 'Brasileira',
      rg                 TEXT NOT NULL DEFAULT '',
      rg_emissor         TEXT NOT NULL DEFAULT '',
      cpf                TEXT NOT NULL DEFAULT '',
      email              TEXT NOT NULL DEFAULT '',
      profissao          TEXT NOT NULL DEFAULT '',
      fone1              TEXT NOT NULL DEFAULT '',
      fone2              TEXT NOT NULL DEFAULT '',
      instagram          TEXT NOT NULL DEFAULT '',
      logradouro         TEXT NOT NULL DEFAULT '',
      numero             TEXT NOT NULL DEFAULT '',
      complemento        TEXT NOT NULL DEFAULT '',
      bairro             TEXT NOT NULL DEFAULT '',
      cidade             TEXT NOT NULL DEFAULT '',
      uf                 TEXT NOT NULL DEFAULT '',
      cep                TEXT NOT NULL DEFAULT '',
      pai                TEXT NOT NULL DEFAULT '',
      mae                TEXT NOT NULL DEFAULT '',
      resp_nome          TEXT NOT NULL DEFAULT '',
      resp_nacionalidade TEXT NOT NULL DEFAULT 'Brasileira',
      resp_cpf           TEXT NOT NULL DEFAULT '',
      resp_rg            TEXT NOT NULL DEFAULT '',
      resp_rg_emissor    TEXT NOT NULL DEFAULT '',
      resp_nascimento    TEXT NOT NULL DEFAULT '',
      resp_fone          TEXT NOT NULL DEFAULT '',
      resp_profissao     TEXT NOT NULL DEFAULT '',
      resp_estado_civil  TEXT NOT NULL DEFAULT '',
      resp_end_trabalho  TEXT NOT NULL DEFAULT '',
      resp_fone_trabalho TEXT NOT NULL DEFAULT '',
      turma_id           INTEGER REFERENCES g_turmas(id),
      horario_desejado   TEXT NOT NULL DEFAULT '',
      mensalidade        INTEGER NOT NULL DEFAULT 0,
      data_matricula     TEXT NOT NULL DEFAULT '',
      observacao         TEXT NOT NULL DEFAULT '',
      foto_id            INTEGER,
      consentimento      TEXT NOT NULL DEFAULT '',
      criado_em          TEXT NOT NULL,
      criado_por         TEXT NOT NULL DEFAULT '',
      atualizado_em      TEXT NOT NULL DEFAULT '',
      atualizado_por     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS g_alunos_status ON g_alunos(status);
    CREATE INDEX IF NOT EXISTS g_alunos_nome   ON g_alunos(nome);

    /* -------------------------------------------------------- professores
       (1.23.0) Até aqui o professor era um texto digitado em cada turma —
       "Ronaldo", "ronaldo", "Prof. Ronaldo" viravam três pessoas. Agora é um
       cadastro, e turma e matrícula apontam para ele. */
    CREATE TABLE IF NOT EXISTS g_professores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nome       TEXT NOT NULL,
      cref       TEXT NOT NULL DEFAULT '',     -- registro no conselho (CREF)
      telefone   TEXT NOT NULL DEFAULT '',
      email      TEXT NOT NULL DEFAULT '',
      observacao TEXT NOT NULL DEFAULT '',
      ativo      INTEGER NOT NULL DEFAULT 1,
      criado_em  TEXT NOT NULL
    );

    /* --------------------------------------------------------- matrículas
       Desde a 1.22.0 um aluno pode fazer MAIS DE UMA atividade: natação às
       06h e hidroginástica às 07h. Cada linha é uma turma daquele aluno, com
       a mensalidade dela. O total vai para g_alunos.mensalidade (é o valor do
       contrato), recalculado sempre que as matrículas mudam. A coluna antiga
       g_alunos.turma_id fica só como passado: nada mais a lê. */
    CREATE TABLE IF NOT EXISTS g_matriculas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id    INTEGER NOT NULL REFERENCES g_alunos(id),
      turma_id    INTEGER NOT NULL REFERENCES g_turmas(id),
      mensalidade INTEGER NOT NULL DEFAULT 0,   -- em centavos
      dias        TEXT NOT NULL DEFAULT '[]',   -- os dias DESTE aluno nesta atividade, 0=dom … 6=sáb
      criado_em   TEXT NOT NULL,
      UNIQUE(aluno_id, turma_id)
    );
    CREATE INDEX IF NOT EXISTS g_matriculas_turma ON g_matriculas(turma_id);

    /* ------------------------------------------------------------ arquivos
       Foto do aluno e assinaturas escaneadas moram DENTRO do banco, e não em
       pasta. As fotos do painel vão para assets/img/uploads/, que o site
       serve a qualquer um: foto de criança e assinatura do diretor não podem
       estar a um endereço de distância. No banco elas só saem por uma rota
       que exige login — e vão junto no backup diário sem linha nova. */
    CREATE TABLE IF NOT EXISTS g_arquivos (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo      TEXT NOT NULL,                     -- 'foto' | 'assinatura' | 'comprovante'
      mime      TEXT NOT NULL,
      dados     BLOB NOT NULL,
      criado_em TEXT NOT NULL,
      criado_por TEXT NOT NULL DEFAULT ''
    );

    /* ------------------------------------------------------------ contrato
       Cada edição do modelo é uma VERSÃO nova, nunca uma sobrescrita: quem
       quiser saber com que texto um contrato de março foi gerado encontra. */
    CREATE TABLE IF NOT EXISTS g_contrato_modelos (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      texto     TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      criado_por TEXT NOT NULL
    );

    /* O contrato gerado guarda o HTML PRONTO, e não uma referência ao modelo
       e aos dados do aluno. Se guardasse a receita, editar o modelo ou o
       endereço do aluno reescreveria o passado — e um contrato assinado que
       muda de texto depois não vale nada. */
    CREATE TABLE IF NOT EXISTS g_contratos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id     INTEGER NOT NULL REFERENCES g_alunos(id),
      modelo_id    INTEGER NOT NULL REFERENCES g_contrato_modelos(id),
      html         TEXT NOT NULL,
      gerado_em    TEXT NOT NULL,
      gerado_por   TEXT NOT NULL,
      assinado     INTEGER NOT NULL DEFAULT 0,
      assinado_em  TEXT NOT NULL DEFAULT '',
      assinado_por TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS g_contratos_aluno ON g_contratos(aluno_id);

    /* ------------------------------------------------------------ feriados
       Três jeitos de um feriado acontecer, e cada um guarda o que precisa:
         'anual'  — mesmo dia todo ano (dia + mes)
         'data'   — uma vez só (data)
         'pascoa' — móvel, a N dias da Páscoa (sexta-feira santa = -2)
       Guardar a REGRA, e não a data de cada ano, é o que faz a agenda de 2031
       já sair certa sem ninguém recadastrar nada. */
    CREATE TABLE IF NOT EXISTS g_feriados (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT NOT NULL,
      esfera    TEXT NOT NULL DEFAULT 'academia',  -- nacional|estadual|municipal|academia
      tipo      TEXT NOT NULL,
      dia       INTEGER, mes INTEGER, data TEXT, pascoa INTEGER,
      criado_em TEXT NOT NULL
    );

    /* ----------------------------------------------------------- auditoria
       Uma linha por ação da equipe (e por pré-matrícula recebida). Só de
       acréscimo: os gatilhos logo abaixo recusam UPDATE e DELETE. */
    CREATE TABLE IF NOT EXISTS g_auditoria (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      em         TEXT NOT NULL,
      usuario_id INTEGER,
      usuario    TEXT NOT NULL DEFAULT '',   -- nome e login DO MOMENTO: renomear depois não reescreve o passado
      acao       TEXT NOT NULL,
      alvo       TEXT NOT NULL DEFAULT '',
      metodo     TEXT NOT NULL DEFAULT '',
      rota       TEXT NOT NULL DEFAULT '',
      status     INTEGER NOT NULL DEFAULT 0,
      ip         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS g_auditoria_em      ON g_auditoria(em);
    CREATE INDEX IF NOT EXISTS g_auditoria_usuario ON g_auditoria(usuario_id);
  `);

  /* O calendário deixou de ser só de feriado (1.21.0): cada data diz o que o
     dia É — 'feriado' (vermelho, sem aula), 'aula' (azul: dia de aula fora da
     regra, como uma reposição) ou 'atividade' (amarelo: exame de pele,
     capacitação da equipe). O ALTER só roda em banco que ainda não tem a
     coluna, e as linhas que já existiam ficam como 'feriado' — é o que eram. */
  if (!db.prepare("PRAGMA table_info(g_feriados)").all().some((c) => c.name === "categoria"))
    db.exec("ALTER TABLE g_feriados ADD COLUMN categoria TEXT NOT NULL DEFAULT 'feriado'");

  /* O professor da turma e, se diferente, o da matrícula (1.23.0). NULL na
     matrícula quer dizer "o da turma". A coluna de texto g_turmas.professor
     fica só como passado: nada mais a lê. */
  const temColuna = (tabela, coluna) => db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!temColuna("g_turmas", "professor_id")) db.exec("ALTER TABLE g_turmas ADD COLUMN professor_id INTEGER REFERENCES g_professores(id)");
  if (!temColuna("g_matriculas", "professor_id")) db.exec("ALTER TABLE g_matriculas ADD COLUMN professor_id INTEGER REFERENCES g_professores(id)");

  /* ==========================================================================
     BOLETOS (1.26.0)

     O dia de vencimento é de CADA aluno (decisão da academia em 16/09/2026),
     como a cláusula 9ª pressupõe. 0 = não informado: vale o dia da matrícula.

     Um boleto é uma linha, e a linha nasce ANTES de ir ao banco, já com o
     nosso número (ver gestao/cobranca.js). Situações:
       registrando  o pedido saiu e a resposta não voltou — pode existir no banco
       aberto       registrado, esperando pagamento
       pago         o banco informou a liquidação
       baixado      cancelado a pedido da academia
       recusado     o banco disse não (dado inválido); pode ser tentado de novo
     ========================================================================== */
  if (!temColuna("g_alunos", "dia_vencimento")) db.exec("ALTER TABLE g_alunos ADD COLUMN dia_vencimento INTEGER NOT NULL DEFAULT 0");

  /* (1.27.0) O comprovante de pagamento que vem com a matrícula do site.
     Coluna separada de `foto_id` de propósito: são dois documentos com vidas
     diferentes — a foto identifica o aluno e fica enquanto ele for aluno; o
     comprovante prova UM pagamento e a secretaria troca ou tira quando
     confere. Guardá-los na mesma coluna obrigaria a escolher qual perder.
     Como a foto, o arquivo mora em g_arquivos (BLOB no banco) e nunca no
     disco público: nada em /var/www vira endereço que alguém adivinha. */
  if (!temColuna("g_alunos", "comprovante_id")) db.exec("ALTER TABLE g_alunos ADD COLUMN comprovante_id INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS g_boletos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id          INTEGER NOT NULL REFERENCES g_alunos(id),
      ambiente          TEXT NOT NULL,                       -- producao | sandbox
      competencia       TEXT NOT NULL,                       -- 'AAAA-MM'
      vencimento        TEXT NOT NULL,
      valor             INTEGER NOT NULL,                    -- centavos
      seu_numero        TEXT NOT NULL,
      nn_ano            INTEGER NOT NULL,
      nn_seq            INTEGER NOT NULL,
      nosso_numero      TEXT NOT NULL,
      situacao          TEXT NOT NULL DEFAULT 'registrando',
      situacao_banco    TEXT NOT NULL DEFAULT '',
      linha_digitavel   TEXT NOT NULL DEFAULT '',
      codigo_barras     TEXT NOT NULL DEFAULT '',
      txid              TEXT NOT NULL DEFAULT '',
      qr_code           TEXT NOT NULL DEFAULT '',
      pagador_nome      TEXT NOT NULL DEFAULT '',
      pagador_documento TEXT NOT NULL DEFAULT '',
      multa_percentual  REAL NOT NULL DEFAULT 0,
      juros_dia         INTEGER NOT NULL DEFAULT 0,         -- centavos por dia
      tentativas        INTEGER NOT NULL DEFAULT 0,
      erro              TEXT NOT NULL DEFAULT '',
      pago_em           TEXT NOT NULL DEFAULT '',
      valor_pago        INTEGER NOT NULL DEFAULT 0,
      criado_em         TEXT NOT NULL,
      criado_por        TEXT NOT NULL DEFAULT '',
      atualizado_em     TEXT NOT NULL DEFAULT '',
      baixado_em        TEXT NOT NULL DEFAULT '',
      baixado_por       TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS g_boletos_aluno ON g_boletos(aluno_id);
    /* O nosso número é a chave do boleto NO BANCO: repetido, dois boletos
       seriam o mesmo título para o Sicredi. */
    CREATE UNIQUE INDEX IF NOT EXISTS g_boletos_nn ON g_boletos(ambiente, nosso_numero);
    /* UM BOLETO VIVO POR ALUNO POR MÊS — no banco, e não só na tela. Dois
       cliques em "Gerar carnê", duas abas abertas ou duas secretarias ao mesmo
       tempo esbarram aqui, e o aluno não recebe duas cobranças de outubro.
       O baixado não conta: cancelar e gerar de novo com outro valor é legítimo. */
    CREATE UNIQUE INDEX IF NOT EXISTS g_boletos_mes ON g_boletos(ambiente, aluno_id, competencia)
      WHERE situacao <> 'baixado';
    /* Cobrança emitida é registro financeiro: não se apaga, só se baixa. */
    CREATE TRIGGER IF NOT EXISTS g_boletos_sem_apagar
      BEFORE DELETE ON g_boletos
      BEGIN SELECT RAISE(ABORT, 'boleto não pode ser apagado; peça a baixa'); END;
  `);

  /* ==========================================================================
     AS TRAVAS DO CONTRATO — no banco, e não na tela

     A tela não oferece botão para editar um contrato gerado. Isso não basta:
     uma rota escrita amanhã, um script de manutenção, um UPDATE feito à mão
     no servidor passariam por cima. O gatilho recusa em QUALQUER caminho.

     Só o estado de assinatura pode mudar — e ele é justamente o que não faz
     parte do documento.
     ========================================================================== */
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS g_contratos_imutavel
      BEFORE UPDATE OF aluno_id, modelo_id, html, gerado_em, gerado_por ON g_contratos
      BEGIN SELECT RAISE(ABORT, 'contrato gerado não pode ser alterado'); END;
    CREATE TRIGGER IF NOT EXISTS g_contratos_sem_apagar
      BEFORE DELETE ON g_contratos
      BEGIN SELECT RAISE(ABORT, 'contrato gerado não pode ser apagado'); END;
    CREATE TRIGGER IF NOT EXISTS g_modelos_imutavel
      BEFORE UPDATE ON g_contrato_modelos
      BEGIN SELECT RAISE(ABORT, 'versão do modelo não pode ser alterada; salve uma nova'); END;
    CREATE TRIGGER IF NOT EXISTS g_modelos_sem_apagar
      BEFORE DELETE ON g_contrato_modelos
      BEGIN SELECT RAISE(ABORT, 'versão do modelo não pode ser apagada'); END;
    CREATE TRIGGER IF NOT EXISTS g_auditoria_imutavel
      BEFORE UPDATE ON g_auditoria
      BEGIN SELECT RAISE(ABORT, 'registro de auditoria não pode ser alterado'); END;
    CREATE TRIGGER IF NOT EXISTS g_auditoria_sem_apagar
      BEFORE DELETE ON g_auditoria
      BEGIN SELECT RAISE(ABORT, 'registro de auditoria não pode ser apagado'); END;
  `);

  /* ==========================================================================
     O PRIMEIRO USUÁRIO VEM DA SENHA QUE JÁ EXISTE

     Ninguém precisa redefinir nada: a senha atual do painel vira a senha do
     usuário "admin". O hash é copiado como está — inclusive se ainda for do
     formato antigo, que o login regrava em scrypt no primeiro acerto.
     ========================================================================== */
  const temUsuario = db.prepare("SELECT COUNT(*) AS n FROM usuarios").get().n;
  if (!temUsuario) {
    const hash = getS("admin_password_hash") || hashSenha("forms-admin");
    db.prepare("INSERT INTO usuarios(nome,login,senha,admin,ativo,criado_em) VALUES(?,?,?,1,1,?)")
      .run("Administrador", "admin", hash, agora);
  }

  /* ==========================================================================
     SEMENTES — uma vez só

     Cada semente tem a sua bandeira em `settings`. A pergunta não é "a tabela
     está vazia?": uma secretaria que apagou todos os feriados de propósito
     também deixa a tabela vazia, e os feriados voltariam no deploy seguinte.
     A pergunta certa é "isto já foi semeado?".
     ========================================================================== */
  if (!getS("g_semente_feriados")) {
    const ins = db.prepare("INSERT INTO g_feriados(nome,esfera,tipo,dia,mes,data,pascoa,criado_em) VALUES(?,?,?,?,?,?,?,?)");
    for (const [nome, esfera, tipo, dia, mes, pascoa] of FERIADOS_INICIAIS)
      ins.run(nome, esfera, tipo, dia ?? null, mes ?? null, null, pascoa ?? null, agora);
    setS("g_semente_feriados", agora);
  }
  if (!getS("g_semente_contrato")) {
    db.prepare("INSERT INTO g_contrato_modelos(texto,criado_em,criado_por) VALUES(?,?,?)")
      .run(MODELO_CONTRATO, agora, "Modelo inicial");
    setS("g_semente_contrato", agora);
  }
  if (!getS("g_semente_condicoes")) {
    setS("g_condicoes", CONDICOES_MATRICULA);
    setS("g_semente_condicoes", agora);
  }
  if (!getS("g_dias_aula")) setS("g_dias_aula", JSON.stringify(DIAS_AULA_PADRAO));

  /* A turma única de cada aluno (até a 1.21) vira a primeira matrícula dele,
     com a mensalidade que ele já tinha. Uma vez só, pela bandeira: rodar de
     novo recriaria a matrícula que a secretaria tirou de propósito. */
  if (!getS("g_migracao_matriculas")) {
    /* Os dias de cada um são os dias de aula da academia, que era o que
       valia para todo mundo até aqui. */
    const dias = JSON.stringify(JSON.parse(getS("g_dias_aula") || "[]"));
    db.prepare(`INSERT OR IGNORE INTO g_matriculas(aluno_id, turma_id, mensalidade, dias, criado_em)
      SELECT al.id, al.turma_id, al.mensalidade, ?, ? FROM g_alunos al
      JOIN g_turmas t ON t.id = al.turma_id WHERE al.turma_id IS NOT NULL`).run(dias, agora);
    setS("g_migracao_matriculas", agora);
  }

  /* O nome digitado em cada turma vira um professor cadastrado — um por nome,
     sem diferença de maiúsculas ("Ronaldo" e "ronaldo" são a mesma pessoa).
     Uma vez só, pela bandeira. */
  if (!getS("g_migracao_professores")) {
    const turmas = db.prepare("SELECT id, professor FROM g_turmas WHERE professor_id IS NULL AND TRIM(professor) <> ''").all();
    const achar = db.prepare("SELECT id FROM g_professores WHERE nome = ? COLLATE NOCASE");
    const criar = db.prepare("INSERT INTO g_professores(nome, criado_em) VALUES(?, ?)");
    const ligar = db.prepare("UPDATE g_turmas SET professor_id=? WHERE id=?");
    for (const t of turmas) {
      const nome = t.professor.trim().replace(/\s+/g, " ");
      const p = achar.get(nome);
      ligar.run(p ? p.id : Number(criar.run(nome, agora).lastInsertRowid), t.id);
    }
    setS("g_migracao_professores", agora);
  }
  if (!getS("g_semente_atividades")) {
    /* Natação é a atividade de todos os cadastros de exemplo que a academia
       mostrou (ficha e contrato), com a mensalidade de R$ 110,00 que aparece
       nos dois. A secretaria ajusta — é só o ponto de partida. */
    db.prepare("INSERT INTO g_atividades(nome,descricao,mensalidade,ativo,criado_em) VALUES(?,?,?,1,?)")
      .run("Natação", "", 11000, agora);
    setS("g_semente_atividades", agora);
  }
}

/* ==========================================================================
   OS FERIADOS DE PARTIDA

   Conferidos em mais de uma fonte em 11/09/2026. Os oficiais (prefeitura de
   Caruaru e TJPE) não puderam ser lidos automaticamente — se a prefeitura
   mudar algum por lei, a tela de feriados é o lugar de ajustar.

   Carnaval e Corpus Christi ficaram DE FORA: são ponto facultativo, não
   feriado. Se a academia fecha nesses dias, a secretaria acrescenta com o
   tipo "relativo à Páscoa" (Carnaval = -47, Corpus Christi = +60).

   O 24 de junho aparece como estadual em algumas fontes e municipal em
   outras. Para uma academia em Caruaru a diferença é só o rótulo: é feriado
   de qualquer forma.
   ========================================================================== */
const FERIADOS_INICIAIS = [
  // nome, esfera, tipo, dia, mes, pascoa
  ["Confraternização Universal", "nacional", "anual", 1, 1],
  ["Sexta-feira Santa", "nacional", "pascoa", null, null, -2],
  ["Tiradentes", "nacional", "anual", 21, 4],
  ["Dia do Trabalhador", "nacional", "anual", 1, 5],
  ["Independência do Brasil", "nacional", "anual", 7, 9],
  ["Nossa Senhora Aparecida", "nacional", "anual", 12, 10],
  ["Finados", "nacional", "anual", 2, 11],
  ["Proclamação da República", "nacional", "anual", 15, 11],
  ["Dia Nacional de Zumbi e da Consciência Negra", "nacional", "anual", 20, 11],
  ["Natal", "nacional", "anual", 25, 12],
  ["Data Magna de Pernambuco", "estadual", "anual", 6, 3],
  ["Emancipação Política de Caruaru", "municipal", "anual", 18, 5],
  ["São João", "municipal", "anual", 24, 6],
  ["São Pedro", "municipal", "anual", 29, 6],
  ["Nossa Senhora das Dores — padroeira de Caruaru", "municipal", "anual", 15, 9],
];

module.exports = { instalar, CODIGO_INICIAL, DIAS_AULA_PADRAO, FERIADOS_INICIAIS };
