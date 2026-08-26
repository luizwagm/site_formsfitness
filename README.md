# Forms Fitness — Academia Aquática

Site institucional com blog e o **gerenciador de conteúdo** da Forms Fitness
Academia Aquática — Caruaru-PE, 33 anos de mercado.

- **Domínio:** formsfitness.com (é `.com`, **não** `.com.br`)
- **Porta interna:** 5186 · **Serviço:** `forms.service` · **Versão:** `1.18.0`
- **Stack:** Node ≥ 20 com `node:http`, SQLite via `better-sqlite3`. **Uma
  dependência de produção, e só.**

## Sobre

São duas áreas no mesmo processo e no mesmo arquivo de banco:

| Área | O que é | Sessão |
|---|---|---|
| `/` | site público — 9 páginas estáticas, reescritas na publicação | — |
| `/admin/` | gerenciador: textos, modalidades, fotos, blog, contato | cookie, 12 h deslizante |

Não há área de gestão operacional: **nenhum cadastro de aluno, agenda ou
financeiro**. O sistema é conteúdo e captação.

## Objetivo

Captar matrícula. Todo caminho da página termina em falar com a academia —
botão flutuante de WhatsApp, formulário de contato, ou a página de matrícula,
que monta a ficha e a envia formatada pela conversa.

## Principais funcionalidades

- **31 campos de texto** e cinco listas de conteúdo, todos editáveis no painel.
- **Blog** com página própria por matéria, endereço e resumo automáticos.
- **Página de matrícula** que exige responsável conforme a idade e **não grava
  nada no servidor**.
- **Busca** no conteúdo do site, rodando no navegador.
- **Envio de vídeo** pelo painel, com barra de progresso, para a seção Estrutura.
- **Modo manutenção** em duas camadas e **backup diário** verificado.
- Pacote de SEO: dados estruturados, títulos calibrados, imagens medidas e WebP.
- **Consentimento prévio de cookies** — nenhuma medição carrega antes do aceite.

## O ciclo do conteúdo

```
editar no painel      ->  grava em data/site.db
clicar em Publicar    ->  lê o banco e reescreve:
                            index.html                (trechos marcados)
                            blog/index.html + blog/<slug>/index.html
                            busca/ privacidade/ matricula/   (de src/)
                            assets/data/search-index.json
                            sitemap.xml
                            assets/js/config.js       (WhatsApp e e-mail)
```

> **Editar não publica.** O texto é salvo, o aviso diz "salvo", e o site
> continua mostrando a versão anterior até alguém clicar em **Publicar**. É a
> confusão operacional mais provável deste sistema.

## Três coisas para saber antes de mexer

**Cada marcador precisa de uma linha explícita no publish.** Ao contrário de
projetos irmãos, que aplicam os textos num laço genérico, aqui semear a chave +
pôr o marcador no HTML + listar a chave em `KEYS` **não basta**: sem a linha
`html = setMarker(html, "X", S.x)`, o texto nunca chega à página — e nada acusa
o erro. Foi o que fez os quatro textos da seção TAF falharem enquanto a lista de
itens já funcionava. Campo novo mexe em **quatro lugares**: a semente, o
marcador, o `KEYS` e o `setMarker` — mais as listas do painel (`CAMPOS_SIMPLES`,
`COM_EDITOR` e, para listas, o par preencher/gravar).

**`KEYS` é lista de permissão.** Chave que não está nela é descartada em
silêncio no `PUT`. O campo aparece no painel, a pessoa salva, o aviso diz
"salvo" e nada muda — o jeito mais fácil de criar um botão que mente.

**Semente de chave nova fica FORA da guarda de primeira execução.** Num banco
que já existe, o seed com guarda nunca roda, e o painel abre com um campo vazio
que não salva.

## Tecnologias

- **Node.js ≥ 20** (CI em 22), servidor com `node:http` — sem framework.
- **SQLite** via `better-sqlite3`, com queda controlada para o `node:sqlite`
  nativo se o módulo nativo faltar. Modo WAL.
- **scrypt** para a senha do painel, com sal por senha e migração automática do
  formato antigo.
- HTML, CSS e JavaScript sem framework nas duas interfaces.
- nginx + systemd (rodando como `deploy`, não como root), GitHub Actions na
  entrega.

## Estrutura

```
server.js         tudo: site, publicação, painel, blog, SEO, busca, acessos
db.js             único lugar que abre o banco; escolhe o driver
limitador.js      freio de tentativas de senha
backup.js         cópia diária, dentro do processo
testar.js         suíte principal — 245 conferências
src/              moldes: blog · post · matricula · privacidade · busca
admin/            o gerenciador
assets/           css, js, imagens e o índice de busca
blog/ busca/ matricula/ privacidade/    páginas GERADAS — não editar à mão
nginx/  ci/  .github/                   vhost, entrega e pipeline
```

> **src/ é a fonte; as pastas de página são a saída.** O `index.html` da raiz é
> o caso híbrido: ele é o molde *e* o resultado — a publicação reescreve os
> trechos marcados dentro dele mesmo.

## Como executar

```bash
npm ci          # instala o driver do banco
npm start       # sobe na porta 5186
```

- Site: `http://localhost:5186/` · Painel: `http://localhost:5186/admin/`
- A senha inicial do painel é semeada no `server.js` (procure por `admin_password_hash`).
  **Troque no primeiro acesso** — em produção ela não deve continuar valendo.

O banco nasce semeado com o conteúdo de exemplo, então o site já sobe
apresentável.

### Testes

```bash
node server.js        # num terminal
node testar.js        # no outro — 245 conferências
node testar-limitador.js
```

A suíte fala com o servidor **de verdade** por HTTP: o que passa nela é o que o
navegador vai encontrar. Cada bloco cobre uma falha real encontrada em auditoria
— senha sem sal, sessão eterna, força bruta livre, upload de SVG, banco exposto
na web.

> **Cuidado ao rodar localmente.** A suíte usa a porta 5186 e conversa com o
> banco de desenvolvimento. Ela apaga a matéria de teste que cria, mas **o
> arquivo enviado pelo teste de upload fica** em `assets/img/uploads/`. No
> portão automático isso não acontece: lá o repositório não traz o banco, e o
> servidor nasce com um banco novo.

## Operação no servidor

```bash
./verificar.sh          # só lê: versão, banco, serviço, permissões
sudo ./deploy.sh        # tira o banco do caminho -> pull -> npm ci -> restart
sudo ./restaurar.sh     # confere integridade, guarda o atual, exige digitar RESTAURAR
```

Roteiro completo de instalação em [`DEPLOY.md`](DEPLOY.md) — sete passos, com o
que conferir em cada um.

> **O deploy já resetou o banco em produção uma vez**, porque `data/site.db`
> estava versionado: cada `git pull` no servidor escrevia a cópia do repositório
> por cima do banco vivo. Hoje o arquivo está fora do rastreamento, o deploy
> **para** se detectar que ele voltou, e a restauração guarda o estado atual
> antes de escrever — recusando devolver um backup mais velho que o banco em
> disco.
>
> A lição de fundo: **`.gitignore` só vale para arquivo NÃO rastreado.**
> Acrescentar a linha não desfaz o rastreamento de quem já está no índice — é
> preciso `git rm --cached`.

## Documentação

| Documento | Conteúdo |
|---|---|
| [Documentação Técnica](docs/documentacao-tecnica.pdf) | Arquitetura, publicação, APIs, segurança, deploy, testes e pontos de atenção |
| [Documentação de Produto](docs/documentacao-produto.pdf) | O que o site resolve, público, jornada, conteúdo publicado e requisitos |
| [Documentação de Banco de Dados](docs/documentacao-banco-de-dados.pdf) | As 7 tabelas, as 36 chaves, integridade e o incidente que moldou o deploy |
| [Documentação de Protótipo](docs/documentacao-prototipo.pdf) | Identidade visual, layout próprio, telas, componentes e navegação |

Histórico de versões em [`CHANGELOG.md`](CHANGELOG.md) — criado na 1.17.0; o
anterior vive nas mensagens do git.

> Os PDFs refletem a versão **1.18.0**. Ao subir versão que mude arquitetura,
> banco ou telas, vale regerá-los.

## LGPD

- **Consentimento prévio de verdade:** os identificadores de GA4, GTM, Pixel,
  Clarity e Hotjar em `config.js` só carregam **depois** do aceite. Cookie de
  180 dias, com "Preferências de cookies" no rodapé para reabrir a escolha.
- **A matrícula não grava nada** e **não aceita arquivo** — foto e comprovante
  vão pela conversa. A academia atende crianças, e documento de menor não fica
  no servidor. A política de privacidade diz isso com todas as letras.
- **O contador de acessos guarda hash do IP com sal**, nunca o endereço.
- O mapa incorporado do Google foi substituído por um **cartão de endereço**:
  ele trazia cerca de 900 KB e plantava cookie *antes* do consentimento.

## Pendências conhecidas

- **As fotos da Estrutura e as capas do blog são de banco de imagens.** Os
  títulos descrevem a academia — "piscina semiolímpica", "vista da piscina" —,
  mas as imagens não são dela. É a maior distância entre o que o site promete e
  o que mostra, e a melhoria de maior efeito com menor esforço técnico.
- **Blog parado desde 10/07/2026.** A estrutura está pronta e cada matéria apoia
  uma modalidade; falta cadência.
- **Medição desligada** — os identificadores em `config.js` estão vazios.
- **Três arquivos de teste versionados** em `assets/img/uploads/`
  (`*zz-teste-em-pe.png`), apesar da pasta constar no `.gitignore`. Resolver com
  `git rm --cached`, e fazer a suíte apagar o que envia.
- **A tabela `team` tem 3 registros e nenhuma tela** desde a 1.9.0, quando a
  área Equipe saiu do site por decisão do cliente. Mantida de propósito —
  apagá-la seria irreversível.
- Conferir se CNPJ, endereço e horários no ar são os definitivos.
