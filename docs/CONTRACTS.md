# ALBRA — Contratos Universales (LAYER 1–2)

Fuente: `src/lib/albra/contracts/index.ts`. Ningún "manifest monstruoso": cada contrato es un
schema Zod independiente, versionado (`contractVersion` semver) y validable. El
**ProductContract** es una composición, no un monolito.

## Primitivas

- `SemVer` — regex `^\d+\.\d+\.\d+$`.
- `LifecycleState` — `AVAILABLE | INSTALLING | INSTALLED | STARTING | RUNNING | STOPPED | DEGRADED | FAILED | UPDATING | REPAIRING | UNINSTALLING` (11 estados).
- `HealthStatus` — `HEALTHY | DEGRADED | FAILED | UNKNOWN`.
- `HealthCheckStatus` — `PASS | WARN | FAIL | SKIP`.
- `LifecycleOperation` — `INSTALL, CONFIGURE, START, STOP, RESTART, UPDATE, ROLLBACK, DIAGNOSTICS, REPAIR, BACKUP, RESTORE, UNINSTALL` (12 operaciones).
- `RiskLevel` — `LOW | MEDIUM | HIGH` (una migración `HIGH` exige confirmación).
- `DataMode` — `KEEP | EXPORT | DELETE` (modos de datos del uninstall).

## Product Identity

`ProductIdentitySchema`: `productId` (slug `^[a-z0-9-]+$`, mín. 2), `name`, `displayName`,
`vendor` (default `ALBRA`), `description`, `category` (default `business`), `icon` (default
`Package`), `version` (SemVer), `releaseChannel` (`stable|beta|alpha`, default `stable`) y
`requiredEntitlement` (opcional — concepto SaaS futuro; KREA/TRADING lo usan para bloquearse).

## Requirements

`RequirementsSchema`: `platforms` (≥1 de `windows|linux|macos`), `architectures` (≥1 de
`x64|arm64`), `minPlatformVersion` (SemVer de ALBRA Platform), `minDiskMB` (entero positivo) y
`preferredPorts` (array de puertos preferentes, p. ej. CRM `4101/4111/4121`).

## Dependencies

`DependencySpecSchema`: `dependencyId`, `kind` (`runtime|service|library|product`),
`versionRange`, `required` (default true) y `autoInstallable` (default true). Las dependencias
`albra-*` (runtime, database) se resuelven automáticamente por la plataforma.

## Configuration Contract

`ConfigurationContractSchema` → `fields: ConfigField[]` con: `key`, `label`, `scope`
(`USER|SYSTEM|PRODUCT`), `type` (`string|email|number|select|boolean|secret`), `required`,
`defaultValue`, `options` (para `select`), `description` y `systemManaged` (true = administrado
por ALBRA: paths, puertos, runtime; el usuario no lo edita). Los campos `secret` se guardan
cifrados en el SecretStore y nunca se muestran.

## Health Contract

`HealthContractSchema`: `checks: HealthCheckSpec[]` (mín. 1) con `checkId`, `label`,
`target` (`application|runtime|database|dependencies|storage|port|providers`) y `critical`
(default true); más `intervalSeconds` (default 30). CRM declara 7 checks; LEADS, 4.

## Lifecycle Contract

`LifecycleContractSchema`: `supportedOperations: LifecycleOperation[]`, `autoStartOnInstall`
(default true) y `restartable` (default true). Los productos piloto declaran las 12 operaciones.

## Update / Rollback Contract

`UpdateContractSchema`: `migrations: MigrationSpec[]` (default `[]`), `supportsRollback`
(default true) y `backupBeforeUpdate` (default true). `MigrationSpec`: `migrationId`,
`fromVersion`, `toVersion`, `description` y `risk: RiskLevel` (default `LOW`). Ejemplo real:
`crm-2-tags` (1.0.0 → 1.1.0, riesgo LOW, "Añade etiquetas a los contactos").

## Security Contract

`SecurityContractSchema`: `signedPackagesRequired` (default true), `secretKeys: string[]`
(p. ej. CRM: `["smtp_password"]`), `permissions: string[]` (CRM: `data:read`, `data:write`,
`net:smtp`) y `dataClassification` (`public|internal|confidential`, default `internal`;
CRM es `confidential`).

## Providers Contract

`ProvidersContractSchema` → `providers: ProviderSpec[]` con `providerId`, `label`, `kind`
(`smtp|database|storage|ai|payment|custom`), `required` (default false) y `description`.
`ProviderStatus` define el ciclo del proveedor: `DISCOVERED, AVAILABLE, CONFIGURED,
AUTHENTICATED, CONNECTED, HEALTHY, DEGRADED, INVALID, EXPIRED, BLOCKED`. CRM declara un
proveedor `smtp` opcional ("Correo saliente (SMTP)").

## Deployment Contract

`DeploymentContractSchema`: `kinds` (≥1 de `local|selfhosted|saas`) y `preferredAdapter`
(`windows-local|linux-local|local-dev|selfhosted-vps`). Los piloto declaran
`kinds: ["local"]` y `preferredAdapter: "windows-local"` (implementación de producción).

## Diagnostics Contract

`DiagnosticFindingSchema`: `findingId`, `code` (p. ej. `SERVICE_STOPPED`,
`DATABASE_UNAVAILABLE`, `FILE_CHECKSUM_MISMATCH`), `severity` (`INFO|WARN|ERROR`), `title`,
`explain` (explicación en lenguaje humano) y `repairs[]` con `actionId`, `label`, `risk` y
`description`. Cada hallazgo lleva su explicación y sus acciones de reparación con riesgo asociado.

## ProductContract (composición)

```
ProductContractSchema = {
  contractVersion, identity, requirements, dependencies,
  configuration, health, lifecycle, update, security, providers, deployment
}
```

## Motor de compatibilidad

`checkCompatibility({ platform, arch, platformVersion, contract })` devuelve
`COMPATIBLE | INCOMPATIBLE | UPGRADE_REQUIRED | MIGRATION_REQUIRED` con `reasons[]`:

1. Plataforma/architectura no incluidos → `INCOMPATIBLE`.
2. `platformVersion < minPlatformVersion` → `UPGRADE_REQUIRED` (hay que actualizar ALBRA Platform).
3. `contractVersion < 1.0.0` → `MIGRATION_REQUIRED` (schema de contrato antiguo).

`parseProductContract(raw)` valida con Zod y devuelve `{ ok, contract?, errors[] }` con los
errores detallados por ruta (`path: message`); es la puerta de entrada del contrato del paquete
en installer, updater y preflight.
