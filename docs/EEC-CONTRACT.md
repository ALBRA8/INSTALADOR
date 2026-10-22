# CONTRATO DE OPERACIONES EEC ↔ INSTALADOR — ALBRA V2

> Estado: **VERIFICADO** (curl e2e: autenticación, expiración, replay, despacho real).
> La EEC **no existe todavía** — solo su contrato de solicitud. El INSTALADOR no absorbe
> funciones de la EEC ni código de agentes especialistas (sección 2 del prompt maestro).

## Modelo de responsabilidad

```
EEC (futuro)  ──contrato autenticado y versionado──▶  INSTALADOR (ejecutor-verificador)
   asigna y coordina tareas                              ejecuta y verifica ciclo de vida
```

- El INSTALADOR **recibe solicitudes** de operaciones; nunca las inventa.
- Toda operación queda auditada con `actor:"EEC"` y el `requestId` de origen.

## Contrato (versión `1.0.0`)

`GET /api/ops` devuelve el contrato máquina-readable: operaciones, parámetros, síncrono/async,
timeouts. Error codes estables en `EEC_OPS_ERROR_CODES`.

### Autenticación (V1 del contrato)

| Mecanismo | Detalle |
|---|---|
| Bearer | `Authorization: Bearer <ops-token>` (32 bytes aleatorios, SecretStore cifrado, `timingSafeEqual`) |
| Expiración | ventana ≤ 5 min (`issuedAt`/`expiresAt`) → `REQUEST_EXPIRED` |
| Anti-replay | `nonce` único ≥16 chars por request → `NONCE_REPLAYED` |
| Versionado | `contractVersion` literal `"1.0.0"` → `INVALID_CONTRACT_VERSION` |

Rotación del token (admin): `POST /api/ops/token {"confirm":true}` → lo devuelve **una vez**
y lo guarda cifrado; auditado. `GET /api/ops` informa `tokenConfigured` sin exponer el token.

### Operaciones

Síncronas (respuesta directa): `STATUS`, `HEALTH`, `START`, `STOP`, `RESTART`, `BACKUP`,
`RESTORE`, `DIAGNOSTICS`.
Asíncronas (devuelven `runId` observable en `/api/runs/{id}`): `INSTALL`, `UPDATE`,
`ROLLBACK`, `UNINSTALL`.

```jsonc
// Request
{ "contractVersion": "1.0.0", "requestId": "<uuid>", "operation": "STOP",
  "productId": "crm", "params": {}, "issuedAt": "…", "expiresAt": "…", "nonce": "…" }
// Response
{ "contractVersion": "1.0.0", "requestId": "…", "accepted": true,
  "operation": "STOP", "productId": "crm", "result": { "detail": "Salida ordenada (SIGTERM …)" } }
```

### Códigos de error

`OPS_UNAUTHORIZED` · `INVALID_CONTRACT_VERSION` · `VALIDATION_ERROR` · `REQUEST_EXPIRED` ·
`NONCE_REPLAYED` · `UNSUPPORTED_OPERATION` · `PRODUCT_NOT_INSTALLED` · `OPERATION_FAILED`
(+ códigos técnicos de los motores, p. ej. `PRODUCT_BUSY`).

## Verificación ejecutada (real)

- Contrato completo por `GET /api/ops`; `tokenConfigured` cambia tras rotación.
- `STATUS crm` reflejó el proceso real (PID vivo, identidad, puerto, uptime — cross-check `ps`).
- `HEALTH crm` → 8/8 checks reales.
- `STOP crm` → salida ordenada verificada en el SO (PID muerto, puerto libre) →
  `START crm` → PID nuevo vivo.
- Token malo → 401 `OPS_UNAUTHORIZED`; nonce repetido → `NONCE_REPLAYED`;
  versión `2.0.0` → `INVALID_CONTRACT_VERSION`; request vencido → `REQUEST_EXPIRED`;
  operación inexistente → `UNSUPPORTED_OPERATION`.

## PENDIENTE DELIMITADO

- Autenticación fuerte futura: **HMAC de petición firmada por la EEC y/o mTLS** (nueva
  versión del contrato, `1.1.0`, sin romper la actual).
- Nonce store persistente/distribuido (hoy in-memory por instancia del INSTALADOR).
- Heartbeats de la EEC y tokens de larga vida con refresco.
