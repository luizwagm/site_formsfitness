# Changelog — Forms Fitness

Regra: **2ª casa = funcionalidade, 3ª = correção.** A primeira não muda.
(Arquivo criado na 1.17.0 — o histórico anterior vive nas mensagens do git.)

---

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
