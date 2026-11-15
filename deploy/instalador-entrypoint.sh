#!/bin/sh
# ALBRA INSTALADOR — entrypoint del contenedor de despliegue unificado.
# Fail-closed: sin DATABASE_URL o sin schema aplicable, no arranca.
set -e

: "${DATABASE_URL:?DATABASE_URL es obligatorio (la fija deploy/instalador-compose.yml)}"
: "${ALBRA_HOME:=/app/albra-data}"
export DATABASE_URL ALBRA_HOME

DB_DIR="$(echo "$DATABASE_URL" | sed -n 's|^file:\(.*\)/[^/]*$|\1|p')"
[ -n "$DB_DIR" ] && mkdir -p "$DB_DIR"

echo "[albra-entrypoint] aplicando schema Prisma (db push, idempotente)…"
bunx prisma db push --skip-generate

echo "[albra-entrypoint] arrancando INSTALADOR (standalone) en :${PORT:-3000}…"
exec bun server.js
