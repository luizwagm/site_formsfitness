# Changelog — Forms Fitness

Regra: **2ª casa = funcionalidade, 3ª = correção.** A primeira não muda.
(Arquivo criado na 1.17.0 — o histórico anterior vive nas mensagens do git.)

---

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
