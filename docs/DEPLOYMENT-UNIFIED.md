# Despliegue unificado — INSTALADOR + PANEL + primer agente (Docker)

Un solo flujo despliega los tres componentes en un equipo Linux con Docker.
El usuario **no edita código ni crea archivos de configuración a mano**.

```bash
bash deploy/unified-up.sh
```

## Qué hace el flujo (10 pasos)

| Paso | Acción | Motor real |
|---|---|---|
| 1 | Requisitos del equipo (curl, ≥5 GB libres) | checks fail-closed |
| 2 | Docker Engine + Compose v2 | `docker info`, `docker compose version` |
| 3 | Configuración por defecto (puertos 3000/3900) | variables env opcionales |
| 4 | Build de la imagen `albra/instalador:local` | `Dockerfile` (standalone + CLI docker) |
| 5 | Volúmenes `instalador-db` / `instalador-albra-data` | compose up |
| 6 | Salud del INSTALADOR | `/api/system` con espera activa |
| 7 | Token EEC + **INSTALL del PANEL** | `POST /api/ops` (Bearer + nonce + requestId) → polling `/api/runs/{runId}` |
| 8 | **INSTALL del primer agente (chismoso)** | mismo contrato EEC |
| 9 | Conectividad: health real del PANEL en :3900 y STATUS del agente | healthchecks de Compose |
| 10 | Resumen de salud de los tres | curl a los tres planos |

## Cómo funciona por dentro

- El INSTALADOR corre **contenedorizado con `/var/run/docker.sock` montado** y el
  CLI de docker + compose plugin dentro de la imagen: es el controlador del
  Docker del host, no un segundo motor.
- PANEL y agente se instalan con el **mismo contrato EEC ops** que usa el PANEL
  desde su UI: `POST /api/ops` con Bearer (`ALBRA_OPS_TOKEN` del SecretStore),
  `nonce` anti-replay persistido (`EecNonce`), `requestId` idempotente,
  ventana temporal ≤5 min. El run se sigue con polling **autenticado** en
  `/api/runs/{runId}`.
- El motor ancla **digests sha256 inmutables** de las imágenes GHCR
  (`ghcr.io/albra8/panel-de-control:1.0.0`, `ghcr.io/albra8/chismoso:1.5.0`)
  en `ContainerDeployment.imageDigests` antes de `compose up`.
- Los secretos del PANEL (`EEC_OPERATOR_PASSWORD`, `EEC_SESSION_SECRET`,
  `EEC_API_TOKEN`, `ALBRA_OPS_TOKEN`) los genera el INSTALADOR en el
  `.env.albra` (0600) del producto — nunca en código fuente.

## Requisitos previos

1. Docker Engine + compose v2 funcionando.
2. **Imágenes GHCR visibles** para el equipo: haz públicos los paquetes
   `panel-de-control` y `chismoso` (GitHub → Packages → settings → Change
   visibility → Public) o ejecuta `docker login ghcr.io` antes del flujo.
3. Nada más.

## Variables opcionales

| Variable | Default | Significado |
|---|---|---|
| `PANEL_PORT` | `3900` | Puerto host del PANEL (el compose del PANEL publica `${ALBRA_PANEL_PORT:-3900}:3000`) |
| `AGENT_PRODUCT` | `chismoso` | Producto del catálogo a instalar como primer agente |
| `POLL_TIMEOUT_S` | `900` | Timeout de polling de runs de instalación |

## Credenciales tras el despliegue

```bash
docker compose -f deploy/instalador-compose.yml exec core \
  cat /app/albra-data/products/panel-de-control/app/.env.albra
```

Ahí están el `EEC_OPERATOR_PASSWORD` (login del PANEL en
`http://127.0.0.1:3900`) y el `EEC_API_TOKEN` (Bearer para clientes de
servicio). El archivo es 0600 y vive en el volumen `instalador-albra-data`.

## Desglose y limpieza

```bash
# retirar servicios conservando datos (igual que UNINSTALL con dataMode KEEP)
docker compose -f deploy/instalador-compose.yml down
# desinstalación completa (borra volúmenes de datos del INSTALADOR)
docker compose -f deploy/instalador-compose.yml down -v
```

La desinstalación del PANEL/agente (con o sin purga de datos) se hace desde la
UI del PANEL o por el contrato EEC (`UNINSTALL` con `confirmDataLoss` +
`dataMode`) — el motor retira servicios con `compose down` y solo purga
volúmenes con confirmación explícita.
