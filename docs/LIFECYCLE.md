# ALBRA — Ciclo de Vida: Health, Diagnostics, Update, Rollback, Uninstall

Fuentes: `core/updater.ts`, `core/uninstaller.ts`, `core/health.ts`, `core/runtime.ts`,
`core/backup.ts` (vía `BackupRecord` y `products/data.ts`), `core/runs.ts`.

## Estados del ciclo de vida

`AVAILABLE → INSTALLING → INSTALLED → STARTING → RUNNING ⇄ STOPPED`, con ramas de
`DEGRADED`, `FAILED`, `UPDATING`, `REPAIRING` y `UNINSTALLING`. El estado vive en
`InstalledProduct.state` y se muta solo dentro de los motores, bajo lock por producto.
El Runtime Manager expone al usuario `START / STOP / RESTART / STATUS`: arrancar asigna
puerto libre (si no tenía), genera `runtimeHandle` (`albra-runtime-<id>-<ts>`) y pone health
`UNKNOWN` hasta el primer check; detener libera el handle y sella `stoppedAt`.

## Health engine

`runHealthChecks(productId)` ejecuta los checks declarados en el Health Contract del
producto, con implementación real por `target`:

- `application` — existencia y validez de `app/manifest.json`; `WARN` si la versión en disco
  difiere del registro, `FAIL` si está corrupto o ausente.
- `runtime` — estado del servicio (`RUNNING` + handle).
- `database` — conteos reales: CRM (contactos + oportunidades), LEADS (leads).
- `dependencies` — dependencias requeridas del contrato resueltas.
- `storage` — sonda de lectura/escritura en `data/` (`.health-probe`).
- `port` — puerto asignado/reservado vía `adapter.isPortFree()`.
- `providers` — proveedores registrados; `WARN` si alguno está `INVALID | EXPIRED | BLOCKED`.

Cada check produce `PASS | WARN | FAIL | SKIP`. El `overall` se calcula: algún crítico
`FAIL` → `FAILED`; todos los críticos `PASS` → `HEALTHY`; cualquier `WARN`/`FAIL` no crítico
→ `DEGRADED`; si no, `UNKNOWN`. Cada ejecución persiste un `HealthSnapshot` y actualiza
`InstalledProduct.health/lastHealthAt`. Transiciones automáticas: `RUNNING` + `FAILED` →
estado `FAILED`; recuperación de `FAILED` → vuelve a `RUNNING`/`STOPPED` según handle.

## Diagnósticos (COLLECT → CLASSIFY → EXPLAIN → SUGGEST → REPAIR)

El Diagnostics Contract (`DiagnosticFindingSchema`) estructura cada hallazgo con `code`
(`SERVICE_STOPPED`, `DATABASE_UNAVAILABLE`, `FILE_CHECKSUM_MISMATCH`, …), `severity`
(`INFO|WARN|ERROR`), `title`, `explain` y `repairs[]` (cada una con `actionId`, `label`,
`risk`, `description`). El pipeline:

1. **COLLECT** — se reúnen evidencias (health checks, runs fallidos, logs, checksums) en un
   bundle (`DiagnosticBundleRec`); evento de auditoría `DIAGNOSTICS_COLLECTED`.
2. **CLASSIFY** — las evidencias se mapean a códigos de hallazgo con severidad.
3. **EXPLAIN** — el campo `explain` traduce el problema a lenguaje humano.
4. **SUGGEST** — `repairs[]` propone acciones con su nivel de riesgo (`LOW/MEDIUM/HIGH`).
5. **REPAIR** — la acción elegida se ejecuta como operación de ciclo de vida auditable
   (`REPAIR_STARTED` / `REPAIR_COMPLETED`).

## Update transaccional (CHECK → … → COMMIT)

```
CHECK → DOWNLOAD → VERIFY → BACKUP → STAGE → STOP → SWAP → MIGRATE →
START → HEALTH → COMMIT        (vía feliz)
                    └─ fallo tras STOP/SWAP ─► ROLLBACK_RESTORE →
                       ROLLBACK_START → ROLLBACK_HEALTH
```

- `CHECK` — rechaza `ALREADY_ON_TARGET_VERSION` y `DOWNGRADE_NOT_ALLOWED` (para bajar de
  versión existe el rollback); localiza la migración declarada en el contrato (`crm-2-tags`).
- `VERIFY` — el paquete objetivo se verifica igual que en instalación (hash + HMAC).
- `BACKUP` — `createBackup(productId, "PRE_UPDATE", …)` automático antes de tocar nada.
- `STAGE` — la versión nueva se escribe en staging sin afectar la app en ejecución.
- `STOP → SWAP` — la app actual pasa a `products/<id>/.previous` y staging ocupa `app`
  (renames atómicos, `swapped = true`).
- `MIGRATE` — ejecuta la migración si aplica (`executeMigration`, idempotente).
- `START → HEALTH → COMMIT` — actualiza registro a la versión nueva, elimina `.previous`
  y audita `UPDATE_COMPLETED`. Resultado `SUCCESS` con `fromVersion/toVersion/backupId`.

## Rollback automático y rollback post-commit

Si falla cualquier paso después de `STOP`/`SWAP` (se puede **inyectar** un fallo simulado en
`MIGRATION` o `START`): se restaura `.previous` → `app`, se re-importan los datos del backup
`PRE_UPDATE`, se re-registra la versión anterior, arranca el servicio y se verifica salud;
el run termina con estado **`ROLLED_BACK`** y se audita `UPDATE_ROLLED_BACK`
— nunca queda una actualización rota sin estado claro.

`rollbackLastUpdate(productId)` es el **rollback post-commit vía bóveda** (8 pasos:
`LOCATE → VERIFY_PREV → STOP → RESTORE_APP → RESTORE_DATA → REGISTER → START → HEALTH`):
localiza el backup `PRE_UPDATE` de la versión anterior, re-verifica el paquete original de la
bóveda, restaura app + datos y re-arranca.

## Uninstall con modos de datos (KEEP / EXPORT / DELETE)

```
PRECHECK → BACKUP → STOP → REMOVE_APPLICATION → REMOVE_SERVICES →
REMOVE_CONFIGURATION → CLEAN → VALIDATE
```

Siempre se crea un backup de seguridad `PRE_UNINSTALL`. Luego:

- **KEEP** — los datos del producto se conservan para una futura reinstalación.
- **EXPORT** — `exportProductData()` escribe un snapshot JSON en `exports/<id>-data-<ts>.json`
  y después elimina los datos y el directorio `data/` (el run reporta `exportPath`).
- **DELETE** — borrado permanente de datos + `deleteBackupsFor()`.

En todos los modos se eliminan app y `.previous`, proveedores, `ConfigRecord` y secretos del
SecretStore (`deleteSecretsFor`), snapshots de health y bundles de diagnóstico. `VALIDATE`
confirma que el registro desapareció (`UNINSTALL_VALIDATION_FAILED` si no) y el producto
vuelve a estar disponible en el catálogo.

## Backup / Restore

`BackupRecord` persiste cada copia con `kind` (`PRE_UPDATE | MANUAL | PRE_UNINSTALL`),
`version`, `note`, `sizeBytes`, `filePath` y el `payload` (snapshot de datos del producto:
contactos/deals/leads + `schemaVersion`). La restauración (`importProductData`) limpia y
re-inserta el snapshot, preservando `createdAt` y la `schemaVersion`. Los backups `PRE_UPDATE`
son la base de ambos rollbacks.
