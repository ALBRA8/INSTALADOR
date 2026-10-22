# ALBRA — Modelo de Seguridad

Fuentes: `package/format.ts`, `core/secrets.ts`, `core/package-keys.ts`, `core/registry.ts`,
`core/audit.ts`, `core/logger.ts`, `core/runs.ts`, `contracts/index.ts`.

## 1. Firma de paquetes HMAC-SHA256

- Cada paquete `.albra` se firma con **HMAC-SHA256** sobre el `packageHash`
  (SHA-256 canónico del core: format + formatVersion + manifest + contract + payloadHash).
- Clave raíz: `keys/package-signing.key` — 32 bytes aleatorios (`crypto.randomBytes(32)`)
  generados una sola vez y persistidos en hexadecimal con **modo `0600`**; cacheada en memoria.
- `keyId: "albra-root-2025"` identifica la clave de firma dentro del paquete.
- La verificación (`verifyPackage`) es **obligatoria y en capas**: estructura → checksum por
  archivo → `payloadHash` → `packageHash` → firma. Un paquete con firma inválida
  (`SIGNATURE_INVALID`) se rechaza y se audita `PACKAGE_REJECTED` (severidad ERROR) antes de
  crear cualquier staging. `signedPackagesRequired: true` está declarado en el Security
  Contract de los productos.

## 2. SecretStore AES-256-GCM

- Cifrado autenticado **AES-256-GCM**: formato `v1.<iv-b64>.<authTag-b64>.<cipher-b64>`, con
  IV de 12 bytes aleatorio por secreto y tag de autenticidad (integridad + confidencialidad).
- Clave maestra propia del SecretStore: `keys/master.key` (256 bits, modo `0600`),
  independiente de la clave de firma de paquetes.
- `putSecret / getSecret` persisten en `SecretRecord` (clave única por `(key, productId)`),
  con `hint` opcional; `deleteSecretsFor(productId)` borra los secretos al desinstalar.
- `listSecrets` **nunca devuelve valores**: solo `key`, `hint`, `updatedAt` y el placeholder
  `••••••••`. Los valores descifrados solo existen en memoria para el runtime del producto.
- Los campos de configuración tipo `secret` del Configuration Contract (p. ej. `smtpPassword`
  del CRM) van por esta vía; el installer los excluye deliberadamente del `ConfigRecord`.

## 3. Redaction defensiva

`redactValue()` recorre cualquier estructura (string, array u objeto) antes de persistir:

- Claves que casen con `secret | password | token | api-key | credential | cipher`
  (case-insensitive) → `••••••••`.
- Strings que parezcan secretos (misma regex sobre el contenido) → `••••••••`.

Se aplica **en todos los puntos de persistencia**: `Run.finish()` (pasos y resultado del
lifecycle run), `audit()` (detalle del evento) y `log()` (canal USER/SYSTEM/DEBUG/AUDIT).
Por eso diagnósticos, reportes y UI nunca filtran credenciales, aunque el código las maneje.

## 4. Locks de operación

`withLock(productId, fn)` (Registry) garantiza **una operación de ciclo de vida a la vez por
producto**: instalación, actualización, rollback y desinstalación toman el lock; un segundo
intent concurrente falla con `PRODUCT_BUSY`. El lock se libera siempre en `finally`.
Productos distintos no se bloquean entre sí (aislamiento operativo).

## 5. Validación de contratos

- `parseProductContract(raw)` valida el contrato completo con Zod y devuelve errores por ruta
  (`path: message`); se ejecuta en preflight, tras el staging (`CONTRACT_INVALID_AFTER_STAGE`)
  y antes de cualquier update (`CONTRACT_INVALID`).
- `checkCompatibility()` aplica las reglas de plataforma/arquitectura/versión y produce
  `COMPATIBLE | INCOMPATIBLE | UPGRADE_REQUIRED | MIGRATION_REQUIRED` con razones.
- Un contrato inválido es un `BLOCKER`: no hay instalación ni actualización sin contrato válido.

## 6. Audit trail

`AuditEvent` registra los eventos mínimos obligatorios del estándar ALBRA, con `actor`
(default `platform`), `severity` (`INFO|WARN|ERROR`), `detail` **redactado** y `productId`:

```
INSTALL_STARTED/COMPLETED/FAILED · UPDATE_STARTED/COMPLETED/FAILED/ROLLED_BACK
START_COMPLETED · STOP_COMPLETED · REPAIR_STARTED/COMPLETED
UNINSTALL_STARTED/COMPLETED · BACKUP_CREATED · RESTORE_COMPLETED
CONFIG_CHANGED · PROVIDER_CHANGED · LICENSE_CHANGED
PACKAGE_VERIFIED · PACKAGE_REJECTED
CERTIFICATION_COMPLETED · CLEANROOM_RESET · DIAGNOSTICS_COLLECTED
```

Cada evento también se refleja en el canal `AUDIT` del log estructurado. Ejemplos reales:
`PACKAGE_VERIFIED` guarda los primeros 16 caracteres del `packageHash`; `PACKAGE_REJECTED`
guarda la `reason` exacta del rechazo.

## 7. Otras garantías

- **Integridad de archivos**: `PackageFileEntry.sha256` por archivo + verificación byte a
  byte del staging (`STAGE_CHECKSUM_MISMATCH`) + checksums rápidos del adapter para disco.
- **Escritura atómica**: `writeFileAtomic` (tmp + rename) y `commitDirectory` (rename de
  staging → app) evitan estados intermedios visibles o corruptos.
- **Permisos de llaves**: ambas master keys nacen con `mode: 0o600`.
- **Clasificación de datos**: `dataClassification` por producto (`confidential` para CRM) y
  `permissions` declaradas (`data:read`, `data:write`, `net:smtp`) en el Security Contract.
- **Defensa path-traversal**: la bóveda solo acepta nombres de archivo planos (`path.basename`).
- **Migraciones de riesgo**: `MigrationSpec.risk = HIGH` exige confirmación explícita.
