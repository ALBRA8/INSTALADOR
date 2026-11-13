#!/bin/bash
# ============================================================
#  PANEL-DE-CONTROL como mini-servicio ALBRA (:3100)
#
#  El boot del sandbox (/start.sh) escanea mini-services/*/package.json
#  y lanza `bun run dev` en cada uno → este script auto-sana el PANEL
#  en cada arranque del sandbox: clona el repo si el sandbox lo limpió,
#  reinstala dependencias, regenera .env con el token de ops REAL del
#  INSTALADOR (recuperado de su SecretStore, nunca en el repo), reconstruye
#  el bundle de producción si falta y arranca con supervisor propio.
#
#  Reglas: SIN secretos literales en el repo (repo público); credenciales del
#          operador en albra-data/keys/panel.env (0600, fuera de git); solo
#          loopback; fail-loud.
# ============================================================
set -u
PANEL_DIR=/home/z/PANEL-DE-CONTROL
REPO_URL="https://github.com/ALBRA8/PANEL-DE-CONTROL.git"
KEYS_DIR=/home/z/my-project/albra-data/keys
OVERRIDES="$KEYS_DIR/panel.env"
LOG() { echo "[panel-de-control $(date '+%H:%M:%S')] $*"; }

# --- 1) Repositorio presente (self-heal tras wipe del sandbox) --------------
if [ ! -d "$PANEL_DIR/.git" ]; then
  LOG "repositorio ausente — clonando $REPO_URL"
  git clone --quiet "$REPO_URL" "$PANEL_DIR" || { LOG "ERROR fatal: clone falló"; exit 1; }
fi
cd "$PANEL_DIR"

# --- 2) Dependencias + cliente Prisma ---------------------------------------
if [ ! -d node_modules ]; then
  LOG "instalando dependencias..."
  bun install || { LOG "ERROR fatal: bun install"; exit 1; }
fi
bun run db:generate >/dev/null 2>&1 || LOG "aviso: prisma generate reportó salida no cero"

# --- 3) Base de datos del panel ---------------------------------------------
mkdir -p db
DATABASE_URL="file:$PANEL_DIR/db/panel.db" bun run db:push >/dev/null 2>&1 \
  || LOG "aviso: db push reportó diferencias (continuo)"

# --- 4) .env (0600, fuera de git) -------------------------------------------
# El token de ops se recupera del SecretStore del INSTALADOR: el instalador
# lo resuelve por petición (getOpsToken), así que este valor queda consistente
# con el proceso en marcha sin reiniciarlo.
if [ ! -f .env ]; then
  LOG "generando .env (token de ops real del INSTALADOR)..."
  TOKEN=$(cd /home/z/my-project && bun mini-services/panel-de-control/get-ops-token.ts 2>/dev/null | grep -oE '[0-9a-f]{64}' | head -1)
  [ -n "$TOKEN" ] || { LOG "ERROR fatal: no se pudo recuperar ALBRA_OPS_TOKEN"; exit 1; }
  # Overrides/credenciales del operador: NUNCA literales en el repo (repo
  # público). Se leen de $OVERRIDES (0600, fuera de git); si no existen, se
  # generan al azar, se persisten ahí mismo y se anuncian en este log.
  mkdir -p "$KEYS_DIR"
  if [ -f "$OVERRIDES" ]; then set -a; . "$OVERRIDES"; set +a; fi
  if [ -z "${EEC_API_TOKEN:-}" ]; then
    EEC_API_TOKEN="panel-op-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "EEC_API_TOKEN=$EEC_API_TOKEN" >> "$OVERRIDES"; chmod 600 "$OVERRIDES"
    LOG "EEC_API_TOKEN nuevo generado y persistido en $OVERRIDES (0600)"
  fi
  if [ -z "${EEC_OPERATOR_PASSWORD:-}" ]; then
    EEC_OPERATOR_PASSWORD="albra-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "EEC_OPERATOR_PASSWORD=$EEC_OPERATOR_PASSWORD" >> "$OVERRIDES"; chmod 600 "$OVERRIDES"
    LOG "contraseña de operador NUEVA generada y persistida en $OVERRIDES (0600) — leerla de ahí"
  fi
  printf 'DATABASE_URL=file:%s/db/panel.db\nALBRA_OPS_URL=http://127.0.0.1:3000\nALBRA_OPS_TOKEN=%s\nEEC_API_TOKEN=%s\nEEC_OPERATOR_PASSWORD=%s\n' \
    "$PANEL_DIR" "$TOKEN" "$EEC_API_TOKEN" "$EEC_OPERATOR_PASSWORD" > .env
  chmod 600 .env
  LOG ".env generado (0600). EEC_API_TOKEN disponible en .env para clientes EEC."
fi

# --- 5) Bundle de producción (se reconstruye solo si falta) -----------------
if [ ! -f .next/standalone/server.js ]; then
  LOG "construyendo bundle de producción (una vez)..."
  set -a; . ./.env; set +a
  bun run build || { LOG "ERROR fatal: build falló"; exit 1; }
fi

# --- 6) Arranque con supervisor propio --------------------------------------
while true; do
  set -a; . ./.env; set +a
  export PORT=3100 HOSTNAME=127.0.0.1 NODE_ENV=production
  LOG "arrancando servidor de producción en 127.0.0.1:3100"
  bun .next/standalone/server.js
  LOG "servidor terminó — reinicio en 3s"
  sleep 3
done
