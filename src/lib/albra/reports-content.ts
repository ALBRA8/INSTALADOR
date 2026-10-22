/**
 * ALBRA — Contenido de los Reportes de plataforma (español).
 * Consumido por la API /api/reports y el diálogo de Reportes del Launcher.
 * Solo describe capacidades reales del código (contratos, motores y registro).
 */

export interface ReportSection { heading: string; body: string; }
export interface ReportDoc { id: string; title: string; summary: string; sections: ReportSection[]; }

export const REPORTS: ReportDoc[] = [
  {
    id: "architecture",
    title: "Arquitectura ALBRA",
    summary:
      "Las 7 capas del Deployment & Lifecycle System y la decisión adapter-driven que mantiene el núcleo independiente del sistema operativo.",
    sections: [
      {
        heading: "Siete capas con responsabilidad única",
        body:
          "ALBRA se organiza en 7 capas: (1) Estándar de Producto, (2) Contratos Universales con validación Zod, (3) Sistema de Paquetes (.albra firmado + Runtime Manager), (4) Framework de Despliegue por adapters, (5) Motores del ciclo de vida (installer, update/rollback, uninstall, health, secretos, auditoría), (6) Productos con datos aislados, y (7) Experiencia y Observabilidad (Launcher, runs en vivo, reportes). Ninguna capa salta dos niveles: los motores no tocan paquetes sin verificar, y la UI solo consume observables.",
      },
      {
        heading: "Adapter-driven por decisión, no por comodidad",
        body:
          "El núcleo nunca depende de Windows ni de Linux: toda capacidad de entorno (info de plataforma, sondas de puerto, checksums, disco libre) se delega en la interfaz DeploymentAdapter. Hoy está implementado el adapter local-dev (sandbox Linux, semántica idéntica a producción); windows-local es la implementación de producción especificada (se activa sola en process.platform win32, raíz %ProgramData%/ALBRA); y selfhosted-vps está declarado con sus capabilities para la WAVE 11. Añadir un destino nuevo es implementar una clase, no reescribir motores.",
      },
      {
        heading: "Aislamiento real entre productos",
        body:
          "Cada producto tiene directorios propios (app, data, staging-<runId>, .previous), tablas propias (CRM: CrmContact/CrmDeal; LEADS: LeadRecord), configuración separada en scopes USER/SYSTEM/PRODUCT, puertos preferentes distintos y locks de operación individuales. Dos productos pueden instalarse, actualizarse o desinstalarse en paralelo sin interferirse: el aislamiento es verificable con el segundo producto instalado.",
      },
      {
        heading: "Estado persistente y observable",
        body:
          "El registro local (Prisma/SQLite) persiste todo: InstalledProduct, PackageArtifact, LifecycleRun con pasos y duraciones, AuditEvent, LogEntry por canales, HealthSnapshot, BackupRecord, SecretRecord, ConfigRecord, ProviderRecord y PlatformState. Los modelos demo User/Post del schema original fueron eliminados; el registro es 100% plataforma ALBRA.",
      },
    ],
  },
  {
    id: "contracts",
    title: "Contratos Universales",
    summary:
      "Ningún manifest monstruoso: contratos separados por responsabilidad, versionados y validados con Zod antes de tocar el sistema.",
    sections: [
      {
        heading: "Un contrato por responsabilidad",
        body:
          "El ProductContract es una composición de 10 contratos: Identity (producto, vendor, canal, entitlement requerido), Requirements (plataformas, arquitecturas, versión mínima de plataforma, disco, puertos preferentes), Dependencies (runtime/servicio/librería/producto, auto-instalables), Configuration, Health, Lifecycle, Update, Security, Providers y Deployment. Cada uno tiene schema, versión y reglas propias.",
      },
      {
        heading: "Configuración en tres scopes",
        body:
          "Los campos se declaran con scope USER (lo que el usuario entiende: nombre de organización, correo, moneda), SYSTEM (administrado por ALBRA: puerto, ruta de datos, modo de runtime) y PRODUCT (específico del producto: etapas del pipeline, flags de features). Los campos tipo secret nunca se persisten en configuración: van cifrados al SecretStore. El usuario no edita archivos .env ni toca lo systemManaged.",
      },
      {
        heading: "Health y Update declarados por el producto",
        body:
          "El Health Contract declara los checks (application, runtime, database, dependencies, storage, port, providers) con su criticidad e intervalo (30s). El Update Contract declara migraciones con versión origen/destino y nivel de riesgo (la migración crm-2-tags de 1.0.0 a 1.1.0 es LOW), soporte de rollback y backup previo automático. Una migración de riesgo HIGH exige confirmación explícita.",
      },
      {
        heading: "Motor de compatibilidad",
        body:
          "checkCompatibility evalúa plataforma, arquitectura y versión de ALBRA Platform contra el contrato y devuelve COMPATIBLE, INCOMPATIBLE, UPGRADE_REQUIRED o MIGRATION_REQUIRED con razones concretas. parseProductContract valida el contrato completo con Zod y devuelve los errores ruta por ruta; es la puerta de entrada obligatoria en preflight, instalación y actualización: sin contrato válido no hay operación.",
      },
    ],
  },
  {
    id: "package",
    title: "Formato ALBRA-PACKAGE 1.0.0",
    summary:
      "Paquetes .albra firmados y verificables: PACKAGE → HASH → SIGNATURE → VERIFY → INSTALL, con rechazo determinista de paquetes inválidos.",
    sections: [
      {
        heading: "Estructura del paquete",
        body:
          "Un .albra es JSON con: manifest (packageId, version, channel, displayName), el ProductContract completo embebido, el payload (archivos de aplicación con sha256 individual, seeds de primera instalación, migraciones y deployment), la sección integrity (payloadHash y packageHash SHA-256) y la signature (HMAC-SHA256 con keyId albra-root-2025).",
      },
      {
        heading: "Cadena de confianza",
        body:
          "El builder calcula el hash por archivo, el payloadHash del payload completo y el packageHash sobre el core canónico (claves ordenadas para hash determinista). La firma es HMAC-SHA256 del packageHash con la clave raíz de la plataforma (keys/package-signing.key, 256 bits, permisos 0600). Cualquier modificación —un byte de product.js o un campo del manifiesto— invalida el hash y con él la firma.",
      },
      {
        heading: "Verificación en capas y rechazo",
        body:
          "verifyPackage comprueba en orden: estructura, formato y versión de formato, manifiesto, checksum por archivo, payloadHash, packageHash y firma. Cada fallo tiene un código explícito: FILE_CHECKSUM_MISMATCH, PAYLOAD_HASH_MISMATCH, PACKAGE_HASH_MISMATCH, SIGNATURE_INVALID, entre otros. Un paquete inválido nunca llega a staging: el installer audita PACKAGE_REJECTED con la razón exacta y aborta.",
      },
      {
        heading: "Paquete tampered de demostración",
        body:
          "La demostración toma un paquete legítimo de la bóveda, altera su contenido y lo somete a verificación: el resultado es rechazo determinista (FILE_CHECKSUM_MISMATCH si se toca un archivo, SIGNATURE_INVALID si se recalculan hashes sin la clave). La bóveda (packages/) además aplica defensa path-traversal aceptando solo nombres planos, y es la fuente de instalación y de los rollbacks vía bóveda.",
      },
    ],
  },
  {
    id: "installer",
    title: "Máquina de Instalación",
    summary:
      "15 estados observables, preflight con resolución automática de conflictos y una instalación transaccional PREPARE/STAGE/COMMIT/ROLLBACK.",
    sections: [
      {
        heading: "Los 15 estados",
        body:
          "DISCOVER, PREFLIGHT, PLAN, CONFIRM, DOWNLOAD, VERIFY, PREPARE, INSTALL, CONFIGURE, INITIALIZE, MIGRATE, REGISTER, START, HEALTH y COMPLETE. Cada paso se persiste con estado, detalle, timestamp y duración en LifecycleRun; la UI los muestra en vivo. VERIFY rechaza paquetes inválidos antes de crear staging; CONFIGURE inicializa los tres scopes sin .env; INITIALIZE crea los seeds solo si las tablas están vacías.",
      },
      {
        heading: "Transaccionalidad real",
        body:
          "Los archivos se escriben en un staging por run y se re-verifican byte a byte (STAGE_CHECKSUM_MISMATCH si difieren). El COMMIT (paso REGISTER) es un rename atómico de staging a app más el registro del producto con versión, puerto y packageHash: el usuario nunca ve una instalación a medias. Si algo falla, el ROLLBACK elimina el staging y limpia el registro, dejando el catálogo en estado consistente; el run termina FAILURE y se audita INSTALL_FAILED.",
      },
      {
        heading: "Preflight: bloqueos y auto-resoluciones",
        body:
          "El preflight reporta issues con severidad BLOCKER/WARNING/RESOLVED: paquete no encontrado, contrato inválido, incompatibilidad de plataforma, espacio en disco insuficiente, dependencias no resolubles, producto ya instalado y falta de permisos son bloqueantes. La ocupación de puertos, en cambio, se resuelve sola: si el puerto preferente está ocupado, ALBRA reasigna automáticamente el siguiente libre y lo reporta como WARNING explicativo.",
      },
      {
        heading: "Puertos y concurrencia",
        body:
          "La sonda de puertos es real (sockets TCP sobre 127.0.0.1 vía adapter) y prueba hasta 20 candidatos consecutivos desde el preferente del contrato. El puerto asignado viaja por toda la instalación y queda reservado por el Runtime Manager. Todo el flujo corre bajo withLock del producto: no existen instalaciones concurrentes del mismo producto (PRODUCT_BUSY).",
      },
    ],
  },
  {
    id: "lifecycle",
    title: "Ciclo de Vida y Diagnósticos",
    summary:
      "Estados del ciclo de vida, health engine con checks reales, update CHECK→…→COMMIT, rollback automático y uninstall con modos de datos.",
    sections: [
      {
        heading: "Estados y runtime",
        body:
          "AVAILABLE, INSTALLING, INSTALLED, STARTING, RUNNING, STOPPED, DEGRADED, FAILED, UPDATING, REPAIRING y UNINSTALLING. El Runtime Manager expone START/STOP/RESTART/STATUS: al arrancar asigna puerto si falta, genera runtimeHandle y pone health UNKNOWN hasta el primer check; al detener libera el handle. El usuario ve \"funcionando\", no procesos internos.",
      },
      {
        heading: "Health engine con checks reales",
        body:
          "Los checks del contrato se ejecutan de verdad: manifest en disco con versión coincidente, estado del runtime, conteos reales en base de datos por producto, sonda de escritura en data/, estado del puerto y validez de proveedores. El overall es FAILED si falla un check crítico, HEALTHY si todos los críticos pasan y DEGRADED ante avisos no críticos. Cada ejecución persiste un HealthSnapshot y transiciona el estado del producto (RUNNING+FAILED → FAILED, con recuperación automática al restaurarse la salud).",
      },
      {
        heading: "Update y rollback",
        body:
          "El update sigue CHECK → DOWNLOAD → VERIFY → BACKUP → STAGE → STOP → SWAP → MIGRATE → START → HEALTH → COMMIT: la versión anterior se preserva en .previous, el backup PRE_UPDATE se crea antes de tocar nada y las migraciones son idempotentes. Un fallo tras STOP/SWAP dispara el rollback automático (restauración de .previous + datos del backup + verificación de salud) y el run termina ROLLED_BACK. Existe además el rollback post-commit vía bóveda: re-descarga el paquete anterior firmado, lo verifica y restaura app y datos. Bajar de versión por update está prohibido: para eso está el rollback.",
      },
      {
        heading: "Diagnostics y uninstall",
        body:
          "El pipeline de diagnósticos COLLECT → CLASSIFY → EXPLAIN → SUGGEST → REPAIR produce hallazgos con código, severidad, explicación en lenguaje humano y acciones de reparación con su riesgo. El uninstall (PRECHECK → BACKUP → STOP → REMOVE_APPLICATION → REMOVE_SERVICES → REMOVE_CONFIGURATION → CLEAN → VALIDATE) ofrece tres modos de datos: KEEP conserva los datos para reinstalar, EXPORT los escribe como snapshot JSON en exports/ antes de borrar, y DELETE elimina datos y backups permanentemente. En todos los modos se purgan configuración y secretos, y VALIDATE confirma que el registro quedó limpio.",
      },
    ],
  },
  {
    id: "security",
    title: "Seguridad de Plataforma",
    summary:
      "Firma HMAC-SHA256 de paquetes, SecretStore AES-256-GCM, redaction obligatoria, locks de operación y auditoría completa.",
    sections: [
      {
        heading: "Firma y verificación de paquetes",
        body:
          "Cada paquete lleva firma HMAC-SHA256 sobre su packageHash canónico, con clave raíz de 256 bits persistida con permisos 0600 y keyId albra-root-2025. La verificación es obligatoria y en capas (archivos, payloadHash, packageHash, firma); los productos declaran signedPackagesRequired: true. El rechazo se audita como PACKAGE_REJECTED con la razón exacta, y la verificación exitosa como PACKAGE_VERIFIED con el hash truncado.",
      },
      {
        heading: "SecretStore cifrado",
        body:
          "Los secretos se cifran con AES-256-GCM (IV aleatorio por secreto y tag de autenticidad) bajo una clave maestra propia independiente de la clave de firma. El listado de secretos nunca devuelve valores: solo clave, hint y fecha, con el placeholder ••••••••. Al desinstalar, deleteSecretsFor elimina los secretos del producto. Los campos de configuración tipo secret (como la contraseña SMTP del CRM) viven aquí, nunca en configuración plana.",
      },
      {
        heading: "Redaction en toda la persistencia",
        body:
          "redactValue recorre estructuras completas y sustituye por •••••••• cualquier clave o string que parezca un secreto (secret, password, token, api-key, credential, cipher). Se aplica en los runs del ciclo de vida, en los eventos de auditoría y en el logging estructurado: diagnósticos, reportes y UI no pueden filtrar credenciales aunque existan en memoria.",
      },
      {
        heading: "Locks, validación y auditoría",
        body:
          "withLock garantiza una operación de ciclo de vida por producto (PRODUCT_BUSY ante concurrencia). Los contratos se validan con Zod en preflight, tras el staging y antes de cada update; un contrato inválido es bloqueante. El audit trail registra los eventos mínimos del estándar (instalación, update, rollback, backup, restore, paquetes verificados/rechazados, certificación, clean-room, diagnósticos) con actor, severidad y detalle redactado. Completan el modelo: escritura atómica, defensa path-traversal en la bóveda, clasificación de datos por producto y confirmación exigida para migraciones de riesgo alto.",
      },
    ],
  },
  {
    id: "test-report",
    title: "Suite de Certificación (ejecución en vivo)",
    summary:
      "La certificación se ejecuta desde esta UI y genera resultados reales: paquetes, instalación, update con migración, rollback y desinstalación.",
    sections: [
      {
        heading: "Cómo funciona",
        body:
          "Al lanzar la suite se crea una operación CERTIFICATION como cualquier otra del ciclo de vida: una LifecycleRun observable con pasos persistidos. El runner encadena las capacidades críticas usando los motores reales (no caminos especiales de prueba) y espera cada sub-operación en el servidor mediante el registro de promesas de runs. Los resultados que verás son los generados por esta ejecución concreta.",
      },
      {
        heading: "Qué verifica",
        body:
          "1) Verificación de paquetes de la bóveda (crm 1.0.0, crm 1.1.0, leads 1.0.0) y rechazo del paquete tampered. 2) Preflight con compatibilidad, disco, dependencias y puertos. 3) Instalación transaccional completa hasta HEALTHY. 4) Update de CRM 1.0.0 → 1.1.0 aplicando la migración crm-2-tags. 5) Rollback a la versión anterior vía bóveda + backup. 6) Desinstalación con modos de datos KEEP/EXPORT/DELETE. 7) Health checks por producto con sus 7 y 4 checks respectivos.",
      },
      {
        heading: "Inyección de fallos",
        body:
          "El motor de actualización acepta inyectar fallos simulados en la fase de MIGRACIÓN o de ARRANQUE. Un update con fallo inyectado debe terminar en ROLLED_BACK: versión anterior restaurada desde .previous, datos recuperados del backup PRE_UPDATE y salud verificada. Certificar el camino infeliz es parte de la suite: la garantía es que nunca queda una actualización rota sin estado claro.",
      },
      {
        heading: "Criterios y evidencia",
        body:
          "Criterios duros: ningún paquete legítimo rechazado, rechazo garantizado del tampered, seeds idempotentes, rollback sin pérdida de datos y health HEALTHY tras cada operación feliz. La evidencia queda persistida: estados de run (SUCCESS/WARNING/FAILURE/ROLLED_BACK), pasos con duraciones y el evento de auditoría CERTIFICATION_COMPLETED. Todo el detalle viaja redactado: la certificación nunca imprime secretos.",
      },
    ],
  },
  {
    id: "cleanroom",
    title: "Prueba Clean-Room",
    summary:
      "Reset total y reinstalación desde cero sin estado previo: la plataforma se reconstruye con solo la bóveda firmada y las llaves.",
    sections: [
      {
        heading: "El escenario caja vacía",
        body:
          "El clean-room demuestra que ALBRA no depende de artefactos ocultos ni de sesiones previas. La operación (tipo CLEANROOM en el registro de runs, con auditoría CLEANROOM_RESET) parte de un entorno sin ningún estado de plataforma y debe terminar con productos instalados, arrancados y saludables.",
      },
      {
        heading: "Fase 1 — Reset",
        body:
          "Se limpia el estado de plataforma: registro de productos instalados, configuración por scopes, secretos, snapshots de health, bundles de diagnóstico, runs anteriores y datos de producto; junto con los directorios derivados de ALBRA_HOME. Se conservan únicamente la bóveda de paquetes .albra firmados y las llaves de la plataforma, que representan la semilla mínima legítima.",
      },
      {
        heading: "Fase 2 — Reinstalación desde cero",
        body:
          "Sobre ese estado limpio se ejecuta el ciclo completo con los motores normales: preflight, instalación transaccional de CRM y LEADS, seeds iniciales (idempotentes: solo crean datos si las tablas están vacías), arranque de servicios con asignación de puertos y verificación de salud final HEALTHY por producto.",
      },
      {
        heading: "Lo que queda demostrado",
        body:
          "La cadena de confianza funciona sin contexto (los paquetes se auto-verifican), la transaccionalidad no requiere estado previo, el aislamiento se establece desde la primera instalación (tablas y puertos separados por producto) y toda la reconstrucción queda auditada. Es la misma garantía que se exigirá en un VPS nuevo: con la bóveda y las llaves, ALBRA levanta todo lo demás.",
      },
    ],
  },
  {
    id: "lipo",
    title: "Análisis LIPO del MVP",
    summary:
      "KEEP / REFACTOR / MOVE / SKILL / TOOL / PROVIDER / AUXILIARY / DELETE: qué se conserva, qué se promueve y qué se eliminó del MVP ALBRA.",
    sections: [
      {
        heading: "KEEP — conservar sin cambios",
        body:
          "Los contratos universales (composición ProductContract con validación Zod), el sistema de firma de paquetes (hash canónico + HMAC-SHA256 + verificación en capas) y la observabilidad de runs (pasos, estados y duraciones persistidos). Son el corazón validado del MVP y la base sobre la que se apoyan VPS y SaaS: no requieren refactor y se reutilizan tal cual.",
      },
      {
        heading: "REFACTOR — nada crítico pendiente",
        body:
          "No hay deuda crítica identificada: los motores ya son transaccionales, la redacción de secretos está aplicada en todos los puntos de persistencia y el aislamiento por producto es verificable. Las mejoras futuras (programación del health por intervalo, cola de operaciones multi-producto) son adiciones, no reescrituras.",
      },
      {
        heading: "MOVE — nada que reubicar",
        body:
          "La arquitectura por capas ya colocó cada capacidad en su sitio: contratos en L2, paquetes en L3, adapters en L4, motores en L5, productos en L6. No se detectan componentes mal ubicados que exijan moverse de capa en esta etapa.",
      },
      {
        heading: "SKILL — capacidades que se promueven a habilidad de plataforma",
        body:
          "El SecretStore AES-256-GCM, la redaction defensiva y el motor de compatibilidad (COMPATIBLE/INCOMPATIBLE/UPGRADE_REQUIRED/MIGRATION_REQUIRED) son habilidades transversales que valen para cualquier producto y destino futuro, y deben tratarse como capacidades de primera clase del estándar ALBRA.",
      },
      {
        heading: "TOOL — herramientas operativas del ecosistema",
        body:
          "El builder/verifier de paquetes (buildPackage + verifyPackage) y el certification runner son herramientas: se usan hoy desde la plataforma y mañana desde CI o consola, sin cambios. Producen evidencia firmada y auditable de cada ejecución.",
      },
      {
        heading: "PROVIDER / AUXILIARY / DELETE",
        body:
          "PROVIDER: el proveedor SMTP ya está declarado por contrato (opcional para CRM) y el proveedor de IA queda reservado para KREA en la era SaaS. AUXILIARY: la bóveda de paquetes (packages/) actúa como almacén auxiliar firmado que soporta instalación, update y rollbacks vía bóveda. DELETE: los modelos demo User/Post del schema original fueron eliminados del registro; el schema persistente es 100% ALBRA.",
      },
    ],
  },
  {
    id: "next-wave",
    title: "Próxima Ola — VPS y SaaS",
    summary:
      "WAVE 11 (VPS/selfhosted con SelfHostedDeploymentAdapter) y WAVE 12+ (multi-tenant: Tenant/User/Role/Subscription/Entitlement/Provisioning).",
    sections: [
      {
        heading: "Lo que queda para VPS (WAVE 11)",
        body:
          "El SelfHostedDeploymentAdapter ya está declarado con id selfhosted-vps y sus capabilities en false, marcando el contrato a cumplir: provisioning del servidor (usuario, dependencias, estructura ALBRA_HOME), ejecución remota de las operaciones de ciclo de vida, reverse proxy nginx con dominio y TLS por producto, y backups hacia almacenamiento remoto. Destino declarado: VPS y servidores dedicados, incluido hosting compatible como Hostinger.",
      },
      {
        heading: "Por qué será extensión y no reescritura",
        body:
          "Los motores de LAYER 5 ya no saben dónde corren: piden capacidades al adapter. El clean-room local demostró que con solo la bóveda firmada y las llaves un entorno vacío se reconstruye solo; ese es exactamente el escenario de un VPS nuevo. Los paquetes .albra, el registro local y la auditoría son idénticos en local y remoto.",
      },
      {
        heading: "Lo que queda para SaaS (WAVE 12+)",
        body:
          "Los conceptos ya están reservados en el estándar: Tenant (organización cliente), User y Role (identidades y permisos por tenant), Subscription (relación con un plan), Entitlement (derecho adquirido a un producto) y Provisioning (pipeline que instala y activa el producto aprobado). Puntos de anclaje existentes en código: requiredEntitlement en el contrato de producto, el campo entitlement en el registro de instalados y el evento de auditoría LICENSE_CHANGED.",
      },
      {
        heading: "KREA y TRADING como prueba de concepto",
        body:
          "KREA (entitlement.krea) y TRADING (entitlement.trading) permanecen bloqueados en el catálogo (locked, no instalables) anticipando el modelo SaaS: cuando existan suscripciones y entitlements reales, su desbloqueo será un cambio de estado del entitlement seguido de un provisioning normal con los motores actuales. La ruta completa: WAVE 11 habilita el destino VPS; WAVE 12+ habilita el negocio multi-tenant sobre ese destino.",
      },
    ],
  },
];
