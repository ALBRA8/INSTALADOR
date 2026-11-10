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


## Contrato tipado de despliegue Docker — base aditiva (2026-11-09)

Se añadió `src/lib/albra/contracts/docker-compose.ts` y su export desde `contracts/index.ts`. El descriptor valida:

- paths relativos POSIX normalizados, sin absolutos, separadores Windows ni traversal;
- archivo Compose YAML;
- `envFile` como ruta generada por el instalador (no contenido secreto dentro del paquete);
- nombre de proyecto Compose seguro;
- red privada fija `albra-agents`;
- imágenes fijadas exclusivamente por digest OCI `@sha256:<64 hex>`, sin tags mutables;
- timeout de health acotado y política de preservar volúmenes al detener.

Se añadieron pruebas unitarias para rutas, tags mutables, servicios duplicados y red. **No se ejecutaron**. Este descriptor aún no forma parte de `ProductContract` ni activa la instalación Docker; es una base tipada para el siguiente cambio coordinado de registro y lifecycle.


## Registro persistente de despliegues Compose — base (2026-11-09)

Se añadió al schema Prisma el modelo ContainerDeployment, relacionado 1:1 con InstalledProduct mediante productId. Guarda el nombre único del proyecto Compose, directorio de instalación, rutas de Compose/env-file, red, digests de imagen, estado deseado/observado, health y último error/sondeo. La relación elimina el registro del despliegue cuando se elimina el producto, pero detener un stack no elimina sus volúmenes.

src/lib/albra/core/registry.ts ahora expone lectura/listado, registro idempotente por producto y actualización del estado observado. El driver incluye parseDockerComposePs() para interpretar salida JSON-lines o array, normalizar servicio/estado/health y rechazar filas incompletas; hay pruebas para esos formatos y errores.

Importante: el proyecto no mantiene un historial de migraciones Prisma y actualmente usa prisma db push (también en el entrypoint Docker del PANEL). Por eso el cambio se hizo en el schema, sin inventar una migración aislada que pudiera fallar en bases existentes. Aún hay que ejecutar prisma generate y prisma db push durante la validación del entorno de despliegue.

Esto todavía no conecta START/STOP/RESTART/HEALTH al driver. Falta orquestar operaciones bajo lock, crear/verificar la red externa albra-agents, generar el env-file seguro, esperar readiness por servicio y reconciliar estado real contra el registro. No se ha ejecutado Bun, Prisma, Docker ni las pruebas en este avance.


## Ciclo de vida Compose — primera capa de control (2026-11-09)

Se añadió core/container-lifecycle.ts con acciones START, STOP, RESTART, STATUS y HEALTH para un ContainerDeployment ya registrado. Cada acción queda serializada por el lock por producto, usa exclusivamente projectName + composeFile + envFile persistidos, consulta después `compose ps --all --format json` y actualiza desiredState, observedState, health y lastError.

START/RESTART verifican o crean únicamente la red bridge administrada `albra-agents`; la operación es tolerante a una carrera entre dos instaladores. La agregación distingue servicios todos detenidos, todos running, servicios aún arrancando, unhealthy y salidas no-cero. STOP usa `docker compose stop`: no ejecuta down, no elimina contenedores ni borra volúmenes.

Se añadieron pruebas unitarias para la agregación de estado. No se ejecutaron todavía. Esta capa requiere un registro ya creado y un env-file ya generado; aún no crea secretos ni instala el stack (`pull`/`up`), no espera readiness con timeout y no se ha conectado a endpoints EEC/API. En particular, START no sustituye al primer `up` de instalación.
