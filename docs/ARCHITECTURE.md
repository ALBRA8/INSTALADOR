# ALBRA — Arquitectura del Deployment & Lifecycle System

ALBRA es una plataforma de despliegue y gestión del ciclo de vida de productos de negocio.
Su núcleo **nunca depende de un sistema operativo concreto**: toda interacción con el entorno
(archivos, puertos, checksums, plataforma) se delega en un **adaptador de despliegue**.

## Las 7 capas

| # | Capa | Contenido | Código |
|---|------|-----------|--------|
| 1 | **Product Standard** | Definición de qué es un producto ALBRA y qué garantiza | `src/lib/albra/contracts/index.ts` |
| 2 | **Universal Contracts** | Contratos universales con schema Zod, versión y validación | `src/lib/albra/contracts/index.ts` |
| 3 | **Package System** | Formato `ALBRA-PACKAGE 1.0.0` (`.albra`), hashing, firma HMAC, bóveda y Runtime Manager | `src/lib/albra/package/format.ts`, `core/runtime.ts` |
| 4 | **Deployment Framework** | Adapters: `local-dev` (implementado), `windows-local` y `selfhosted-vps` (especificados) | `src/lib/albra/adapters/index.ts` |
| 5 | **Lifecycle Engines** | Installer, Updater, Uninstaller, Registry, Health, SecretStore, Audit, Runs | `src/lib/albra/core/*` |
| 6 | **Products** | Catálogo, contratos por producto, datos aislados, migraciones y seeds | `src/lib/albra/products/*` |
| 7 | **Experiencia y Observabilidad** | Launcher UI, runs observables en vivo, health snapshots, audit trail, certificación | `core/runs.ts`, `core/audit.ts`, UI del Launcher |

Las capas 1–6 están etiquetadas literalmente en los comentarios de cabecera del código;
la capa 7 agrupa la superficie visible: toda operación es **observable** (`Run` con pasos
persistidos en `LifecycleRun`) y auditable (`AuditEvent`).

## Diagrama general

```
┌─────────────────────────────────────────────────────────────────────┐
│  L7  LAUNCHER UI + REPORTES      (runs en vivo, health, audit)      │
├─────────────────────────────────────────────────────────────────────┤
│  L6  PRODUCTS          CRM (piloto) · LEADS · KREA🔒 · TRADING🔒    │
│      datos aislados: CrmContact/CrmDeal · LeadRecord (tablas propias)│
├─────────────────────────────────────────────────────────────────────┤
│  L5  LIFECYCLE ENGINES                                              │
│      INSTALLER ──► UPDATE/ROLLBACK ──► UNINSTALL ──► HEALTH         │
│      REGISTRY (locks) · RUNS · AUDIT · LOGS · SECRETS · BACKUP      │
├─────────────────────────────────────────────────────────────────────┤
│  L4  DEPLOYMENT FRAMEWORK (adapter-driven)                          │
│      local-dev ✔  │  windows-local (espec.)  │  selfhosted-vps (esp.)│
├─────────────────────────────────────────────────────────────────────┤
│  L3  PACKAGE SYSTEM                                                 │
│      .albra = manifest+contract+payload → sha256 → HMAC-SHA256      │
│      bóveda packages/ · Runtime Manager (START/STOP/RESTART)        │
├─────────────────────────────────────────────────────────────────────┤
│  L2  UNIVERSAL CONTRACTS   Product · Config · Health · Update ·     │
│      Security · Providers · Deployment · Diagnostics (Zod)          │
├─────────────────────────────────────────────────────────────────────┤
│  L1  PRODUCT STANDARD      "ningún manifest monstruoso":            │
│      contratos separados por responsabilidad, versionados           │
└─────────────────────────────────────────────────────────────────────┘
```

## Decisión adapter-driven

La auditoría inicial (WAVE 0) determinó que el entorno de construcción es un sandbox Linux:
no es posible compilar binarios Windows `.exe`. Por eso el núcleo se construyó **inverso al
acoplamiento**: los motores de L5 piden capacidades (`info()`, `isPortFree()`, `findFreePort()`,
`fileChecksum()`) a la interfaz `DeploymentAdapter` y no saben en qué sistema corren.

- **`local-dev`** — implementado y activo en el sandbox; semántica idéntica a producción
  (`albra-data/` como raíz, sondas reales de puerto con sockets TCP, `fs.statfs` para disco).
- **`windows-local`** — implementación de producción especificada; se activa cuando
  `process.platform === "win32"` y resuelve bajo `%ProgramData%\ALBRA`.
- **`selfhosted-vps`** — especificado para WAVE 11 (VPS/Hostinger): `SelfHostedDeploymentAdapter`
  con `capabilities` declaradas (`provisioning`, `remoteExec`, `nginx`, `backupsRemote`) y
  `isImplemented() === false` en el MVP, de modo que no bloquea el núcleo.

`getDeploymentAdapter()` selecciona el adapter en tiempo de ejecución; el resto del código
solo conoce la interfaz. Añadir un destino nuevo es implementar una clase, no tocar motores.

## Aislamiento de productos

Cada producto es independiente por contrato y por datos:

1. **Directorios propios**: `products/<id>/app`, `products/<id>/data`, `staging-<runId>` y
   `.previous` por producto (`env.ts`). Nunca se comparte un directorio de aplicación.
2. **Tablas propias**: CRM usa `CrmContact`/`CrmDeal`; LEADS usa `LeadRecord`. `products/data.ts`
   es la frontera de acceso: ningún producto consulta tablas de otro.
3. **Configuración separada por scopes**: `USER` (lo que entiende el usuario), `SYSTEM`
   (puerto, rutas, runtime — administrado por ALBRA) y `PRODUCT` (esquema/feature flags),
   persistidas en `ConfigRecord` con clave `(productId, scope)`. Sin archivos `.env` para el usuario.
4. **Locks por producto**: `withLock()` garantiza una sola operación de ciclo de vida a la vez
   por producto; dos productos pueden operar en paralelo.
5. **Puertos preferentes distintos**: CRM `4101/4111/4121`, LEADS `4102/4112/4122`, con
   reasignación automática si hay conflicto.
6. **Health y backups por producto**: snapshots, bundles de diagnóstico y backups llevan `productId`.

## Layout de archivos (ALBRA_HOME)

```
$ALBRA_HOME (o <repo>/albra-data)      # %ProgramData%\ALBRA en windows-local
├── packages/     bóveda de paquetes .albra firmados
├── products/     <id>/app · <id>/data · staging-<runId> · .previous
├── backups/      copias de seguridad
├── exports/      exportaciones de datos (uninstall EXPORT)
├── keys/         master.key (SecretStore) · package-signing.key (firma)
├── logs/         logs estructurados
└── downloads/    descarga desde la bóveda antes de verificar
```

## Registro local (Prisma/SQLite)

`prisma/schema.prisma` persiste el estado de la plataforma: `InstalledProduct` (registro de
instalados con versión, estado, health, puerto y `packageHash`), `PackageArtifact`, `LifecycleRun`
(cada operación con pasos y timestamps), `AuditEvent`, `LogEntry`, `HealthSnapshot`, `BackupRecord`,
`DiagnosticBundleRec`, `SecretRecord`, `ConfigRecord`, `ProviderRecord` y `PlatformState`.
Los modelos demo `User`/`Post` del schema original fueron eliminados: el registro es 100% ALBRA.
