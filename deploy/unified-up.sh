#!/usr/bin/env bash
# =============================================================================
# ALBRA — DESPLIEGUE UNIFICADO (INSTALADOR → PANEL → PRIMER AGENTE)
#
# Ejecuta el flujo completo de la Orden Maestra en un equipo Linux con Docker:
#   1. requisitos del equipo (curl, memoria, permisos del socket docker)
#   2. Docker Engine + Compose v2
#   3. configuración (sin edición de código: todo por env por defecto)
#   4. build de la imagen del INSTALADOR
#   5. redes y volúmenes (albra-agents la crea el motor al instalar)
#   6. despliegue del INSTALADOR (contenedor con socket de Docker)
#   7. INSTALL del PANEL desde el INSTALADOR (contrato EEC ops, Bearer)
#   8. INSTALL del primer agente (chismoso) desde el INSTALADOR
#   9. verificación de conectividad (healthchecks reales)
#  10. resumen de salud de los tres componentes
#
# Uso:  bash deploy/unified-up.sh
#       PANEL_PORT=3900 AGENT_PRODUCT=chismoso bash deploy/unified-up.sh
# =============================================================================
set -euo pipefail

COMPOSE="docker compose -f deploy/instalador-compose.yml"
PANEL_PORT="${PANEL_PORT:-3900}"
AGENT_PRODUCT="${AGENT_PRODUCT:-chismoso}"
OPS_BASE="http://127.0.0.1:3000"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-900}"

say()  { printf '\n\033[1;36m═══ %s ═══\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
die()  { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

step_install_via_ops() { # $1 productId  $2 etiqueta
  local product="$1" label="$2"
  say "Instalando $label desde el INSTALADOR (contrato EEC ops)"
  local nonce requestId issuedAt expiresAt body runId status
  nonce="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  requestId="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  issuedAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  expiresAt="$(date -u -d '+4 minutes' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+4M +%Y-%m-%dT%H:%M:%SZ)"
  body=$(printf '{"contractVersion":"1.0.0","requestId":"%s","operation":"INSTALL","productId":"%s","params":{},"nonce":"%s","issuedAt":"%s","expiresAt":"%s"}' \
    "$requestId" "$product" "$nonce" "$issuedAt" "$expiresAt")
  local resp
  resp="$(curl -fsS -X POST "$OPS_BASE/api/ops" \
      -H "Authorization: Bearer $OPS_TOKEN" -H "Content-Type: application/json" \
      -d "$body")"
  echo "  respuesta: $resp"
  echo "$resp" | grep -q '"accepted":true' || die "El INSTALADOR rechazó el INSTALL de $product"
  runId="$(echo "$resp" | sed -n 's/.*"runId":"\([^"]*\)".*/\1/p')"
  [ -n "$runId" ] || die "Respuesta sin runId para $product"
  ok "Aceptado — runId $runId (polling autenticado)"

  local waited=0
  while :; do
    status="$(curl -fsS "$OPS_BASE/api/runs/$runId" -H "Authorization: Bearer $OPS_TOKEN" \
      | sed -n 's/.*"status":"\([A-Z_]*\)".*/\1/p' | head -1)"
    case "$status" in
      SUCCESS) ok "$label instalado (run SUCCESS)"; break ;;
      WARNING) ok "$label instalado con avisos (run WARNING)"; break ;;
      FAILURE|ROLLED_BACK) die "El run de $label terminó $status — revisa /api/runs/$runId" ;;
      RUNNING|"")
        [ "$waited" -ge "$POLL_TIMEOUT_S" ] && die "Timeout de polling para $label (runId $runId)"
        sleep 10; waited=$((waited+10))
        printf '    … run en curso (%ds)\n' "$waited" ;;
    esac
  done
}

# ── 1) Requisitos del equipo ────────────────────────────────────────────────
say "1/10 Requisitos del equipo"
command -v curl >/dev/null || die "curl es requerido"
command -v head  >/dev/null || die "utilidades coreutils requeridas"
FREE_MB="$(df -Pm . | awk 'NR==2 {print $4}')"
[ "$FREE_MB" -ge 5120 ] || die "Espacio libre insuficiente (${FREE_MB} MB < 5120 MB)"
ok "curl y espacio en disco (${FREE_MB} MB libres)"

# ── 2) Docker Engine + Compose ──────────────────────────────────────────────
say "2/10 Docker Engine y Compose v2"
command -v docker >/dev/null || die "Docker no está instalado — instala Docker Desktop/Engine y reintenta"
docker info >/dev/null 2>&1 || die "El daemon de Docker no responde (¿DOCKER_HOST? ¿permisos del socket?)"
docker compose version >/dev/null 2>&1 || die "docker compose v2 no está disponible"
ok "Docker $(docker version --format '{{.Server.Version}}') · compose $(docker compose version --short)"

# ── 3) Configuración (cero edición de código) ───────────────────────────────
say "3/10 Configuración"
[ -f deploy/instalador-compose.yml ] || die "Ejecuta este script desde la raíz del repo INSTALADOR"
ok "Puertos: INSTALADOR 127.0.0.1:3000 · PANEL 127.0.0.1:${PANEL_PORT} (publicado por el compose del PANEL)"

# ── 4) Imagen del INSTALADOR ────────────────────────────────────────────────
say "4/10 Construyendo imagen del INSTALADOR"
$COMPOSE build
ok "albra/instalador:local construida"

# ── 5) Redes y volúmenes ────────────────────────────────────────────────────
say "5/10 Redes y volúmenes"
$COMPOSE up -d
ok "Volúmenes instalador-db/instalador-albra-data listos (la red albra-agents la crea el motor en el paso 7)"

# ── 6) Salud del INSTALADOR ─────────────────────────────────────────────────
say "6/10 Esperando salud del INSTALADOR"
for i in $(seq 1 60); do
  if curl -fsS "$OPS_BASE/api/system" >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && die "El INSTALADOR no alcanzó salud (revisa: $COMPOSE logs core)"
  sleep 2
done
ok "INSTALADOR arriba en $OPS_BASE ($(curl -fsS "$OPS_BASE/api/system" | head -c 80)…)"

# ── 7) Token de operaciones (Bearer EEC) ────────────────────────────────────
say "Token de operaciones EEC (SecretStore del INSTALADOR)"
OPS_TOKEN="$($COMPOSE exec -T core bun scripts/print-ops-token.ts | tr -d '[:space:]')"
[ ${#OPS_TOKEN} -ge 32 ] || die "No se pudo recuperar el token de operaciones"
ok "Token recuperado (${#OPS_TOKEN} chars — nunca se imprime completo)"

# ── 7b) INSTALL PANEL ───────────────────────────────────────────────────────
step_install_via_ops "panel-de-control" "PANEL DE CONTROL"

# ── 8) INSTALL primer agente ────────────────────────────────────────────────
step_install_via_ops "$AGENT_PRODUCT" "AGENTE ${AGENT_PRODUCT}"

# ── 9) Conectividad real ────────────────────────────────────────────────────
say "9/10 Verificación de conectividad"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && die "El PANEL no alcanzó salud en :${PANEL_PORT} (revisa logs del contenedor panel)"
  sleep 2
done
ok "PANEL saludable en http://127.0.0.1:${PANEL_PORT}/api/health"
STATUS_AGENT="$(curl -fsS -X POST "$OPS_BASE/api/ops" \
  -H "Authorization: Bearer $OPS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"contractVersion\":\"1.0.0\",\"requestId\":\"$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')\",\"operation\":\"STATUS\",\"productId\":\"$AGENT_PRODUCT\",\"params\":{},\"nonce\":\"$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')\",\"issuedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"expiresAt\":\"$(date -u -d '+4 minutes' +%Y-%m-%dT%H:%M:%SZ)\"}")"
echo "  STATUS ${AGENT_PRODUCT}: $(echo "$STATUS_AGENT" | head -c 220)…"
echo "$STATUS_AGENT" | grep -q '"accepted":true' || die "STATUS de ${AGENT_PRODUCT} no fue aceptado"

# ── 10) Resumen de salud ────────────────────────────────────────────────────
say "10/10 Resumen de salud"
echo "  INSTALADOR : $(curl -fsS "$OPS_BASE/api/system" | head -c 60)…"
echo "  PANEL      : $(curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health")"
echo "  Contenedores (compose ps del PANEL):"
$COMPOSE exec -T core docker ps --filter "name=albra-panel" --format 'table {{.Names}}\t{{.Status}}' || true
say "DESPLIEGUE COMPLETADO"
echo "  • PANEL UI     : http://127.0.0.1:${PANEL_PORT}  (login: EEC_OPERATOR_PASSWORD)"
echo "    credenciales: $COMPOSE exec core cat /app/albra-data/products/panel-de-control/app/.env.albra"
echo "  • INSTALADOR   : $OPS_BASE (API + consola)"
echo "  • Catálogo     : curl $OPS_BASE/api/catalog"
