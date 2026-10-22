# ALBRA — Installer Engine (máquina de estados y instalación transaccional)

Fuente: `src/lib/albra/core/installer.ts`. Toda instalación es una **máquina de estados de
15 pasos** observable (`Run` persistido en `LifecycleRun`) y **transaccional**: si algo falla,
el sistema vuelve a un estado consistente.

## Los 15 estados

```
DISCOVER → PREFLIGHT → PLAN → CONFIRM → DOWNLOAD → VERIFY → PREPARE →
INSTALL  → CONFIGURE  → INITIALIZE → MIGRATE → REGISTER → START →
HEALTH CHECK → COMPLETE
```

| Paso | Qué hace |
|---|---|
| `DISCOVER` | Localiza el paquete (última versión) en la bóveda |
| `PREFLIGHT` | Ejecuta `preflight()` (ver abajo); bloquea si hay BLOCKERs |
| `PLAN` | Genera el plan: `Instalar <id> v<x> en products/<id>/app` |
| `CONFIRM` | Confirmación del usuario (ya otorgada desde el Launcher) |
| `DOWNLOAD` | Copia el `.albra` de la bóveda a `downloads/` (escritura atómica) |
| `VERIFY` | `verifyPackage()`: SHA-256 por archivo + `payloadHash` + `packageHash` + HMAC. Rechazo → auditoría `PACKAGE_REJECTED` y aborte |
| `PREPARE` | Crea el área de staging `products/<id>/staging-<runId>` |
| `INSTALL` | Escribe los archivos del payload en staging y **re-verifica byte a byte** (`STAGE_CHECKSUM_MISMATCH` si difieren) |
| `CONFIGURE` | Inicializa `ConfigRecord` USER/SYSTEM/PRODUCT con defaults del contrato; los campos `secret` se omiten aquí (van al SecretStore); sin `.env` |
| `INITIALIZE` | `seedProductData()`: crea los registros iniciales solo si las tablas están vacías |
| `MIGRATE` | En instalación fresca queda `SKIPPED` ("sin migraciones pendientes") |
| `REGISTER` | **COMMIT transaccional**: `commitDirectory(staging → app)` (rename atómico) + upsert en `InstalledProduct` con versión, puerto y `packageHash` |
| `START` | `startProduct()` desde el Runtime Manager; fallo → `SERVICE_START_FAILED` |
| `HEALTH` | `runHealthChecks()`; `overall FAILED` aborta |
| `COMPLETE` | Cierra el run con `SUCCESS`, audita `INSTALL_COMPLETED` |

## Transacción: PREPARE / STAGE / COMMIT / ROLLBACK

1. **PREPARE** — staging limpio por run (`staging-<runId>`), fuera del directorio real de la app.
2. **STAGE** (paso INSTALL) — archivos escritos en staging y revalidados contra el contenido
   del paquete; el contrato se re-parsea con Zod (`CONTRACT_INVALID_AFTER_STAGE` si falla).
3. **COMMIT** (paso REGISTER) — `commitDirectory()` hace `rename` atómico de staging → `app`
   y crea `data/`; el registro (`InstalledProduct`) se actualiza en la misma fase. El usuario
   nunca ve un directorio de aplicación a medias.
4. **ROLLBACK** — si cualquier paso falla: se elimina el staging y, si el registro quedó en
   `INSTALLED` sin `runtimeHandle` (servicio nunca arrancado), se borra para dejar el catálogo
   limpio. Los pasos pendientes pasan a `SKIPPED`, el paso en curso a `FAILURE` con el error,
   el run termina `FAILURE` y se audita `INSTALL_FAILED` + log de error.

Todo el flujo corre dentro de `withLock(packageId)`: no puede haber dos instalaciones (ni
instalación + update) concurrentes del mismo producto (`PRODUCT_BUSY`).

## Preflight

`preflight(packageId)` devuelve `PreflightReport { ok, issues[], platform, assignedPort? }`.
Cada issue tiene `code`, `severity` (`BLOCKER | WARNING | RESOLVED`) y `message`:

- `PACKAGE_NOT_FOUND` (BLOCKER) — el paquete no está en la bóveda.
- `CONTRACT_INVALID` (BLOCKER) — el contrato embebido no pasa la validación Zod.
- `COMPATIBILITY_INCOMPATIBLE | _UPGRADE_REQUIRED | _MIGRATION_REQUIRED` (BLOCKER) — salida
  del motor de compatibilidad (plataforma, arquitectura, versión mínima de plataforma).
- `INSUFFICIENT_DISK` (BLOCKER) / `DISK_OK` (RESOLVED) — `minDiskMB` vs. disco libre real
  (`fs.statfs` vía adapter).
- `DEP_OK` / `DEP_AUTINSTALL` (RESOLVED) o `DEP_MISSING` (BLOCKER) — dependencias del contrato;
  las `albra-*` las provee la plataforma.
- `ALREADY_INSTALLED` (BLOCKER) — el producto ya está instalado; hay que desinstalarlo primero.
- `NO_PORT_AVAILABLE` (BLOCKER) / `PORT_RESOLVED` (RESOLVED o WARNING) — resolución de puertos.
- `PERMISSION_DENIED` (BLOCKER) / `PERMISSIONS_OK` (RESOLVED) — permisos de escritura en `products/`.

`ok = false` si existe al menos un `BLOCKER`; el paso PREFLIGHT del run termina `WARNING`
cuando hubo auto-resoluciones (p. ej., puerto reasignado).

## Resolución automática de puertos

El adapter ofrece `findFreePort(preferredPorts)` con sonda TCP real (`net.createServer` sobre
`127.0.0.1`):

1. Se prueba el puerto preferente del contrato (p. ej. CRM `4101`).
2. Si está ocupado, ALBRA **reasigna automáticamente** el siguiente libre del rango
   (hasta `maxTry = 20` candidatos consecutivos) y emite un `WARNING` explicativo:
   *"Puerto 4101 ocupado → ALBRA reasignó automáticamente el puerto 4111"*.
3. El puerto asignado viaja por el resto de la instalación (SYSTEM config `port`, registro,
   START) y queda reservado por el Runtime Manager mientras el producto corre.

## Observabilidad

Cada paso se persiste con estado (`PENDING | RUNNING | SUCCESS | WARNING | FAILURE | SKIPPED`),
timestamp y `durationMs`; el resultado final (versión instalada, puerto) queda en
`LifecycleRun.result`. La UI del Launcher muestra los pasos en vivo por polling.
