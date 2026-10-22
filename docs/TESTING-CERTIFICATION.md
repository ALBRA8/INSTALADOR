# ALBRA — Testing y Certificación de Plataforma

Fuentes: `core/runs.ts`, `core/updater.ts` (inyección de fallos), `core/audit.ts`
(`CERTIFICATION_COMPLETED`, `CLEANROOM_RESET`), `prisma/schema.prisma`
(`LifecycleRun.operation` incluye `CERTIFICATION | CLEANROOM`).

## Filosofía

ALBRA no se "testeó una vez": **se certifica en vivo**. La certificación es una operación más
del ciclo de vida (`operation: CERTIFICATION` en `LifecycleRun`), ejecutable desde la UI,
que recorre la plataforma de extremo a extremo y produce resultados reales, persistidos y
observables. Cada operación de la plataforma ya es observable por diseño (`Run` con pasos,
estados, timestamps y `durationMs`), y el servidor puede esperar su finalización con
`awaitRun(runId)` / `registerRunPromise()` — mecanismo creado explícitamente para
"await server-side (certification)".

## Certification runner (suite completa)

El runner encadena las capacidades críticas de la plataforma como sub-operaciones reales,
usando los motores de siempre (no caminos especiales de prueba):

1. **Verificación de paquetes** — `verifyPackage()` contra los builds de la bóveda
   (`crm 1.0.0`, `crm 1.1.0`, `leads 1.0.0`) y contra un paquete **tampered** de
   demostración que debe ser rechazado con `SIGNATURE_INVALID` / `FILE_CHECKSUM_MISMATCH`.
2. **Preflight** — compatibilidad, disco, dependencias, permisos y resolución de puertos.
3. **Instalación transaccional** — los 15 estados hasta `COMPLETE`, con health final `HEALTHY`.
4. **Update con migración** — CRM `1.0.0 → 1.1.0` con la migración `crm-2-tags` aplicada.
5. **Rollback** — restauración de la versión anterior vía bóveda + backup `PRE_UPDATE`.
6. **Uninstall con modos de datos** — `KEEP / EXPORT / DELETE`.
7. **Health checks** — `overall` correcto por producto (CRM 7 checks, LEADS 4).

La **inyección de fallos** del updater (`InjectFailure: "MIGRATION" | "START"`) permite
certificar el camino infeliz: el run debe terminar en `ROLLED_BACK`, con la versión anterior
restaurada, datos recuperados desde el backup y salud verificada.

Cada ejecución queda como `LifecycleRun` consultable y dispara el evento de auditoría
`CERTIFICATION_COMPLETED`. Los resultados mostrados en la UI son los generados al ejecutar
la suite — no hay métricas pre-cocinadas.

## Clean-room test

La prueba **clean-room** (`operation: CLEANROOM`, auditoría `CLEANROOM_RESET`) verifica el
escenario "caja vacía": un entorno sin estado previo debe poder instalarse desde cero.

1. **Reset** — se limpia el estado de plataforma (registro de instalados, configuración,
   secretos, snapshots de health, runs, datos de producto) y los directorios derivados de
   `ALBRA_HOME`, conservando únicamente la bóveda de paquetes y las llaves.
2. **Reinstalación desde cero** — sobre ese estado limpio se ejecuta el ciclo completo:
   preflight → install (CRM y LEADS) → seeds iniciales → arranque → health.
3. **Verificación de aislamiento** — los datos de CRM y LEADS quedan en sus tablas propias
   (`CrmContact/CrmDeal` vs. `LeadRecord`) y sus puertos no colisionan.

El clean-room demuestra que la plataforma no depende de artefactos ocultos ni de sesiones
previas: con solo la bóveda firmada y las llaves, el sistema reconstruye todo.

## Estados y criterios de la suite

- Estado por operación: `RUNNING | SUCCESS | WARNING | FAILURE | ROLLED_BACK`
  (`LifecycleRun.status`); por paso: `PENDING | RUNNING | SUCCESS | WARNING | FAILURE | SKIPPED`.
- Criterios duros: ningún `PACKAGE_INVALID` sobre paquetes legítimos, rechazo garantizado
  del tampered, instalación idempotente de seeds, rollback sin pérdida de datos, `overall`
  de health `HEALTHY` tras cada operación feliz.
- Todo detalle viaja redactado (`redactValue`): la certificación nunca imprime secretos.

## Qué certifica esta suite (resumen)

| Capacidad | Evidencia |
|---|---|
| Cadena de confianza de paquetes | `PACKAGE_VERIFIED` / `PACKAGE_REJECTED` + hashes |
| Transaccionalidad de instalación | runs INSTALL `SUCCESS` o rollback limpio |
| Update + migración idempotente | `crm-2-tags` aplicada, `schemaVersion` 2 |
| Rollback automático y post-commit | runs `ROLLED_BACK` / ROLLBACK `SUCCESS` |
| Aislamiento de productos | tablas, puertos y locks separados |
| Observabilidad | pasos, duraciones y auditoría persistidos |
