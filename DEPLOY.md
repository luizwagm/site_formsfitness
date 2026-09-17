# Subir a Forms Fitness para produção

Domínio **formsfitness.com** · porta **5186** · serviço **forms.service**
Caminho no servidor: `/var/www/projetos/Forms-Fitness`

Faça na ordem. Cada passo tem como conferir se deu certo antes de seguir.

---

## Antes de começar

**Aponte o DNS.** No painel do seu registrador, crie dois registros **A**
apontando para o IP do servidor:

| Tipo | Nome  | Valor            |
|------|-------|------------------|
| A    | `@`   | IP do servidor   |
| A    | `www` | IP do servidor   |

> **Não use CNAME no domínio raiz** (`@`). É inválido pela RFC 1034 e quebra a
> emissão do certificado. O `criar-site.sh` detecta isso e para antes de
> gastar tentativas no Let's Encrypt, que limita 5 falhas por hora.

O DNS leva de minutos a algumas horas. Confira com:

```bash
dig +short A formsfitness.com
```

---

## 1. Enviar o código

```bash
sudo mkdir -p /var/www/projetos && cd /var/www/projetos
sudo git clone <URL-DO-SEU-REPO> Forms-Fitness
cd Forms-Fitness
```

Se o repositório já existe, só atualize:

```bash
cd /var/www/projetos/Forms-Fitness && sudo git pull
```

---

## 2. Instalar as dependências

```bash
cd /var/www/projetos/Forms-Fitness && sudo npm ci --omit=dev
```

Só há uma: o `better-sqlite3`. Se falhar, o site ainda sobe — o `db.js` cai
sozinho para o driver de fábrica do Node e avisa no log. Não trava o deploy.

---

## 3. Subir o serviço

```bash
sudo cp nginx/forms.service /etc/systemd/system/forms.service && sudo systemctl daemon-reload && sudo systemctl enable --now forms
```

Conferir:

```bash
sudo systemctl status forms --no-pager && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5186/
```

Tem de responder **HTTP 200**. Se não responder, o log diz por quê:

```bash
sudo journalctl -u forms -n 40 --no-pager
```

---

## 4. Criar o vhost e emitir o certificado

Um comando só faz tudo: confere o DNS, testa a aplicação, escreve o vhost,
recarrega o nginx, emite o certificado e testa a renovação automática.

```bash
cd /var/www/projetos/Forms-Fitness && sudo ./nginx/criar-site.sh formsfitness.com 5186 contato@formsfitness.com
```

Ao terminar, ele mostra `https://formsfitness.com -> 200` e o HTTP redirecionando
com 301. Se o certbot falhar, o site continua no ar em HTTP e o motivo fica em
`/var/log/letsencrypt/letsencrypt.log`.

---

## 5. Ajustar as permissões

O serviço roda como `root` (definido no `forms.service`). O dono das pastas
graváveis precisa bater com ele — senão o SQLite responde *"attempt to write a
readonly database"* e **o painel não salva nada, sem erro visível na tela**.

```bash
cd /var/www/projetos/Forms-Fitness && sudo chown -R root:root data assets/img/uploads backups && sudo chmod 755 data assets/img/uploads backups
```

---

## 6. Trocar a senha do painel

A senha inicial é `forms-admin` e **está escrita no código, à vista de todos**.
Troque antes de divulgar o site.

Acesse `https://formsfitness.com/admin/`, entre com o usuário `admin` e a senha
inicial e vá em **Administrador ▸ Minha conta**. Mínimo de 8 caracteres.

Depois crie **um usuário para cada pessoa** da equipe em **Administrador ▸
Usuários do sistema** (perfil *Secretaria* para quem não administra usuários). O histórico de
contratos registra quem gerou cada um — com todo mundo usando o `admin`, essa
coluna não diz nada.

> Enquanto for a padrão, o serviço avisa a cada boot no `journalctl`.

---

## 7. Preencher os dados reais

No painel, em **Textos e contato → Contato**:

- WhatsApp (só números, com o 55)
- E-mail
- Endereço e CNPJ, se for exibir

E, quando contratar, os IDs de medição em `assets/js/config.js` (GA4, GTM,
Pixel…). Eles só passam a carregar **depois** que o visitante aceitar os
cookies — o banner já está pronto para isso.

Clique em **Publicar** ao terminar: é o Publicar que grava os textos nas
páginas e regenera o sitemap e o índice de busca.

---

## 8. Configurar a gestão da academia

Tudo pelo painel, em **Gestão da academia**. O banco já nasce com os feriados
nacionais, de Pernambuco e de Caruaru, os dias de aula (terça, quarta e sexta),
o modelo do contrato, as condições da matrícula e a atividade Natação.

1. **Contrato ▸ Assinaturas da contratada ▸ Enviar imagem** — a imagem com as
   assinaturas do diretor e das testemunhas, que vai no pé de todo contrato
   gerado. Ela **não vem no repositório** (é assinatura de gente de verdade).
2. **Atividades** — confira a mensalidade de cada uma. É o valor sugerido ao
   efetivar um aluno.
3. **Turmas** — cadastre os horários e deixe marcado **"Aparece no formulário de matrícula do site"** nas que
   aceitam matrícula online. Sem nenhuma turma assim, o formulário do site
   pede o horário em texto livre.
4. **Configurações** — revise os feriados municipais (o 24/06 foi cadastrado
   como São João de Caruaru; confira com a prefeitura) e os dias de aula.

A matrícula feita no site chega em **Alunos** como *pré-matrícula*, com um
contador no menu. Ela só ganha código ao ser **efetivada** — a sequência
continua do 004149.

### 8b. Boletos do Sicredi (1.26.0)

O carnê de boletos (com QR Code Pix) é registrado pela **API de Cobrança do
Sicredi**. Sem as credenciais, a tela **Boletos** do aluno diz o que falta e
não gera nada.

1. **Na cooperativa:** peça a *API de Cobrança* para o convênio de cobrança da
   academia (o mesmo dos boletos de hoje).
2. **No Internet Banking** da conta do convênio: *Cobrança ▸ Código de Acesso
   ▸ Gerar*. É o `SICREDI_CODIGO_ACESSO`.
3. **No portal do desenvolvedor** (https://developer.sicredi.com.br/api-portal/):
   crie uma APP de homologação para a API de Cobrança e abra o chamado pedindo
   o token. É o `SICREDI_API_KEY`. Depois, o mesmo para produção.
4. **No servidor**, crie o `.env` ao lado do `server.js` (ele nunca vai para o
   git — o repositório é público):

   ```bash
   cd /var/www/projetos/Forms-Fitness
   cp .env.exemplo .env && chmod 600 .env && nano .env
   sudo systemctl restart forms
   ```

5. **Comece em `SICREDI_AMBIENTE=sandbox`.** Os carnês saem com a tarja
   "Teste — não pague". Gere o carnê de um aluno de teste, imprima e confira.
   Só então troque para `producao`, com a chave de produção e os códigos reais
   de cooperativa, posto e beneficiário.

Regras que valem sempre: um boleto por aluno por mês; multa de 2% e juros de
1% ao mês; **sem** negativação ou protesto automático; boleto emitido não se
apaga, só se cancela (pedido de baixa ao banco).

---

## Conferir se está tudo certo

```bash
cd /var/www/projetos/Forms-Fitness && sudo ./verificar.sh
```

Ele **só lê**, não altera nada. Mostra o estado do serviço, se o banco corre
risco no próximo `git pull`, permissões de escrita, conteúdo do banco, o freio
de tentativas de senha e os backups.

---

## No dia a dia

### Atualizar o site depois de mexer no código

```bash
cd /var/www/projetos/Forms-Fitness && sudo ./deploy.sh
```

Ele tira o banco e as fotos do caminho do git antes do `pull` e devolve depois,
conta o conteúdo antes e depois, e **restaura sozinho** se algo sumir.

> **Na 1.20.0** o banco ganha as tabelas da gestão no primeiro boot, sozinho, e
> o login passa a pedir usuário: quem já entrava continua com `admin` e a mesma
> senha. Depois do deploy, siga o passo **8** acima.

### Backup

Sai sozinho **a cada 24h** para `backups/`, guardando as 30 últimas cópias.
Cada uma é conferida com `integrity_check` antes de valer.

```bash
sudo node server.js --backup          # forçar uma cópia agora
sudo node server.js --backup-status   # ver a situação
```

### Restaurar

```bash
sudo ./restaurar.sh          # lista o que existe
sudo ./restaurar.sh site     # restaura o mais recente
```

Antes de sobrescrever, ele guarda o estado atual como
`site.antes-da-restauracao.*` — restaurar por engano não é irreversível.

### Tirar o site do ar para manutenção

No painel, em **Publicar → Modo manutenção**. O visitante vê o aviso com
HTTP 503 (o Google entende que é temporário e não tira as páginas do índice) e
**você, logado, continua vendo o site normalmente** para conferir antes de
reabrir.

Se a aplicação cair de vez, o nginx serve a mesma página sozinho — é para isso
que ela fica gravada em disco.

---

## Se algo der errado

| Sintoma | Onde olhar |
|---|---|
| Site fora do ar | `sudo journalctl -u forms -n 50 --no-pager` |
| O painel não salva | `sudo ./verificar.sh` → seção *Permissão de escrita* |
| Certificado não emitiu | `/var/log/letsencrypt/letsencrypt.log` |
| Erro do nginx | `/var/log/nginx/formsfitness.com.error.log` |
| Travado fora do painel | é o freio de senha: 15 min por IP, ou 30 min na conta. Passa sozinho. |

**O banco nunca está só num lugar:** ele fica em `data/site.db`, tem cópia
diária em `backups/` e mais uma cópia a cada `deploy.sh`.
