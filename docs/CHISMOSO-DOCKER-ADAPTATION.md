# Adaptación de AGENTE-CHISMOSO al despliegue administrado por ALBRA

Estado: perfil Compose ALBRA creado en AGENTE-CHISMOSO; pendiente de imagen OCI fijada, red gateway, pruebas y conexión al motor. No es todavía instalable desde PANEL.
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

Se añadió `compose.albra.yaml` en `ALBRA8/AGENTE-CHISMOSO` como perfil separado, sin modificar el despliegue independiente existente. El perfil contiene estas decisiones:

- Servicios app, scheduler, backup y Redis; sin Caddy embebido.
- Sin `container_name` fijos; usar nombres aislados por proyecto Compose.
- Sin puertos publicados directamente; gateway ALBRA conecta por red privada.
- Volúmenes persistentes dedicados por instalación.
- Variables y secretos suministrados desde `.env.albra`, que el instalador debe crear con permisos restrictivos (0600) y fuera del paquete. El driver debe invocar Compose con `--env-file .env.albra` (resuelto y confinado al directorio de esa instalación), porque Compose no carga automáticamente un archivo con ese nombre para interpolación.
- `CHISMOSO_IMAGE` y `CHISMOSO_REDIS_IMAGE` son obligatorias y deben ser referencias OCI `@sha256:` inmutables; no se han publicado ni fijado todavía.
- Recursos, límites de logs, `no-new-privileges` y usuario no root conservados.
- Healthchecks y dependencias explícitas; app y scheduler conectados a la red externa `albra-agents`; el instalador debe crearla antes del `compose up`. No declarar listo el agente hasta que app esté healthy.

## Secuencia de integración

1. Completar y validar primero el despliegue Docker del PANEL.
2. Resolver el contrato de red entre PANEL/gateway y servicios de agentes.
3. Publicar una imagen OCI de Chismoso y fijar su digest (o definir build reproducible desde commit).
4. Completar digest OCI y `.env.albra`; crear la red `albra-agents`; probar instalación aislada, reinicio, persistencia, backup y restore.
5. Definir contrato de agente y endpoints autenticados de status/health/control.
6. Añadir el producto al catálogo solo cuando el ciclo INSTALL/START/STOP/STATUS/HEALTH/UPDATE/ROLLBACK esté probado.

## No habilitado todavía

- Chismoso no está agregado al catálogo de INSTALADOR.
- El perfil ALBRA ya existe, pero aún no se ha validado con `docker compose config`, build ni despliegue real.
- No se ha probado build ni despliegue real en este entorno; no hay aún digest de imagen aprobado.
- El adaptador Docker del INSTALADOR aún no está conectado a `preflight()` / `runInstall()`.


### Progreso del driver (2026-11-09)
- `runDockerCompose` acepta ahora `envFile` opcional y pasa `--env-file` a Compose para la interpolación de variables.
- El archivo debe ser una ruta relativa dentro del producto; se valida el destino real para impedir escapes por symlink.
- En sistemas POSIX se rechazan permisos más amplios que 0600.
- Se añadió `docker-compose.test.ts` con pruebas para ruta fuera del producto, archivo ausente, permisos amplios y ruta absoluta.
- Las pruebas todavía no se han ejecutado y el driver sigue sin integrarse al motor `preflight()` / `runInstall()`.


## Correcciones detectadas en revisión de runtime (2026-11-09)

- El Dockerfile instala ahora `bash` y `sqlite` en la imagen final: `backup-sqlite.sh` usa sintaxis Bash y requiere el ejecutable `sqlite3`.
- El directorio persistente `/data` se crea con propietario UID/GID 1001, para que el usuario no root pueda escribir SQLite, configuración y logs; `/opt/scripts` conserva permisos de lectura/ejecución para ese usuario.
- El scheduler deja de depender de rutas absolutas del entorno de desarrollo. Su configuración usa `CHISMOSO_WATCH_CONFIG` o `/data/watch.json`; el log usa `CHISMOSO_SCHEDULER_LOG_PATH` o `/data/scheduler.log`.
- Se confirmó que el Dockerfile copia ambos scripts a `/opt/scripts`, instala `tini` y que TypeScript compila el entrypoint `src/scheduler/run.ts` a `dist/scheduler/run.js`, que coincide con el comando del perfil.
- Estas son correcciones de código revisadas en GitHub; aún falta ejecutar `docker build`, `docker compose config` y una prueba de arranque/backup con volúmenes reales. No declarar el perfil validado hasta completar esas pruebas.


## Bloqueo confirmado en el motor del INSTALADOR (2026-11-09)

La integración no es segura si se limita a llamar al driver desde `runInstall()`:

- `preflight()` siempre obtiene el adapter local, asigna un puerto del host y valida compatibilidad con el contrato actual; no inspecciona un tipo de despliegue Docker.
- `runInstall()` siempre extrae `payload.application[]` a staging, hace commit a un directorio de aplicación y finalmente llama a `startProductCore()`.
- `startProductCore()` administra procesos del host mediante PID/puerto/health autenticado; no administra proyectos Compose ni persiste su identidad.
- `ProductContractSchema.deployment` solo acepta `local | selfhosted | saas` y adapters `windows-local | linux-local | local-dev | selfhosted-vps`.
- El paquete ALBRA v1 solo lleva `deployment: { adapter, installStrategy }`; no transporta un digest OCI ni un contrato de archivos Compose/secretos.

Por tanto, no se debe añadir CHISMOSO al catálogo ni ejecutar `runDockerCompose()` desde el flujo actual hasta definir una estrategia de despliegue discriminada y persistir el identificador del proyecto Compose. La rama Docker debe omitir el puerto publicado del host, generar el env-file fuera del paquete, preparar la red externa, ejecutar pull/up, esperar health y registrar/recuperar el stack; el rollback debe detener solo ese proyecto sin borrar volúmenes.
