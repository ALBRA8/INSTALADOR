# syntax=docker/dockerfile:1.7
# =============================================================================
# ALBRA INSTALADOR — imagen OCI para despliegue unificado (Linux/VPS).
#
# El INSTALADOR es el CONTROLADOR de Docker: en el contenedor lleva el CLI de
# docker + compose plugin y recibe /var/run/docker.sock montado (deploy/
# instalador-compose.yml). Así despliega PANEL y agentes con el MISMO motor
# (compose + digests) que en instalación nativa.
#
# Build:  docker compose -f deploy/instalador-compose.yml build
# Up:     bash deploy/unified-up.sh   (flujo completo de 10 pasos)
# =============================================================================
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx prisma generate
ENV NODE_ENV=production
# next build (standalone) + copy-standalone.js
RUN bun run build

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app

# CLI de docker (binario estático, versión pinneada) + compose plugin:
# el INSTALADOR ejecuta `docker`/`docker compose` contra el socket del host.
ARG DOCKER_CLI_VERSION=27.5.1
ARG DOCKER_COMPOSE_VERSION=2.32.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
      | tar xz -C /tmp \
 && install -m 0755 /tmp/docker/docker /usr/local/bin/docker \
 && mkdir -p /usr/local/lib/docker/cli-plugins \
 && curl -fsSL "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-x86_64" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose \
 && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose \
 && docker version --client && docker compose version

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/db/custom.db \
    ALBRA_HOME=/app/albra-data

# standalone + node_modules completos + src/scripts (print-ops-token y db push)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY deploy/instalador-entrypoint.sh ./deploy/instalador-entrypoint.sh
RUN chmod +x ./deploy/instalador-entrypoint.sh && mkdir -p /app/db /app/albra-data

EXPOSE 3000
VOLUME ["/app/db", "/app/albra-data"]

ENTRYPOINT ["/app/deploy/instalador-entrypoint.sh"]
