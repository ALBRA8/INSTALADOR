# Adaptador de despliegue del PANEL DE CONTROL

Estado: especificación técnica de integración, no implementación terminada.  
Fecha: 2026-11-09.

## Decisión

El PANEL DE CONTROL no debe añadirse todavía a `CATALOG` como producto instalable. El catálogo actual construye paquetes ALBRA con archivos de aplicación (`product.js`, manifiesto y recursos) y el contrato de despliegue existente de CRM/LEADS declara `kinds: ["local"]` con adaptador `windows-local`. El PANEL, en cambio, se entrega como una aplicación Next.js standalone en una imagen Docker, necesita un volumen persistente SQLite y requiere secretos de arranque.

Incluirlo ahora como si fuera otro proceso `product.js` produciría una entrada visible que el motor no puede desplegar correctamente.

## Evidencia inspeccionada

- `src/lib/albra/products/catalog.ts`: `PACKAGE_BUILDS` genera CRM y LEADS a partir de archivos UTF-8 y sus contratos.
- `src/lib/albra/package/format.ts`: el paquete ALBRA v1 incluye `payload.application[]` y `payload.deployment: { adapter, installStrategy }`; no define todavía un artefacto de imagen OCI ni su política de descarga.
- `PANEL-DE-CONTROL/Dockerfile`: construye Next.js standalone con Bun y Prisma.
- `PANEL-DE-CONTROL/compose.yaml`: requiere volumen persistente y secretos `EEC_OPERATOR_PASSWORD`, `EEC_SESSION_SECRET` y `EEC_API_TOKEN`.
- `deploy/docker-entrypoint.sh`: valida secretos, ejecuta `prisma db push --skip-generate` y arranca `server.js`.
- `src/app/api/health/route.ts`: health check valida conectividad SQLite y responde 503 si la base no está disponible.

## Contrato propuesto para el adaptador

Identificador provisional: `docker-compose`.

El adaptador debe implementar el mismo ciclo de vida que espera el motor ALBRA y devolver evidencia estructurada para cada operación:

| Operación | Comportamiento mínimo |
|---|---|
| PREFLIGHT | Verificar Docker Engine/Compose, arquitectura, espacio, puertos y permisos de volumen |
| INSTALL | Obtener artefacto aprobado, validar digest/firma, crear directorio de estado y secretos, iniciar servicio |
| STATUS | Consultar estado real del contenedor y mapearlo a estado ALBRA |
| HEALTH | Consultar healthcheck y validar respuesta HTTP |
| STOP / START / RESTART | Operar únicamente el servicio administrado |
| BACKUP | Copia consistente de SQLite y configuración no secreta; excluir secretos del backup exportable |
| RESTORE | Validar backup, detener servicio, restaurar datos y verificar health |
| UPDATE | Descargar versión aprobada, verificar digest, conservar backup y recrear servicio |
| ROLLBACK | Volver a digest anterior y restaurar datos compatibles |
| UNINSTALL | Detener y retirar contenedor; preservar datos salvo confirmación explícita de borrado |

## Metadatos mínimos del producto

El futuro contrato de producto debe declarar explícitamente:

- `productId: panel-de-control`
- versión semántica e identificador inmutable del artefacto OCI
- digest SHA-256 de la imagen (no confiar solo en tags)
- plataformas y arquitecturas realmente publicadas
- puertos configurables y política de exposición (por defecto, no publicar administración en interfaces públicas sin proxy/TLS)
- volumen persistente para SQLite
- variables secretas requeridas, generadas por el instalador y nunca incluidas en el paquete ni en logs
- healthcheck, tiempos de arranque y política de reinicio
- estrategia de backup, migración y rollback

## Seguridad y operación

1. No guardar secretos en `.env` versionado, manifiestos, logs ni paquetes.
2. Generar secretos criptográficamente aleatorios en el host y limitar permisos del archivo de entorno.
3. No exponer el puerto de administración a Internet por defecto. En VPS, exigir proxy inverso con TLS o túnel privado.
4. Descargar imágenes desde un registry permitido y verificar digest antes de ejecutar.
5. No usar `latest` como versión desplegable.
6. Aplicar límites de CPU/memoria y política de reinicio.
7. Verificar persistencia tras reinicio del contenedor y del host.
8. No borrar el volumen al desinstalar salvo operación separada y explícita.

## Criterios de aceptación

- [ ] El preflight detecta Docker/Compose ausente y entrega instrucciones sin modificar el host.
- [ ] Una instalación limpia en Linux y Windows con Docker crea el servicio y el volumen persistente.
- [ ] Los secretos se generan fuera del paquete y no aparecen en logs.
- [ ] El healthcheck pasa solo cuando la aplicación y SQLite responden.
- [ ] Reiniciar contenedor y host conserva los datos.
- [ ] STOP/START/RESTART/STATUS/HEALTH operan sobre la instancia correcta.
- [ ] Backup/restore se prueba con datos reales.
- [ ] Update/rollback valida digest y compatibilidad de esquema.
- [ ] Un VPS no queda expuesto públicamente sin TLS y autenticación.
- [ ] El producto solo se incorpora a `CATALOG` cuando este adaptador y sus pruebas estén integrados.

## Próximo orden de implementación

1. Definir una interfaz de adaptador de despliegue independiente del adaptador local actual.
2. Implementar adaptador Docker Compose con operaciones y evidencia.
3. Extender preflight para detectar Docker y requisitos de host.
4. Extender el formato de paquete para referenciar artefactos OCI por digest, conservando compatibilidad con paquetes actuales.
5. Añadir pruebas de contrato, seguridad, persistencia y rollback.
6. Solo entonces registrar `panel-de-control` en `PACKAGE_BUILDS` y `CATALOG`.
7. Conectar el adaptador HTTP EEC del PANEL con las rutas reales del INSTALADOR y ejecutar piloto E2E local y VPS.

## Bloqueo conocido

El health endpoint del PANEL comprueba SQLite, pero el endpoint actual no está autenticado. Esto puede ser aceptable para un healthcheck local limitado a loopback, pero antes de publicar el servicio detrás de un proxy debe revisarse la política de exposición y evitar que el endpoint revele información operacional innecesaria.
