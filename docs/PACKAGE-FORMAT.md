# ALBRA — Formato de Paquete ALBRA-PACKAGE 1.0.0

Fuente: `src/lib/albra/package/format.ts`. Un paquete ALBRA es un archivo `.albra` (JSON)
**firmado y verificable**. La cadena de confianza es:

```
PACKAGE ──► HASH ──► SIGNATURE ──► VERIFY ──► INSTALL
 (build)    sha256     HMAC-SHA256   verificación   staging + commit
```

## Constantes

- `PACKAGE_FORMAT = "ALBRA-PACKAGE"`, `PACKAGE_FORMAT_VERSION = "1.0.0"`.
- `SIGNATURE_KEY_ID = "albra-root-2025"` — clave raíz de firma de la plataforma.

## Estructura del paquete (`AlbraPackage`)

```
{
  format: "ALBRA-PACKAGE", formatVersion: "1.0.0",
  manifest:   { packageId, version, channel, displayName, createdAt, metadata },
  contract:   { ...ProductContract completo, revalidado al instalar },
  payload: {
    application: [ { path, sha256, content, encoding: "utf8" | "base64" } ],
    seeds:       { contacts?, deals?, leads? },      // datos iniciales 1.ª instalación
    migrations:  [ { migrationId, fromVersion, toVersion, ops[] } ],
    deployment:  { adapter, installStrategy }
  },
  integrity:  { algorithm: "sha256", payloadHash, packageHash },
  signature:  { algorithm: "HMAC-SHA256", keyId: "albra-root-2025", value }
}
```

## Construcción y firma (`buildPackage`)

1. **Hash por archivo**: cada entrada de `application` lleva su `sha256` del contenido.
2. **`payloadHash`**: SHA-256 de `JSON.stringify(payload)`.
3. **`packageHash`**: SHA-256 del *core canónico* — `{ format, formatVersion, manifest,
   contract, payloadHash }` con claves ordenadas (`canonical()`), para que el hash sea
   determinista independiente del orden de serialización.
4. **Firma**: `signPackageHash(packageHash)` = HMAC-SHA256 con la master key
   (`keys/package-signing.key`, 32 bytes aleatorios generados una vez y persistidos con modo
   `0600`, gestionada por `core/package-keys.ts`). El resultado se guarda en
   `signature.value` con su `keyId`.

Cualquier cambio en el manifiesto, el contrato o un solo byte del payload invalida
`packageHash` y, con ello, la firma.

## Verificación (`verifyPackage`)

Pipeline de rechazo en capas — un paquete inválido **nunca se instala**:

| Código de rechazo | Cuándo ocurre |
|---|---|
| `PACKAGE_MALFORMED` | El dato recibido no es un objeto |
| `PACKAGE_FORMAT_UNKNOWN` | `format ≠ "ALBRA-PACKAGE"` |
| `PACKAGE_FORMAT_VERSION_UNSUPPORTED` | Versión de formato no soportada |
| `PACKAGE_MANIFEST_INVALID` | Falta `packageId` o `version` |
| `PACKAGE_PAYLOAD_INVALID` | `payload.application` no es array |
| `FILE_CHECKSUM_MISMATCH: <path>` | El SHA-256 de un archivo no coincide con su contenido |
| `PAYLOAD_HASH_MISMATCH` | `payloadHash` recalculado ≠ declarado |
| `PACKAGE_HASH_MISMATCH` | `packageHash` recalculado ≠ declarado |
| `SIGNATURE_INVALID` | La HMAC no corresponde al `packageHash` |
| `PACKAGE_PARSE_ERROR` | Excepción al procesar el JSON |

Orden real de comprobación: estructura → checksum por archivo → `payloadHash` →
`packageHash` → firma HMAC. La verificación devuelve `{ valid: true, packageHash,
packageId, version }` o `{ valid: false, reason, ... }`.

## Paquete tampered (demostración)

La demo de manipulación toma un paquete válido de la bóveda y altera su contenido (p. ej.,
un byte de `product.js` o el propio manifiesto) manteniendo los hashes/firma originales.
`verifyPackage` lo rechaza de forma determinista: si se modifica un archivo falla
`FILE_CHECKSUM_MISMATCH`; si se recalculan los hashes pero no la firma, falla
`SIGNATURE_INVALID`. El installer registra el evento de auditoría `PACKAGE_REJECTED`
(con la `reason` como detalle, severidad ERROR) y aborta antes de crear staging —
demostrando que la cadena PACKAGE→HASH→SIGNATURE→VERIFY→INSTALL corta antes de INSTALL.

## Bóveda de paquetes

- `writePackageFile(pkg)` persiste en `packages/` con nombre `<packageId>-<version>.albra`.
- `readPackageFile(fileName)` lee y parsea; devuelve `null` si no existe o es inválido.
- `packageFilePath()` aplica **defensa path-traversal**: solo acepta el nombre plano del
  archivo (`path.basename`), nunca rutas relativas.
- La bóveda es la fuente de DOWNLOAD en installer/updater y de la restauración en el
  rollback post-commit (la versión anterior se re-descarga y re-verifica desde la bóveda).

## Paquetes incluidos (catálogo de builds)

`products/catalog.ts` define los builds de la bóveda:

- **crm 1.0.0** — `manifest.json`, `product.js`, `CHANGELOG.md`, `README.md` + seeds (contactos y deals).
- **crm 1.1.0** — mismo payload + migración `crm-2-tags` (`ADD_COLUMN:tags`,
  `BACKFILL:tags=''`, `ENABLE_FEATURE:tags`) y feature `tags` en el manifiesto.
- **leads 1.0.0** — `manifest.json`, `product.js`, `README.md` + seeds de leads.

Cada build embarca su `ProductContract` completo; el contrato se revalida con Zod al instalar.
