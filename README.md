# Forms Fitness — Academia Aquática

Site institucional com blog, o **gerenciador de conteúdo** e, desde a 1.20.0, a
**gestão da academia** (alunos, turmas, contratos, agenda e relatórios) da
Forms Fitness Academia Aquática — Caruaru-PE, 33 anos de mercado.

- **Domínio:** formsfitness.com (é `.com`, **não** `.com.br`)
- **Porta interna:** 5186 · **Serviço:** `forms.service` · **Versão:** `1.25.1`
- **Stack:** Node ≥ 20 com `node:http`, SQLite via `better-sqlite3`. **Uma
  dependência de produção, e só.**

## Sobre

São duas áreas no mesmo processo e no mesmo arquivo de banco:

| Área | O que é | Sessão |
|---|---|---|
| `/` | site público — 9 páginas estáticas, reescritas na publicação | — |
| `/admin/` | **Gestão da academia** (alunos, atividades, turmas, agenda, relatórios, contrato, **boletos**, configurações) e **Gestão do site** (textos, modalidades, fotos, blog, contato) | cookie, 12 h deslizante, **por usuário** |

Desde a 1.26.0 há **carnê de boletos** (Sicredi, com QR Code Pix), registrado pela
API de Cobrança a partir da mensalidade e do dia de vencimento de cada aluno —
ver DEPLOY.md, seção 8b. Não há contas a pagar nem fluxo de caixa.

## Objetivo

Captar matrícula e organizar a academia. Todo caminho da página termina em
falar com a academia — botão flutuante de WhatsApp, formulário de contato, ou a
página de matrícula, que grava a ficha como **pré-matrícula** na gestão. A
secretaria confere, efetiva (é aí que o aluno ganha o código, a partir de
004149) e gera o contrato.

## Principais funcionalidades

- **34 campos de texto** e cinco listas de conteúdo, todos editáveis no painel
  (os três últimos, o cabeçalho da seção Contato, entraram na 1.27.0).
- **Blog** com página própria por matéria, endereço e resumo automáticos.
- **Página de matrícula** que exige responsável conforme a idade, lista as
  turmas abertas da gestão e grava a **pré-matrícula** com o consentimento
  (LGPD, art. 14). Desde a 1.27.0 a ficha leva junto a **foto do aluno** e o
  **comprovante de pagamento**, os dois obrigatórios.
- **Gestão da academia:** cadastro de aluno com status ativo/inativo, código de
  matrícula sequencial, **cadastro de professores** (escolhidos por select na
  turma e, se for outro, em cada atividade do aluno), **várias atividades por
  aluno** (cada uma com os seus dias, horário, professor e mensalidade — a
  grade do sistema antigo), vagas
  por turma que **avisam** quando passam do limite, tela de **Indicadores**
  com gráficos, agenda do mês em **imagem para rede social** e em A4, ficha e contrato em uma folha cada, **histórico de
  contratos imutável** (o banco recusa alterar ou apagar), modelo de contrato
  editável com versões, **calendário** com três tipos de dia (feriado em
  vermelho, dia de aula em azul, outra atividade em amarelo — a data de um
  dia só vence a que se repete), seis relatórios e **usuários** com perfil.
- **Auditoria do sistema** só de acréscimo (o banco recusa alterar ou apagar):
  toda requisição que muda algo, entradas, senhas recusadas e impressões.
  Pré-matrícula aparece só pelo número. **Sobre o sistema** mostra a versão e
  o histórico lido deste CHANGELOG.
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

**E uma quarta, desde a 1.21.0: o servidor só entrega o que está numa lista.**
Pastas `assets/ blog/ busca/ matricula/ privacidade/ admin/` e cinco arquivos
da raiz (`PASTAS_PUBLICAS` e `ARQUIVOS_PUBLICOS` no `server.js`). Arquivo novo
na raiz — o de verificação do Google, por exemplo — dá **404 até entrar na
lista**. É de propósito: a lista antiga, de proibidos, entregava `testar.js` e
a pasta `docs/` para qualquer um.

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
testar.js         suíte principal — 272 conferências
testar-gestao.js  suíte da gestão — 231 conferências, com banco temporário, CEP e Sicredi falsos
gestao/           a gestão: esquema, rotas, documentos (ficha/contrato), textos,
                  auditoria e sobre (o CHANGELOG convertido para a tela);
                  cep (busca de endereço), boleto (nosso número, código de barras),
                  sicredi (API de Cobrança), cobranca (o carnê), carne (a impressão)
src/              moldes: blog · post · matricula · privacidade · busca
admin/            o gerenciador (gestao.js/gestao.css = telas da gestão)
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
- O login é **usuário + senha**. O primeiro usuário, `admin`, herda a senha que
  o painel já tinha (a inicial é semeada no `server.js` — procure por
  `admin_password_hash`). **Troque no primeiro acesso** e crie um usuário para
  cada pessoa da equipe em *Administrador ▸ Usuários do sistema*.
- `PORT`, `FF_DATA` (pasta do banco) e `FF_BACKUPS` mudam porta e pastas —
  servem para rodar uma cópia do banco sem tocar no de sempre. Sem elas, tudo
  fica como sempre foi.

O banco nasce semeado com o conteúdo de exemplo, então o site já sobe
apresentável.

### Testes

```bash
node server.js        # num terminal
node testar.js        # no outro — 272 conferências
node testar-limitador.js
node testar-gestao.js # sobe o próprio servidor, na 5311, com banco temporário
```

Para rodar `testar.js` contra uma cópia do banco, suba o servidor com
`FF_DATA=<cópia> PORT=5313` e rode a suíte com as mesmas duas variáveis.

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

> Os PDFs refletem a versão **1.18.0** — **antes da gestão da academia**. A
> 1.20.0 muda arquitetura, banco e telas: é hora de regerá-los.

## LGPD

- **Consentimento prévio de verdade:** os identificadores de GA4, GTM, Pixel,
  Clarity e Hotjar em `config.js` só carregam **depois** do aceite. Cookie de
  180 dias, com "Preferências de cookies" no rodapé para reabrir a escolha.
- **A matrícula recebe dois arquivos** (1.27.0): a foto do aluno (imagem) e o
  comprovante (imagem ou **PDF**), obrigatórios, conferidos pelos **bytes** e
  não pela extensão. Ficam no banco e só saem por `/admin/arquivo/:id`, com
  login — nunca numa pasta pública; o PDF desce como **anexo**, para não abrir
  dentro da nossa origem. A foto é reduzida **no aparelho de quem envia**, o
  que também descarta o GPS gravado no EXIF. Apagar a pré-matrícula apaga os
  dois arquivos. O consentimento fica gravado com a data, **sem o IP**. Para aluno
  menor, quem consente é o responsável (art. 14), com texto próprio.
- A política de privacidade foi reescrita na 1.20.0 para dizer isso — antes ela
  afirmava que nada era guardado.
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
