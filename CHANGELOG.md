# Changelog — Forms Fitness

Regra: **2ª casa = funcionalidade, 3ª = correção.** A primeira não muda.
(Arquivo criado na 1.17.0 — o histórico anterior vive nas mensagens do git.)

---

## 1.25.1 — 2026-09-14 · assinaturas da contratada sem fundo preto, ao lado do aluno

**O fundo preto.** A imagem das assinaturas saía no contrato dentro de um
retângulo preto. O envio passava a imagem pelo mesmo redutor das fotos, que
grava sempre em JPEG — e JPEG não tem transparência: o fundo transparente do
PNG virava preto. Agora o envio das assinaturas grava em **PNG** e respeita a
transparência. Se vier um escaneamento com papel branco (JPG ou PNG sem
transparência), o painel **tira o papel** antes de salvar: o branco vira
transparente e a tinta fica na mesma cor.

**Mais natural.** A imagem limpa foi refeita a partir do escaneamento
original, com uma tinta só (grafite azulado) e o traço claro da caneta com
mais corpo. A primeira tentativa, que separava a caneta azul do texto
impresso, ficou manchada: o scanner registrou o mesmo traço metade azul,
metade cinza. Também saíram os pontinhos de pó do scanner.

**Posição.** As assinaturas da contratada deixaram de ocupar uma faixa na
largura toda embaixo do texto. Ficam **ao lado da assinatura do aluno**,
logo abaixo de "Caruaru (PE), data". A linha do aluno desce até a altura dos
traços da imagem, e as quatro assinaturas ficam numa fileira só. A imagem tem
altura fixa (35 mm), para o ajuste de uma folha medir o contrato sem esperar
o arquivo carregar. Sem imagem cadastrada, continua como na 1.25.0: local e
data ao lado do aluno e três linhas em branco embaixo.

**Para quem já enviou a imagem:** apague a de fundo preto e envie de novo em
Contrato ▸ Assinaturas da contratada. Contrato já gerado guarda a imagem que
tinha. Se algum saiu com o fundo preto, gere de novo.

---

## 1.25.0 — 2026-09-14 · rodapé do contrato e as assinaturas da contratada

**Rodapé do contrato.** No lugar do endereço que o Word trazia no fim, o
contrato gerado sai
com **site, e-mail administrativo, Instagram e WhatsApp**. Site, Instagram e
WhatsApp vêm de Gestão do site ▸ Contato; o **e-mail administrativo** é um
campo novo em Configurações ▸ Rodapé do contrato (vazio, usa o de contato do
site). O rodapé faz parte do contrato congelado: vale para os gerados daqui em
diante, e os antigos não mudam.

**Assinaturas da contratada.** A imagem com as assinaturas do contratado
(Ronaldo José de Menezes) e das duas testemunhas foi recortada do Word e
limpa (fundo do papel transparente). Enviada em Contrato ▸ Assinaturas da
contratada, ela sai impressa em todo contrato gerado depois; só a linha do
aluno (ou do responsável) fica em aberto. **A imagem não vai para o git** — o
repositório é público —, e por isso é enviada pelo painel.

**Dados pessoais fora do repositório.** A primeira transcrição do contrato
(1.20.0) levou para o código o RG, o CPF e o endereço de correspondência do
diretor — e o repositório é público no GitHub. O modelo semente agora traz só
o nome e o cargo; a qualificação completa fica no banco (tela Contrato), que
não vai para o git. Prova nova na suíte: o modelo semente não tem CPF nem RG.
O exemplo do campo CREF deixou de usar o número real.

## 1.24.2 — 2026-09-14 · o código de matrícula começa em 004149

Os cadastros antigos da academia vão até 4148, então a numeração do sistema
começa em **004149** (era 004148). A regra de sempre continua: o próximo
código é o maior entre 4148 e o maior já cadastrado, mais um — um aluno
antigo digitado com o código dele não puxa a sequência para trás, e um código
já em uso é recusado.

## 1.24.1 — 2026-09-14 · a entrega que parou no --publicar

A entrega automática da 1.20→1.24 terminou com erro em dois pontos. O site
ficou no ar e nenhum dado se perdeu, mas as páginas não foram refeitas.
- **O `--publicar` falhou** porque desde a 1.20 carregar o `server.js`
  instalava as tabelas da gestão logo no começo — e instalar é escrever no
  banco. A entrega roda os comandos de linha como o usuário `deploy`, que no
  servidor só LÊ o banco do serviço (que roda como root). Até a 1.19 o
  `--publicar` só lia; na 1.20 passou a tentar escrever e morreu. Agora a
  instalação da gestão fica DEPOIS dos comandos de linha: quem instala é o
  serviço, ao subir. Há prova: comando de linha com banco somente-leitura e
  sem a gestão passa, e não cria tabela nenhuma.
- **"O CONTEÚDO MUDOU. Restaurando por segurança." foi alarme falso.** O
  inventário do deploy contava todas as linhas de configuração como "textos",
  e a gestão grava 8 configurações próprias ao subir (36 → 44). Agora "textos"
  conta só as do site, e o inventário passou a contar também **alunos e
  contratos** — são dados da academia que um deploy não pode sumir.
- O erro do `--publicar` agora aparece na saída da entrega, em vez de ir para
  o /dev/null.

## 1.24.0 — 2026-09-14 · tabelas maiores e paginação em todas

**Tabelas maiores na tela.** O conteúdo do painel parava em 1000px de
largura: numa tela grande as tabelas ficavam espremidas no meio, com faixa
vazia dos lados. Agora usa a largura da tela (até 1640px), com letra e
espaçamento de lista — lê-se de relance.

**Paginação em todas as tabelas.** Embaixo de cada uma: "Mostrando 1–20 de
57", os botões de página (1 … 4 5 6 … 12, nunca uma fileira de 40) e quantos
por página (10, 20, 50 ou 100 — a escolha fica lembrada por tabela).
- **Alunos e Auditoria são paginados no SERVIDOR**: são as que crescem sem
  limite. A lista de alunos antiga cortava em 500 sem avisar — com o código
  começando em 4148, a academia tem milhares de alunos no histórico.
- As demais (turmas, atividades, professores, calendário, usuários, versões e
  histórico de contratos, indicadores, Acessos) são paginadas na tela, por
  uma função só que se aplica **sozinha** a toda tabela que aparece — tabela
  criada no futuro já nasce paginada.
- Fica de fora a grade de atividades do aluno: ela é formulário, e esconder
  uma linha numa página 2 esconderia uma atividade que vai ser salva.
- Trocar filtro ou busca volta para a página 1. A Auditoria perdeu o
  "Carregar mais" — agora é página como as outras.

## 1.23.0 — 2026-09-14 · cadastro de professores

O professor deixou de ser um texto digitado em cada turma ("Ronaldo",
"ronaldo" e "Prof. Ronaldo" eram três pessoas) e virou um **cadastro**:
menu **Professores**, com nome, CREF, telefone, e-mail, observação e ativo.
- **Turma**: o campo Professor é um **select** dos professores cadastrados.
- **Atividades do aluno**: a coluna Professor também virou select. A primeira
  opção é "o da turma (Ronaldo)"; escolher outro vale só para aquele aluno
  naquela atividade. A ficha impressa mostra o professor de cada atividade.
- O nome sai **sempre do cadastro**: renomear um professor muda o nome em
  todas as turmas, fichas, relatórios e indicadores, sem cópia desatualizada.
- Nome repetido é recusado (sem diferença de maiúsculas). Professor com turma
  ou aluno não se apaga — inativa: some das listas de escolha e continua onde
  já estava.
- **Migração automática**: o nome que estava digitado em cada turma virou um
  professor cadastrado, um por pessoa ("Ronaldo" e "ronaldo" viram um só).

## 1.22.1 — 2026-09-13 · a tela confere se as atividades foram gravadas

"Criando a atividade mas não está salvando." O servidor que atendia ainda
era o de ANTES da 1.22.0 (iniciado antes da atualização): a tela, lida do
disco a cada acesso, já mandava a lista de atividades, e o servidor antigo a
descartava em silêncio — respondia "ok", a janela fechava, nada gravado.
- O servidor agora responde **quantas atividades o aluno ficou tendo**, e a
  tela confere com quantas mandou. Se não bater, ela diz: "As atividades NÃO
  foram gravadas — reinicie o servidor e salve de novo", e a janela não fecha.
- A confirmação "Cadastro salvo" sumia quando havia aviso de vaga — e também
  quando a mensagem anterior tinha sido um erro, porque a tela conferia uma
  marca que ficava presa na caixa de mensagens. Agora a confirmação sai
  sempre, com o aviso de vaga junto quando houver.

## 1.22.0 — 2026-09-13 · várias atividades por aluno, indicadores e agenda para compartilhar

**Atividades do aluno, como no sistema antigo.** No cadastro, abaixo de
Observação, a área **Atividades** é uma grade: atividade, os **dias marcados**
(Seg a Sáb), o horário, o professor e a mensalidade de cada uma. Um aluno pode
fazer natação às 06h (terça e sexta) e hidroginástica às 07h (terça, quarta e
sexta). "+ Adicionar atividade" põe mais uma linha; o × tira.
- Nova tabela `g_matriculas` (aluno × turma, com os dias e a mensalidade). A
  mensalidade do aluno virou o **total** das atividades — é o valor do contrato.
- **Migração automática**: a turma única que cada aluno tinha virou a primeira
  matrícula dele, com a mesma mensalidade e os dias da academia. Roda uma vez só.
- Editar grava **por diferença**: a data em que o aluno entrou numa turma
  sobrevive a uma edição qualquer.
- **Contrato**: "atividade física de Natação e Hidroginástica … das 06:00h e
  das 07:00h" sai do modelo que já existe. Dois marcadores novos para quem
  quiser detalhar: `{{ATIVIDADES_HORARIOS}}` (cada atividade com o seu horário
  e os seus dias) e `{{DIAS_ALUNO}}` (os dias deste aluno — o `{{DIAS_AULA}}`
  continua sendo o da academia).
- **Ficha**: a grade de atividades com os dias marcados, o horário, o professor
  e a mensalidade, logo abaixo dos dados principais.
- Relatórios (alunos, aniversariantes) mostram as atividades de cada um.

**Vagas: permitido passar, com aviso.** A turma pode receber aluno além do
limite. Na grade do cadastro aparece "12 de 12 vagas · passará do limite"; ao
salvar, o sistema avisa "a turma passou do limite: 13 alunos para 12 vagas";
em Turmas, Indicadores e no relatório de turmas ela fica marcada como
**excedente +1**. Pré-matrícula não ocupa vaga — só conta quando é efetivada.

**Indicadores** (menu Gestão da academia). Alunos ativos, pré-matrículas,
inativos, turmas acima do limite, e dois gráficos: **alunos por turma** (com o
traço do limite de vagas e o excedente em vermelho, sempre com o texto
"excedente" — a cor nunca carrega o aviso sozinha) e **alunos por atividade**
(quem faz duas turmas da mesma atividade conta uma vez). Passar o mouse mostra
o detalhe; os números também estão em tabela.

**Agenda para compartilhar.** Na Agenda, "Imagem e impressão do mês":
- **Imagem para rede social**, desenhada no próprio navegador: feed
  (1080×1350) ou stories (1080×1920), com o mês em tons pastel, a legenda, as
  datas do mês e o contato público da academia no rodapé. Botão "Baixar imagem".
- **Impressão para os alunos**, em A4, vertical ou horizontal.
- As duas mostram só o que vale: a data que perdeu para outra no mesmo dia não
  aparece.

**Impressão sem cabeçalho e rodapé do navegador, vertical ou horizontal.** A
data, o título, o endereço da página e o "1/1" que o navegador punha no papel
sumiram: a página não tem mais margem para ele usar — a margem vem da própria
folha, repetida em cada página impressa. Ficha, contrato, relatórios e agenda
ganharam os botões **Vertical / Horizontal**; a escolha fica lembrada, e o
ajuste de uma folha da ficha e do contrato refaz a conta para a orientação.
- As caixas da ficha passaram a ter altura proporcional à letra: antes, na
  horizontal, elas não encolhiam com o ajuste e a ficha não cabia nem com a
  letra no mínimo.
- O "Página 1" fixo do cabeçalho saiu (mentia nos relatórios de várias folhas).

## 1.21.0 — 2026-09-11 · calendário com cor, auditoria e sobre o sistema

**Calendário com três tipos de dia.** O cadastro de feriados virou o
**calendário** da academia: cada data diz o que o dia é — **feriado**
(vermelho, sem aula), **dia de aula** (azul, para uma reposição fora da regra
da semana) ou **outra atividade** (amarelo: exame de pele, capacitação da
equipe de natação). Na Agenda, **clicar num dia** abre o cadastro já com a
data.
- **Data de um dia só vale mais que a que se repete.** É assim que a academia
  diz "este ano, no São João, tem aula": cadastra 24/06/2026 como dia de aula,
  e o feriado anual continua valendo em 2027. O feriado que perdeu aparece
  riscado na lista do mês, com o motivo.
- No mesmo nível, feriado vence atividade, que vence dia de aula. Atividade
  num dia de aula mantém a aula; atividade num feriado, não.
- As datas que já existiam continuam feriado; tipo de dia desconhecido é
  recusado, em vez de virar feriado em silêncio.
- A coluna "Em 2026" achava a data pelo NOME: duas datas chamadas "Exame de
  pele" mostravam o mesmo dia. Agora é pelo registro.

**Horário da matrícula só por lista.** No formulário do site, o horário é
sempre um select com as turmas cadastradas — o campo de texto livre saiu. Sem
turma aberta, o envio fica travado com um aviso para falar pelo WhatsApp (e o
servidor também recusa). No **Revisar pré-matrícula**, o "Pediu no site" em
texto virou o próprio select de horário, já com o que a pessoa escolheu; o
texto livre das pré-matrículas antigas aparece como nota embaixo.

**Máscara de real** nos campos de dinheiro (mensalidade do aluno e mensalidade
padrão da atividade): digitar 1-1-0-0-0 dá **R$ 110,00**.

**Auditoria do sistema** (menu da conta, só administrador). Cada alteração
feita no sistema — cadastros, contratos, modelo, configurações, calendário,
usuários e também o site (textos, blog, fotos, publicar) — fica registrada com
quem, quando, sobre o quê, o resultado (feito, recusado, erro) e o endereço de
onde veio. Entram também as entradas no sistema, as tentativas de senha
recusadas e as **impressões** de ficha, contrato e relatório.
- **Ninguém apaga nem edita a auditoria**, nem o administrador: o banco recusa
  (gatilhos, como nos contratos).
- O registro nasce num gancho que olha **toda** requisição que muda algo —
  rota nova entra sozinha, sem ninguém lembrar.
- **Pré-matrícula entra só pelo número, nunca pelo nome** — nem a recebida
  pelo site, nem as ações da equipe sobre ela (editar, imprimir, apagar). A
  política promete apagar a pré-matrícula que não se confirma, e a auditoria
  não se apaga: com o nome da criança nela, a promessa viraria mentira. Depois
  de efetivada (aí há contrato), o registro cita nome e código. A entrada do
  site também vai **sem o IP**. A política de privacidade ganhou um parágrafo
  sobre a auditoria.
- Leitura comum (abrir telas e listas) não entra: esconderia o que importa.
- Filtros por pessoa, período e texto; lista em páginas.

**Sobre o sistema** (menu da conta, todos). Versão atual, desde quando o
servidor está no ar, plataforma, e o **histórico de versões** lido deste
arquivo — um lugar só para escrever o que mudou.

### Correções que vieram junto

- **Arquivos internos saíam pela web.** A proteção era uma lista do que é
  PROIBIDO, e deixava passar qualquer `.js` da raiz que não fosse `server.js`
  ou `db.js`: `testar.js`, `testar-gestao.js` (com a senha inicial dentro),
  `backup.js`, `limitador.js` — além das pastas `docs/` (a documentação
  técnica) e `ci/`. Agora vale a lista do que é **permitido**: páginas
  geradas, `assets/`, `admin/` e cinco arquivos da raiz.

## 1.20.0 — 2026-09-11 · a gestão da academia

O painel deixou de só editar o site. O menu lateral agora tem dois grupos —
**Gestão da academia** (aberto) e **Gestão do site** (tudo o que já existia,
sem mudar nada) — e uma barra no topo com atalhos e o menu da conta, na
arquitetura da área restrita do BemEstar.

**Alunos.** Cadastro completo, na ordem da ficha de papel: dados, endereço em
partes (o contrato precisa de cada pedaço), documentos, responsável quando o
aluno é menor, turma, mensalidade e foto. Status **ativo / inativo /
pré-matrícula**, estado civil com todas as opções (incluindo Separado(a)).
- **Código de matrícula continua do 004148**, para bater com os cadastros de
  papel. Pode ser digitado à mão; o próximo é sempre o maior + 1.
- **Pré-matrícula não gasta código.** Só a efetivação pela secretaria numera —
  um formulário aberto na internet não pode consumir a sequência.
- **Foto** reduzida no navegador (o que também tira a localização GPS do
  arquivo), guardada no banco e servida só com login.

**Ficha e contrato em uma folha cada.** A ficha segue o modelo impresso, com
as **condições da matrícula** no pé — texto editável em Configurações, que não
aparece no site. O **contrato é o documento Word transcrito**, alimentado pelo
cadastro; para aluno menor, o contratante é o responsável. Um script encolhe a
letra até caber em uma folha, com piso, e avisa se nem assim couber.

**Histórico de contratos imutável.** Cada contrato gerado guarda o texto
exatamente como saiu, com data, hora, quem gerou e se foi assinado. **O banco
recusa alterar ou apagar** (gatilhos no SQLite), não só a tela. O **modelo** é
editável, com marcadores, pré-visualização e versões; vale dali em diante.
A imagem das assinaturas da contratada é enviada no painel e não vai para o
repositório.

**Atividades, Turmas, Agenda, Relatórios, Configurações.** Turma por horário,
com a opção de aparecer no site. Agenda do mês em tons pastel: azul nos dias de
aula, vermelho nos feriados. Dias de aula por checkbox (terça, quarta e sexta
de fábrica). **15 feriados semeados** — nacionais, de Pernambuco e de Caruaru,
com a Sexta-feira Santa calculada pela Páscoa; incluir, editar e remover à
vontade. Carnaval e Corpus Christi ficaram de fora: são ponto facultativo.
Relatórios: ficha do aluno, aniversariantes, alunos ativos, inativos, turmas
ativas e inativas.

**Usuários.** O login pede usuário e senha. O primeiro, `admin`, herda a senha
que já existia — ninguém fica trancado do lado de fora na atualização. Perfis
administrador e secretaria; desativar ou trocar a senha de alguém derruba as
sessões dele; o último administrador não pode ser desativado. "Usuário
inexistente" e "senha errada" recebem a mesma resposta.

**A matrícula do site grava na gestão, em vez de ir pelo WhatsApp.** O
formulário foi revisto contra a ficha de papel e ganhou o que faltava: turma
(lida da gestão na hora), sexo, nacionalidade, órgão emissor, e-mail, segundo
telefone, endereço em partes e, do responsável, telefone, nascimento, trabalho.
- Entra como **pré-matrícula**, com contador no menu.
- **Consentimento de dados separado** dos três termos (LGPD, art. 14): para
  menor, o texto muda e quem autoriza é o responsável. Fica gravado com a data,
  **sem o IP**.
- Protegido por campo-isca, 5 envios por hora por endereço, corpo de até 32 KB
  e validação completa no servidor (CPF com dígito verificador, datas, UF).
- Foto e comprovante continuam pelo WhatsApp: depois de enviar, aparece um
  botão que abre a conversa já com o nome do aluno.

**A política de privacidade foi reescrita.** Ela dizia "o formulário do site não
guarda nada aqui" — deixou de ser verdade, e texto de privacidade errado é a
primeira coisa que uma fiscalização confere. A página de matrícula dizia o
mesmo, e também mudou.

### Correções que vieram junto

- **`[hidden]` não escondia nada no site.** `.field { display: grid }` vence o
  `hidden` do navegador — e o bloco de RG/CPF de adulto **aparecia para
  criança desde que a página existe**. Regra global `[hidden] { display: none
  !important }`. Achado olhando a tela; agora é teste.
- O formulário de matrícula ganhou `method="post"`: se o JavaScript falhasse,
  ele enviaria por GET, com CPF e endereço na URL — e no log do nginx.
- A lista de alunos no celular rola de lado em vez de espremer o nome.

### Para quem opera

- `PORT`, `FF_DATA` e `FF_BACKUPS` passam a ser lidos do ambiente. Sem eles,
  nada muda.
- Nova suíte `testar-gestao.js` (79 conferências, sobe o próprio servidor com
  banco temporário). `testar.js` foi de 245 para 254 e aceita `PORT`/`FF_DATA`.
- Depois do deploy: passo **8** do `DEPLOY.md` (assinaturas, turmas, usuários).

## 1.19.0 — 2026-08-26 · o Feed aceita vídeo

A matéria do Feed pode ter **foto ou vídeo** na capa. No painel, o campo da
capa ganhou o botão "Enviar vídeo" ao lado do "Enviar foto" (MP4/WEBM, até
120 MB, com o progresso no próprio botão); o resto o Publicar resolve sozinho,
pela extensão do arquivo.

- **Na lista do Feed**, matéria em vídeo mostra uma **capa genérica** —
  `assets/img/capa-video.svg`, nas cores da academia — com o selo "▶ vídeo".
  Um `<video>` por cartão faria o navegador baixar metadados de todos ao mesmo
  tempo; o cartão é só a porta de entrada.
- **Dentro da matéria**, no lugar exato onde ficaria a foto, entra o player com
  controles e `preload="metadata"`: baixa só o cabeçalho, para quem abriu a
  matéria a fim de ler não puxar o vídeo inteiro sem querer.
- **O `pickVideo` do painel virou um só para os dois usos** (o vídeo da
  Estrutura e a capa da matéria). Duas cópias teriam de acompanhar o mesmo
  contrato do `/api/upload-video`, e a que ficasse para trás falharia num
  detalhe só no dia do envio.
- **`og:image` passou a ser sempre absoluto.** Capa do Unsplash já vinha com
  domínio, mas foto enviada pelo painel saía como `/assets/…` — caminho
  relativo ali é descartado pelo WhatsApp e pelo validador. Valia para foto
  local desde sempre; com vídeo, aconteceria em toda matéria.

A rota de upload e a pasta `assets/video/` já existiam (vídeo da Estrutura),
com o `.gitignore` e o cofre do `deploy.sh` cobrindo os arquivos.

## 1.18.0 — 2026-08-19 · os links legais saem da barra e viram coluna do rodapé

A barra inferior acumulava quatro assuntos espremidos numa linha: ©/CNPJ,
Privacidade, Preferências de cookies, Área da equipe e o crédito. Na **home**,
os três links viraram a coluna **"Institucional"** — quarta coluna do grid do
rodapé, ao lado de Atendimento — e a barra ficou só com o © e o crédito.

- Privacidade e Área da equipe estão escritos no template; o **Preferências de
  cookies continua nascendo no JavaScript** (`linksRodape`), porque ele é um
  botão que só faz sentido com script (reabre o banner de consentimento — LGPD).
  Na coluna, ele entra antes do link da equipe: os assuntos do visitante ficam
  juntos e o atalho interno fecha a lista.
- As **páginas internas** têm rodapé reduzido, sem colunas — nelas tudo segue
  na barra, como antes. O `linksRodape` cobre os dois mundos sozinho.
- O botão de cookies na coluna é estilizado como os links vizinhos (bloco,
  sem borda, hover ciano) — botão por natureza, item de lista para quem lê.

De quebra: o banco de desenvolvimento ainda tinha o WhatsApp de fábrica nos
dois campos, então toda conferência local mostrava `5587000000000` (derivação
do display placeholder) e parecia que a 1.17.1 não tinha pegado. Gravado o
número público real da academia no admin local — o mesmo que já está em
produção — e o botão flutuante local passou a abrir `wa.me/5587996048212`.

## 1.17.1 — 2026-08-19 · o botão do WhatsApp abria conversa com número que não existe

O painel tem dois campos para o WhatsApp: o número **cru** (que vira o link
`wa.me`) e o de **exibição** (que aparece escrito no site). Em produção o
cliente atualizou o de exibição e o cru ficou com o valor de fábrica — e o
botão flutuante, que nasce do `config.js` gerado a partir do campo cru, abria
conversa com `5500000000000`. Nenhum erro em tela nenhuma.

Agora o publish inteiro decide o número numa função só (`numeroZap`): o campo
cru vale quando foi de fato preenchido; de fábrica ou vazio, o número é
**derivado do campo de exibição** — dígitos, com o 55 na frente quando faltar.
Aplicada nos cinco pontos que usavam o campo cru direto: o telefone do
JSON-LD, os `wa.me` das páginas e dos moldes do blog, o `config.js` do botão
flutuante e a página de matrícula. Provado reproduzindo o cenário de produção
num banco de ensaio: cru de fábrica + exibição real → tudo saiu com o real.

## 1.17.0 — 2026-08-19 · acesso da equipe no rodapé + o pacote SEO do Sentinela

### Área da equipe

Todo rodapé ganhou o link **"Área da equipe"** para o `/admin/` — discreto, no
cinza do rodapé, com `rel="nofollow"` para o Google não gastar rastreio numa
porta de login.

### SEO e compartilhamento (11 pendências do LA Sentinela, 19/08)

- **/privacidade/** ganhou `og:image` (a imagem padrão do site, 1200×630) e
  `og:description` — era a única página cujo link colado no WhatsApp saía sem
  cartão.
- **Toda imagem gerada sai com `width`/`height`**: mosaico da Estrutura, cards
  do blog (home e /blog/) e capa da matéria. Upload local é medido no arquivo;
  imagem remota leva a caixa do card como reserva. É o que impede a página de
  "pular" quando a foto chega (CLS).
- **Unsplash forçado a WebP** (`fm=webp`) nos templates e nos geradores — o
  `auto=format` só entregava WebP a quem pedisse, e rastreador não pede.
  Upload local continua no formato de origem (sem conversor no servidor).
- **Estratégia de carga explícita em toda imagem**: lazy abaixo da dobra (já
  era), e `fetchpriority="high"` no logo do cabeçalho e na capa da matéria —
  que são a primeira pintura da página e não podem esperar.
- **Títulos dentro de 62 caracteres**: home (79→56, com "Natação" e "Caruaru"
  preservados), /blog/ (66→45) e o sufixo das matérias encurtado para
  "— Forms Fitness".
- **BreadcrumbList (JSON-LD)** nas internas: /blog/, cada matéria (gerado no
  publish, com o título dela), /matricula/ e /privacidade/. A /busca/ ficou de
  fora de propósito: é noindex, e dado estruturado ali mandaria dois recados
  contrários ao Google.
- **Hierarquia do /blog/ consertada**: os cards da listagem agora são H2 sob o
  H1 da página (na home continuam H3, sob o H2 da seção). O visual não muda —
  o estilo é da classe.
- **Article (schema)**: o post que faltava era um gerado antes de o schema
  existir; a republicação regenera todos — 9/9 com Article + BreadcrumbList.

### Correções de quebra própria

- `.map(postCard)` entregava o ÍNDICE do map como nível de título e a home
  saiu com `<h0>`/`<h1>`/`<h2>` nos cards — o clássico `map(parseInt)`. Arrow
  explícita, e o comentário no código avisa o próximo.
- `APP_VERSION` do server.js estava em 1.15.0 com o package.json em 1.16.1 —
  o painel mostrava versão atrasada. Alinhados em 1.17.0.
