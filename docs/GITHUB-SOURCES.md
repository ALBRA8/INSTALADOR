# INSTALACIÓN GENÉRICA DESDE GITHUB — ALBRA V2

> Estado: **VERIFICADO e2e** contra el release real
> `github.com/ALBRA8/INSTALADOR → tag crm-v1.0.0` (asset `crm-1.0.0.albra`).

## Objetivo

Incorporar diferentes agentes/productos ALBRA **sin escribir un instalador por repositorio**,
fijando siempre la procedencia a una versión inmutable.

## Regla de versiones (obligatoria)

| refType | aceptado | ejemplo |
|---|---|---|
| `release` | sí (preferido) | `crm-v1.0.0` |
| `tag` | sí (desreferencia tags anotados → commit) | `v2.1.3` |
| `commit` | sí (sha 40-hex validado) | `451d7203…` |
| rama (`main`, `master`, `develop`, `refs/heads/*`) | **RECHAZADO** → `BRANCH_REF_REJECTED` | — |

Nunca se trata una rama como versión inmutable.

## Flujo de importación (`sources/github.ts`)

```
resolveGithubSource (GitHub REST; token opcional)
  → downloadGithubAsset (streaming, límite 200 MB, timeout 60 s, sha256 en vuelo)
  → verificación de origen: línea `albra-sha256: <hash>` en el body del release
      (si existe y difiere → ORIGIN_CHECKSUM_MISMATCH, archivo eliminado)
  → verifyPackage (integridad + autenticidad, ver TRUST-CHAIN.md)
  → parseProductContract (validación Zod del contrato embebido)
  → bóveda local (conflicto por packageHash → PACKAGE_CONFLICT; igual hash → idempotente)
  → audit SOURCE_RESOLVED + PACKAGE_IMPORTED (procedencia registrada)
```

Autenticación: `GITHUB_TOKEN` (env) o `albra-data/keys/github.token` (0600). El token
nunca se loguea (redacción defensiva). Permisos mínimos recomendados: `repo:read`.

## APIs

| Endpoint | Uso |
|---|---|
| `POST /api/sources/resolve` | dry-run: resuelve repo+ref → tag/commit/asset + checksum declarado |
| `POST /api/packages/import` | resuelve + descarga + verifica + importa a la bóveda |
| `POST /api/install` | acepta `{packageId}` (bóveda) **o** `{source:{repo, refType, ref, assetName?}}` |
| `GET /api/packages` | lista con verificación y `trustLevel` |

## Preparación de dependencias (`core/deps.ts`)

Se ejecuta durante `PREPARE`/`INSTALL` del instalador, en el **staging** (nunca sobre la
versión activa), con tiempos límite y logs conservados.

| Runtime | Soporte | Acción |
|---|---|---|
| node | **VERIFIED_LOCAL** | detección de versión; `npm install --omit=dev` aislado en el appDir |
| bun | **VERIFIED_LOCAL** | detección; `bun install --production` aislado en el appDir |
| python | BEST_EFFORT_UNTESTED | `python3 -m venv .albra-venv` + pip `requirements.txt` |
| otros (java, ruby…) | **UNSUPPORTED_RUNTIME** (explícito, nunca silencioso) | — |

Runtime requerido ausente → `RUNTIME_MISSING` (fallo de instalación con mensaje claro).
No se modifican dependencias globales del sistema.

## Política de scripts de terceros (sección 4.4)

Los scripts de instalación son **código ejecutable**: por defecto `policy: "BLOCKED"`.

- Paquete con `install.scripts` y sin aprobación → instalación detenida:
  `INSTALL_SCRIPTS_BLOCKED` con mensaje al usuario.
- Aprobación explícita: `POST /api/packages/trust {fileName, approve:true}` → se registra
  en `PlatformState` (`trust:scripts:<fileName>`) + audit `TRUST_POLICY_CHANGED`.
- Con aprobación: los scripts se **escriben pero NO se ejecutan** (ejecución diferida a
  wave futuro). Ningún script se ejecuta automáticamente por aparecer en un repositorio.

## Verificación ejecutada (real)

- `resolve` de `crm-v1.0.0` → tag + commitSha `451d7203…` + asset 13 838 B + checksum.
- `import` → sha256 en vuelo == `f8a9b24c…4492` (== declarado en el release) → bóveda.
- Rechazos: `refType:"tag", ref:"main"` → `BRANCH_REF_REJECTED`; release/asset inexistente
  → `SOURCE_NOT_FOUND`.
- Regresión: instalación desde bóveda idéntica (15/15 pasos, `origin` NULL).
- Scripts: bloqueo sin aprobación → `INSTALL_SCRIPTS_BLOCKED`; con aprobación → escritos,
  no ejecutados.
- Dependencias: `bun install --production` aislado OK; `java` → `UNSUPPORTED_RUNTIME`.

## Pendidientes declarados

- Instalación de `packageId` fuera del catálogo requiere extender `DISCOVER` (hoy el
  catálogo define los productos instalables).
- Descarga de asset solo para `refType:"release"` (tag/commit resuelven procedencia,
  el artefacto binario viene del release).
- Inyección de fallos en vivo para `ORIGIN_CHECKSUM_MISMATCH`/`ASSET_TOO_LARGE`/
  `GITHUB_UNREACHABLE` verificada por rutas de código.
