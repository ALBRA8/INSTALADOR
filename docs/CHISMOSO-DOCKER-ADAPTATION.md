# Adaptación de AGENTE-CHISMOSO al despliegue administrado por ALBRA

Estado: evaluación técnica; no es todavía un paquete instalable desde PANEL.
Fecha: 2026-11-09.

## Repositorio identificado

- Repositorio: https://github.com/ALBRA8/AGENTE-CHISMOSO
- Identidad provisional: `chismoso` (no registrar en catálogo hasta validar contrato, endpoints y ciclo de vida).
- El repositorio ya incluye un Dockerfile multi-stage y Compose: `docker-compose.yml` y `docker-compose.prod.yml`.
- La imagen ejecuta Next.js standalone y el CLI/scheduler de Chismoso; el Dockerfile configura un usuario no root y un healthcheck mediante `/api/livez` con fallback a `/api/health`.

## Stack actual observado

El Compose base define cinco servicios:

| Servicio | Función |
|---|---|
| `app` | Dashboard/API Next.js, puerto interno 3000 |
| `chismoso-scheduler` | Scheduler persistente que comparte SQLite |
| `chismoso-backup` | Copias periódicas |
| `redis` | Cache/rate-limit |
| `caddy` | Proxy inverso y TLS, publica 80/443 |

Volúmenes declarados: `chismoso_data`, `chismoso_reports`, `chismoso_backups`, `redis_data`, `caddy_data` y `caddy_config`.

## Bloqueos antes de administrarlo desde PANEL

1. **No desplegar el Compose actual sin adaptación.** Define `container_name` fijo para app, scheduler, backup, Redis y Caddy. Esto impide aislar con seguridad dos instalaciones y puede colisionar con contenedores ya existentes.
2. **No publicar Caddy desde el agente por defecto.** El PANEL/host debe controlar la entrada HTTP/TLS. Publicar 80/443 desde cada agente puede colisionar con el panel u otros servicios.
3. **No exponer el puerto 3000 al host por defecto.** El servicio debe quedar en una red Docker administrada y ser accesible por un proxy/gateway ALBRA.
4. **Secrets/env:** el Compose usa `.env.production`. ALBRA debe generar y custodiar secretos fuera del paquete; nunca copiar el `.env.production` del repositorio ni registrar su contenido.
5. **Datos persistentes:** conservar SQLite, reportes y backups en volúmenes con nombres aislados por instancia. Validar permisos UID/GID 1001.
6. **Build vs OCI:** el repositorio hoy usa `build:` e imágenes locales `:local`. El despliegue gestionado debe usar imágenes publicadas e inmutables por digest, o una compilación local explícita desde un commit fijado y verificado. No aceptar tags mutables como `latest`.
7. **Health y readiness:** comprobar health real de la app y disponibilidad de Redis antes de declarar la instalación exitosa. El scheduler y backup son procesos auxiliares; su estado debe exponerse por separado.
8. **Backups:** el sidecar actual hace backup periódico. ALBRA debe definir cómo verifica, restaura y exporta backups sin incluir secretos.

## Perfil recomendado para ALBRA

Crear un Compose administrado separado (por ejemplo, `compose.albra.yaml`) con estas características:

- Servicios app, scheduler, backup y Redis; sin Caddy embebido.
- Sin `container_name` fijos; usar nombres aislados por proyecto Compose.
- Sin puertos publicados directamente; gateway ALBRA conecta por red privada.
- Volúmenes persistentes dedicados por instalación.
- Variables y secretos suministrados desde archivos protegidos generados por el host.
- Imagen OCI fijada por digest para cada release aprobada.
- Recursos, límites de logs, `no-new-privileges` y usuario no root conservados.
- Healthchecks y dependencias explícitas; no declarar listo el agente hasta que app esté healthy.

## Secuencia de integración

1. Completar y validar primero el despliegue Docker del PANEL.
2. Resolver el contrato de red entre PANEL/gateway y servicios de agentes.
3. Publicar una imagen OCI de Chismoso y fijar su digest (o definir build reproducible desde commit).
4. Crear `compose.albra.yaml` y probar instalación aislada, reinicio, persistencia, backup y restore.
5. Definir contrato de agente y endpoints autenticados de status/health/control.
6. Añadir el producto al catálogo solo cuando el ciclo INSTALL/START/STOP/STATUS/HEALTH/UPDATE/ROLLBACK esté probado.

## No habilitado todavía

- Chismoso no está agregado al catálogo de INSTALADOR.
- El Compose existente no está listo para ser ejecutado directamente por el driver genérico de ALBRA.
- No se ha probado build ni despliegue real en este entorno.
- El adaptador Docker del INSTALADOR aún no está conectado a `preflight()` / `runInstall()`.
