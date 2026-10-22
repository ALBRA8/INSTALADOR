# RUNTIME REAL DE PROCESOS — ALBRA V2

> Estado: **VERIFICADO en sandbox Linux** (adapter `local-dev`). Rama win32 implementada,
> marcada **UNTESTED** (no ejecutable en sandbox). VPS: especificado (WAVE 11).

## Principio

La base de datos **registra evidencia; no es la fuente de verdad**. El estado real de un
producto se verifica contra el sistema operativo:

```
pidfile (identidad)  →  ¿proceso vivo? (señal 0)  →  ¿línea de comando corresponde a
nuestro entrypoint + productId? (/proc o CIM)  →  ¿/health autenticado responde con
el mismo PID?  →  estado REAL
```

Máquina de estados del SO (`RuntimeOsState`):

| Estado | Significado |
|---|---|
| `RUNNING` | pidfile + vivo + identidad verificada + DB coherente |
| `ORPHAN_RUNNING` | vivo en el SO pero la DB no lo sabe → **adopción segura** |
| `CRASHED` | terminación inesperada (sin `exit.json`) → evidencia + audit |
| `EXITED_CLEAN` | salida ordenada registrada por el propio producto |
| `LOST` | DB decía RUNNING pero no hay pidfile ni proceso |
| `UNKNOWN` | vivo pero identidad no verificable → no se toca, no se duplica |

## Componentes

### `core/process-runtime.ts` (gestor de procesos reales)
- **Spawn**: `execPath` del INSTALADOR (node/bun) + `app/product.js --port N`; argv
  estructurado (sin shell), `detached`, `windowsHide`, cwd = dir de la app.
- **Env allowlist estricto**: `ALBRA_PRODUCT_ID/VERSION/PORT/BOOT_TOKEN/DATA_DIR/RUNTIME_DIR`,
  `PATH`, `HOME`, `TMPDIR`, `NODE_ENV`. Nunca secretos del INSTALADOR.
- **Logs reales**: `albra-data/logs/products/<id>/{out,err}.log` con rotación
  (1.5 MB × 3 generaciones) y `tail` para evidencia.
- **pidfile**: `products/<id>/runtime/process.json` = `{pid, bootToken, port, productId,
  version, startedAt, entryPath, execPath, platform}` (escritura atómica).
- **Stop ordenado**: SIGTERM → encuesta (8 s) → SIGKILL (win32: `taskkill` /T /F);
  **nunca mata un PID cuya identidad no verifica** (`IDENTITY_MISMATCH`).
- **`probeHealth`**: `GET 127.0.0.1:<port>/health` con header `x-albra-token`;
  cross-check del PID devuelto por el producto (protege frente a reuso de puerto).

### Producto instrumentado (`app/product.js`)
Servidor HTTP real (node/bun, cero dependencias) generado por la plataforma:
- `GET /health` (autenticado): `{ok, product, version, pid, uptimeS, state}`.
- `GET /api/diag`, `GET /api/status`, `POST /api/echo` (todos autenticados; 401 sin token).
- **Heartbeat** cada 5 s → `runtime/heartbeat.json`.
- `SIGTERM/SIGINT` → `exit.json {reason, pid, at, uptimeS}` → salida 0 (evidencia de
  parada ordenada). `kill -9` no deja `exit.json` → el sistema lo clasifica `CRASHED`.

### `core/runtime.ts` (operaciones)
- `START`: verifica SO → adopta huérfano o genera bootToken nuevo → spawn → espera
  `/health` autenticado (12 s) → registra `{state: RUNNING, pid, bootToken, port}`.
  Fallo → limpieza compensatoria + audit `START_FAILED` con stderr.
- `STOP`: parada ordenada verificada → DB `STOPPED` + `lastExitEvidence`.
- `RESTART`: stop + start (sin duplicados: la identidad del pidfile lo impide).
- `isRunning`: consulta el SO, no la DB.
- `getRuntimeEvidence`: PID, uptime, puerto, `portServing`, healthProbe, errTail —
  lo que consume la GUI ("Ejecución real").

### Reconciliación (arranque del INSTALADOR)
`bootstrap → reconcileAll()`: por cada producto instalado compara DB ↔ SO:
- Huérfano vivo → **adopta** (misma instancia, sin duplicar) + audit `PROCESS_ADOPTED`.
- Crash sin salida → DB `FAILED` + evidencia + audit `PROCESS_CRASHED`.
- Estado perdido → corrige a `STOPPED` + audit `PROCESS_LOST`.

## Health checks (contrato)
| check | qué verifica | crítico |
|---|---|---|
| `runtime` | proceso real vivo + identidad (no la DB) | sí |
| `http-health` | `/health` autenticado 200 con PID correcto (SKIP si el producto no lo declara) | sí (crm/leads) |
| `port` | si RUNNING: el puerto debe estar sirviendo; si detenido: libre | no |
| `application` / `database` / `storage` / `dependencies` / `providers` | igual que V1 | según contrato |

## Verificación ejecutada (real, no simulada)
1. Instalación 15 pasos → START real → `ss` muestra `127.0.0.1:4101` con PID propio.
2. `/health` con token → 200; sin token → 401; cross-check de PID correcto.
3. Muerte del INSTALADOR → el producto sobrevive (detached) → reinstalación lo **adopta**
   (mismo PID + bootToken en DB).
4. `kill -9` → health `FAILED` ("Terminación inesperada (PID …)") + evidencia persistida.
5. START posterior → nuevo PID → HEALTHY.
6. Certificación V2 completa: **18/18 PASS** con procesos reales.

## Windows (delimitado)
`WindowsLocalAdapter` + ramas win32 en process-runtime implementan la semántica nativa
(PowerShell `Get-CimInstance` para identidad, `taskkill` para parada, `windowsHide`).
**No ha sido ejecutable en este entorno** — queda pendiente de pruebas en el equipo
Windows objetivo. No se declara probado.

## Pendidientes declarados
- El producto aún no sirve su plano de datos propio por HTTP (los datos CRM/LEADS se
  gestionan por el plano de control detrás de `assertRunning`); decisión documentada.
- Logs como servicio de Windows (servicio nativo) — futuro; hoy proceso de usuario.
