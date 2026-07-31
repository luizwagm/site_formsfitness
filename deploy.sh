#!/usr/bin/env bash
# ==========================================================================
#  deploy.sh — atualiza a Forms Fitness em produção sem arriscar o conteúdo
#
#  Uso:  sudo ./deploy.sh
#
#  O banco data/site.db é TODO o conteúdo do site: textos, modalidades,
#  equipe, fotos da estrutura, depoimentos, matérias do blog, visitas e a
#  senha do painel. Ele vive SÓ no servidor — não está no repositório (ver
#  .gitignore). Por isso o deploy tira o banco do caminho ANTES do git pull e
#  devolve depois: nem um pull mal resolvido nem um commit antigo que apague o
#  arquivo conseguem encostar nele.
#
#  Sequência: backup → inventário → parar → proteger → pull → dependências →
#             devolver → subir → conferir inventário → testar.
#             Se algo falhar, restaura sozinho.
#
#  Este é o backup do DEPLOY (uma foto tirada antes de mexer). O sistema também
#  tira um backup DIÁRIO por conta própria, na mesma pasta — ver backup.js.
# ==========================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
SERVICO="${SERVICO:-forms.service}"
PORTA="${PORTA:-5186}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
MANTER_BACKUPS=20
COFRE="/tmp/forms-deploy-$$"

cd "$APP_DIR" || { echo "Diretório $APP_DIR não existe"; exit 1; }

azul()    { printf "\033[1;34m%s\033[0m\n" "$1"; }
verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }

# Conta o que existe no banco. Serve para PROVAR, no fim, que nada sumiu —
# um deploy que "deu certo" mas comeu as matérias não deu certo.
#
# Devolve "ILEGIVEL" (sem detalhe) quando não conseguiu ler. Antes devolvia a
# mensagem de erro inteira, e ela era COMPARADA com o inventário real no fim —
# então "não consegui ler" contra "6 modalidades · 3 equipe…" parecia conteúdo
# alterado e disparava a restauração à toa. Foi o que aconteceu quando o
# node_modules veio do git com o binário de outra plataforma: o leitor estava
# quebrado ANTES e funcionando DEPOIS, e nada no banco havia mudado.
inventario() {
  [ -f data/site.db ] || { echo "SEM BANCO"; return; }
  node -e '
    const { abrirBanco } = require("./db");
    try {
      const db = abrirBanco("data/site.db");
      const n = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 0; } };
      console.log(`${n("services")} modalidades · ${n("team")} equipe · ${n("posts")} matérias · ${n("portfolio")} fotos · ${n("testimonials")} depoimentos · ${n("settings")} textos · ${n("visits")} visitas`);
    } catch (e) { console.log("ILEGIVEL"); }
  ' 2>/dev/null
}

# Verdadeiro quando o inventário não é uma CONTAGEM, e sim um estado de "não
# consegui olhar". Comparar um desses com uma contagem real não diz nada sobre
# o conteúdo ter mudado — só que a leitura falhou num dos dois momentos.
sem_leitura() { case "$1" in "ILEGIVEL"|"SEM BANCO"|"") return 0;; *) return 1;; esac; }

# O binário do better-sqlite3 é COMPILADO para a plataforma. Se ele vier do
# repositório (compilado no Windows), o Linux recusa com "invalid ELF header" e
# o banco fica ilegível — mesmo intacto. Detectar isso cedo e por nome evita
# perseguir um problema de dados que não existe.
diagnosticar_banco() {
  local motivo
  motivo=$(node -e 'try{require("./db").abrirBanco("data/site.db").close()}catch(e){console.log(e.message.split("\n")[0])}' 2>&1 | head -1)
  [ -z "$motivo" ] && return 0
  vermelho "     não consigo LER o banco: $motivo"
  case "$motivo" in
    *"invalid ELF header"*|*ERR_DLOPEN*)
      amarelo "     Isto é o driver compilado para OUTRA plataforma — quase sempre um"
      amarelo "     node_modules que veio do git. O conteúdo do banco está intacto."
      amarelo "     Conserte com:  rm -rf node_modules && npm ci --omit=dev"
      ;;
  esac
  return 1
}

restaurar_e_sair() {
  vermelho "$1"
  if [ -f "$COFRE/site.db" ]; then
    mkdir -p data && cp "$COFRE/site.db" data/site.db
    amarelo "Banco devolvido do cofre temporário."
  elif [ -f "${BACKUP:-}" ]; then
    mkdir -p data && cp "$BACKUP" data/site.db
    amarelo "Banco restaurado do backup: $BACKUP"
  fi
  systemctl start "$SERVICO" 2>/dev/null
  rm -rf "$COFRE"
  exit 1
}

# ----------------------------------------------------------- 1. backup
azul "1/7  Backup do banco"
mkdir -p "$BACKUP_DIR"
if [ -f data/site.db ]; then
  if node server.js --backup 2>&1 | sed 's/^/  /'; then
    :
  else
    amarelo "     backup pelo sistema falhou — caindo para cópia simples"
    cp data/site.db "$BACKUP_DIR/site.$(date +%Y-%m-%d_%H%M%S).db"
  fi
  # o mais recente serve de âncora para o restaurar_e_sair
  BACKUP=$(ls -1t "$BACKUP_DIR"/site.*.db 2>/dev/null | head -1)
  ls -1t "$BACKUP_DIR"/site.*.db 2>/dev/null | tail -n +$((MANTER_BACKUPS + 1)) | xargs -r rm --
else
  amarelo "     ainda não existe banco (primeira instalação)"
fi

# -------------------------------------------------------- 2. inventário
azul "2/7  Conteúdo atual"
ANTES=$(inventario)
echo "     $ANTES"
# Se não deu para ler, diga POR QUÊ agora — e não trinta linhas depois, quando
# o sintoma já virou "o conteúdo mudou".
sem_leitura "$ANTES" && diagnosticar_banco || true

# ------------------------------------------------------------ 3. parar
azul "3/7  Parando o serviço"
systemctl stop "$SERVICO" 2>/dev/null
sleep 1
verde "     parado (o SQLite solta o arquivo antes de mexermos nele)"

# --------------------------------------------------------- 4. proteger
azul "4/7  Tirando banco e fotos do caminho do git"
mkdir -p "$COFRE"
[ -f data/site.db ] && mv data/site.db "$COFRE/site.db"
# O -wal guarda escritas ainda não gravadas no .db. Levar um sem o outro
# entrega um banco desatualizado — por isso os três andam juntos.
for extra in data/site.db-wal data/site.db-shm data/limites.json; do
  [ -f "$extra" ] && mv "$extra" "$COFRE/$(basename "$extra")"
done
[ -d assets/img/uploads ] && cp -r assets/img/uploads "$COFRE/uploads"
[ -d assets/video ] && cp -r assets/video "$COFRE/video"
verde "     guardados em $COFRE"

# ------------------------------------------------------------- 5. pull
azul "5/7  Baixando a versão nova"
DE=$(git rev-parse --short HEAD)
if ! git pull --ff-only; then
  restaurar_e_sair "     git pull falhou — nada foi alterado."
fi
PARA=$(git rev-parse --short HEAD)
if [ "$DE" = "$PARA" ]; then
  amarelo "     já estava atualizado ($PARA)"
else
  verde "     $DE → $PARA"
  git log --oneline "$DE..$PARA" | sed 's/^/       /'
fi

# ---------------------------------------------------- 5b. dependências
# O projeto usa o better-sqlite3. Não é fatal: sem node_modules o db.js volta
# sozinho para o driver de fábrica do Node e o site continua no ar, com aviso.
azul "5b/7 Dependências"
if [ -f package.json ]; then
  if command -v npm >/dev/null 2>&1; then
    if npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund; then
      verde "     node_modules em dia"
    else
      amarelo "     npm install falhou — o site sobe com o driver de reserva"
      amarelo "     tente à mão depois: npm ci --omit=dev"
    fi
  else
    amarelo "     npm não encontrado — instale com: apt install -y npm"
  fi
else
  amarelo "     sem package.json — nada a instalar"
fi

# --------------------------------------------------------- 6. devolver
azul "6/7  Devolvendo banco e fotos"
mkdir -p data assets/img/uploads
[ -f "$COFRE/site.db" ] && mv "$COFRE/site.db" data/site.db
for extra in site.db-wal site.db-shm limites.json; do
  [ -f "$COFRE/$extra" ] && mv "$COFRE/$extra" "data/$extra"
done
# -n = não sobrescreve: fotos que vieram no repositório não apagam as que o
# cliente enviou pelo painel.
[ -d "$COFRE/uploads" ] && cp -rn "$COFRE/uploads/." assets/img/uploads/ 2>/dev/null
[ -d "$COFRE/video" ] && mkdir -p assets/video && cp -rn "$COFRE/video/." assets/video/ 2>/dev/null

# O dono precisa ser o usuário DO SERVIÇO, não um palpite: com o dono errado o
# SQLite responde "attempt to write a readonly database" e o painel não salva
# nada — sem erro visível na tela. systemd sem User= significa root.
DONO=$(systemctl show "$SERVICO" -p User --value 2>/dev/null)
[ -z "$DONO" ] && DONO="root"
GRUPO=$(systemctl show "$SERVICO" -p Group --value 2>/dev/null)
[ -z "$GRUPO" ] && GRUPO="$DONO"
chown -R "$DONO:$GRUPO" data assets/img/uploads assets/video backups 2>/dev/null
# a PASTA precisa ser gravável: o SQLite cria o -wal ao lado do banco
chmod 755 data assets/img/uploads assets/video backups 2>/dev/null
[ -f data/site.db ] && chmod 644 data/site.db
verde "     de volta no lugar (dono: $DONO:$GRUPO)"

systemctl start "$SERVICO"
sleep 3

# ----------------------------------------------------------- 7. testar
azul "7/7  Conferindo"
DEPOIS=$(inventario)
echo "     antes : $ANTES"
echo "     depois: $DEPOIS"
# Só compara CONTAGEM com CONTAGEM. Se um dos dois lados é "não consegui ler",
# a diferença é da LEITURA, não do conteúdo — restaurar aí seria desfazer um
# deploy correto por causa de um driver quebrado. Foi exatamente o que
# aconteceu quando o node_modules do Windows veio pelo git: o leitor falhou
# antes, o `npm ci` o consertou no meio, e o "antes ≠ depois" acusou uma perda
# de dados que nunca existiu.
if sem_leitura "$ANTES" || sem_leitura "$DEPOIS"; then
  amarelo "     não deu para comparar o conteúdo (o banco não pôde ser lido em um dos momentos)."
  amarelo "     NADA foi restaurado — o banco continua como está, e o backup do passo 1 segue guardado."
  diagnosticar_banco || true
elif [ "$ANTES" != "$DEPOIS" ]; then
  # a contagem de visitas muda sozinha entre as duas leituras; só alerta se o
  # CONTEÚDO mudou — por isso compara ignorando o último campo
  A_SEM_VISITAS="${ANTES%· *}"; D_SEM_VISITAS="${DEPOIS%· *}"
  if [ "$A_SEM_VISITAS" != "$D_SEM_VISITAS" ]; then
    restaurar_e_sair "     O CONTEÚDO MUDOU. Restaurando por segurança."
  fi
fi

OK=0
for _ in $(seq 1 10); do
  CODIGO=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORTA/" || echo 000)
  [ "$CODIGO" = "200" ] && { OK=1; break; }
  sleep 2
done

rm -rf "$COFRE"

if [ "$OK" = "1" ]; then
  VERSAO=$(curl -s "http://127.0.0.1:$PORTA/admin/" | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
  echo
  verde "Deploy concluído — site no ar, gerenciador $VERSAO"
  echo "  Backup desta atualização: ${BACKUP:-nenhum (primeira instalação)}"
  echo "  Se mudou texto ou foto, entre no painel e clique em Publicar."
  echo
  echo "  Backup automático (diário, dentro do serviço):"
  node server.js --backup-status 2>/dev/null | sed 's/^/    /'
else
  echo
  vermelho "O site não respondeu (HTTP $CODIGO). Últimas linhas do log:"
  journalctl -u "$SERVICO" -n 25 --no-pager | sed 's/^/  /'
  echo
  amarelo "O banco está intacto em data/site.db e no backup:"
  amarelo "  ${BACKUP:-(sem backup — primeira instalação)}"
  exit 1
fi
