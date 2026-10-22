# CADENA DE CONFIANZA `.albra` — ALBRA V2

> Estado: **VERIFICADO** (suite 15/15 + curl e2e). Autoridad central de firma de
> producción: **PENDING** (delimitado abajo).

## Principio: integridad ≠ autenticidad

- **Integridad**: los bytes no cambiaron (SHA-256 por archivo → payloadHash → packageHash).
  Un hash **no demuestra quién produjo el paquete**.
- **Autenticidad**: prueba de quién firmó (Ed25519 asimétrico + registro de claves confiables).

La firma HMAC local (V1) era una clave compartida: no puede probar procedencia universal.
V2 la conserva como **modo de desarrollo explícito** (`DEV_LOCAL`) — nunca como prueba de origen.

## Formato de firma v2

```jsonc
"signature": {
  "format": "albra-sig-2",
  "alg": "ed25519" | "hmac-dev",
  "keyId": "albra-signer-<12 hex>",   // derivado de sha256(SPKI DER)
  "value": "<base64>"
}
```

Formato legacy (sin `format`/`alg`) aceptado y clasificado `DEV_LOCAL`.

## Niveles de confianza (`verifyPackage`)

| Resultado | `trustLevel` | Consecuencia |
|---|---|---|
| Ed25519 + keyId FULL registrado | `TRUSTED` | instalable |
| Ed25519 + keyId no registrado | `UNTRUSTED_SIGNER` | instalable solo si el contrato no exige firmas; si exige → `SIGNER_NOT_TRUSTED` |
| Ed25519 + keyId **revocado** | — | rechazado: `SIGNING_KEY_REVOKED` |
| HMAC local / legacy | `DEV_LOCAL` | instalable (integridad OK) con advertencia visible |
| Manipulado | — | rechazado: `FILE_CHECKSUM_MISMATCH` / `SIGNATURE_INVALID` |

## Gestión de claves (`core/signing.ts`)

- **Privada**: `albra-data/keys/signing/private.pem` — **0600**, jamás en paquetes,
  repositorio ni registros. La posesión de la clave de firma no otorga permisos de
  instalación (separación de roles).
- **Públicas**: `keys/signing/<keyId>.pub` + registro `trusted.json`
  `{keys:[{keyId,name,addedAt,trust:"FULL"|"DEV"}], revoked:[{keyId,revokedAt,reason}]}`.
- **Rotación**: `POST /api/trust/keys {action:"rotate"}` → nuevo par activo; los paquetes
  viejos siguen verificando si la clave anterior sigue `trusted`.
- **Revocación**: `{action:"revoke", keyId, reason}` → los paquetes firmados por esa clave
  pasan a rechazarse; re-confiar una clave revocada → `KEY_REVOKED_CANNOT_TRUST`.
- Auditoría completa: `KEY_GENERATED`, `KEY_REVOKED`, `TRUST_POLICY_CHANGED`.

## APIs

| Endpoint | Uso |
|---|---|
| `GET /api/trust/keys` | identidad activa + claves confiables/revocadas + matriz de soporte |
| `POST /api/trust/keys` | `generate` \| `trust` \| `revoke` \| `rotate` |
| `POST /api/packages/verify` | `{fileName}` → `{valid, trustLevel, signerKeyId, reasons}` |
| `GET /api/packages` | bóveda con `verified`, `trustLevel`, `signatureAlg`, `signerKeyId`, origen |

## Salvaguardas de formato

- Máximos: paquete 100 MB, archivo 25 MB, 500 archivos → `PACKAGE_TOO_LARGE` / `FILE_TOO_LARGE`.
- Paths: absolutos, `..`, backslash de Windows, vacíos y duplicados → `PATH_UNSAFE` /
  `DUPLICATE_PATH`. Extracción confinada al directorio autorizado.

## Verificación ejecutada (real)

- Generación idempotente de identidad → `albra-signer-…` (0600).
- Bóveda re-firmada → los 3 paquetes oficiales `ed25519 / TRUSTED`;
  `crm-1.0.0-tampered` → rechazado con `FILE_CHECKSUM_MISMATCH`.
- Rotación + revocación + re-trust verificados por API.
- Paquete legacy HMAC → `valid:true, trustLevel:"DEV_LOCAL"`.
- Límites y paths peligrosos → rechazados (suite `scripts/wave-d-trust-tests.ts`, 15/15).

## PENDIENTE DELIMITADO (importante)

**No existe hoy una autoridad central de firma de producción.** `TRUSTED` significa
"clave FULL registrada localmente", no procedencia de un vendor. Para distribución entre
equipos/entornos se requiere: CA ALBRA o firma en CI con claves HSM, transparencia de
claves (log público) y política de quórum. Mientras tanto, el modo de desarrollo es
seguro para el equipo local y está etiquetado sin ambigüedad en toda la superficie.
