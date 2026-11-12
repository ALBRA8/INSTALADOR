/**
 * ALBRA — LAYER 6: PRODUCTS (catálogo)
 * Cada producto es independiente. Aislamiento por contrato explícito.
 * Piloto: CRM. Segundo producto instalable: LEADS (prueba de aislamiento).
 * KREA y TRADING: bloqueados por entitlement (concepto futuro SaaS).
 */
import type { ProductContract } from "@/lib/albra/contracts";
import type { ContainerDeploymentSource } from "@/lib/albra/contracts/source";

const ALL_OPS = [
  "INSTALL", "CONFIGURE", "START", "STOP", "RESTART", "UPDATE", "ROLLBACK",
  "DIAGNOSTICS", "REPAIR", "BACKUP", "RESTORE", "UNINSTALL",
] as const;

function crmConfigFields(version: string) {
  return [
    // USER — lo que el usuario entiende
    { key: "orgName", label: "Nombre de la organización", scope: "USER" as const, type: "string" as const, required: true, defaultValue: "Mi Organización", systemManaged: false, description: "Aparece en la interfaz de CRM" },
    { key: "ownerEmail", label: "Correo del responsable", scope: "USER" as const, type: "email" as const, required: true, defaultValue: "owner@example.com", systemManaged: false },
    { key: "currency", label: "Moneda", scope: "USER" as const, type: "select" as const, required: true, defaultValue: "COP", options: [
      { value: "COP", label: "Peso colombiano (COP)" },
      { value: "USD", label: "Dólar (USD)" },
      { value: "EUR", label: "Euro (EUR)" },
    ], systemManaged: false },
    { key: "smtpPassword", label: "Contraseña SMTP (proveedor de correo)", scope: "USER" as const, type: "secret" as const, required: false, systemManaged: false, description: "Se guarda cifrada en el SecretStore de ALBRA. Nunca se muestra." },
    // SYSTEM — administrado por ALBRA automáticamente
    { key: "port", label: "Puerto del servicio", scope: "SYSTEM" as const, type: "number" as const, required: true, systemManaged: true, description: "Asignado automáticamente por ALBRA" },
    { key: "dataPath", label: "Ruta de datos", scope: "SYSTEM" as const, type: "string" as const, required: true, systemManaged: true },
    // PRODUCT — específico del producto
    { key: "pipelineStages", label: "Etapas del pipeline", scope: "PRODUCT" as const, type: "string" as const, required: true, defaultValue: "NUEVO,CONTACTADO,PROPUESTA,GANADO,PERDIDO", systemManaged: true },
    ...(version === "1.1.0"
      ? [{ key: "tagsEnabled", label: "Etiquetas de contactos (nuevo en 1.1.0)", scope: "PRODUCT" as const, type: "boolean" as const, required: true, defaultValue: true, systemManaged: true }]
      : []),
  ];
}

function crmHealthChecks() {
  return [
    { checkId: "app-files", label: "Archivos de aplicación", target: "application" as const, critical: true },
    { checkId: "runtime", label: "Proceso real del servicio", target: "runtime" as const, critical: true },
    { checkId: "http-health", label: "Endpoint de salud autenticado", target: "http-health" as const, critical: true },
    { checkId: "database", label: "Base de datos", target: "database" as const, critical: true },
    { checkId: "dependencies", label: "Dependencias", target: "dependencies" as const, critical: true },
    { checkId: "storage", label: "Almacenamiento de datos", target: "storage" as const, critical: true },
    { checkId: "port", label: "Puerto del servicio", target: "port" as const, critical: false },
    { checkId: "providers", label: "Proveedores", target: "providers" as const, critical: false },
  ];
}

function crmContract(version: string): ProductContract {
  return {
    contractVersion: "1.0.0",
    identity: {
      productId: "crm",
      name: "CRM",
      displayName: "ALBRA CRM",
      vendor: "ALBRA",
      description: "Gestión de relaciones con clientes: contactos, pipeline de oportunidades y seguimiento comercial.",
      category: "ventas",
      icon: "Users",
      version,
      releaseChannel: "stable",
    },
    requirements: {
      platforms: ["windows", "linux", "macos"],
      architectures: ["x64", "arm64"],
      minPlatformVersion: "1.0.0",
      minDiskMB: 150,
      preferredPorts: [4101, 4111, 4121],
    },
    dependencies: [
      { dependencyId: "albra-runtime", kind: "runtime", versionRange: ">=1.0.0", required: true, autoInstallable: true },
      { dependencyId: "albra-database", kind: "service", versionRange: ">=1.0.0", required: true, autoInstallable: true },
    ],
    configuration: { fields: crmConfigFields(version) },
    health: { checks: crmHealthChecks(), intervalSeconds: 30 },
    lifecycle: { supportedOperations: [...ALL_OPS], autoStartOnInstall: true, restartable: true },
    update: {
      migrations:
        version === "1.1.0"
          ? [{ migrationId: "crm-2-tags", fromVersion: "1.0.0", toVersion: "1.1.0", description: "Añade etiquetas (tags) a los contactos y habilita la función", risk: "LOW" as const }]
          : [],
      supportsRollback: true,
      backupBeforeUpdate: true,
    },
    security: {
      signedPackagesRequired: true,
      secretKeys: ["smtp_password"],
      permissions: ["data:read", "data:write", "net:smtp"],
      dataClassification: "confidential" as const,
    },
    providers: {
      providers: [
        { providerId: "smtp", label: "Correo saliente (SMTP)", kind: "smtp" as const, required: false, description: "Para enviar seguimientos por correo. Opcional." },
      ],
    },
    deployment: { kinds: ["local"], preferredAdapter: "windows-local" as const },
  };
}

function leadsContract(version: string): ProductContract {
  return {
    contractVersion: "1.0.0",
    identity: {
      productId: "leads",
      name: "Agente Leads",
      displayName: "ALBRA Agente Leads",
      vendor: "ALBRA",
      description: "Captura y calificación de leads: embudo simple de prospectos con puntuación automática.",
      category: "marketing",
      icon: "Target",
      version,
      releaseChannel: "stable",
    },
    requirements: {
      platforms: ["windows", "linux", "macos"],
      architectures: ["x64", "arm64"],
      minPlatformVersion: "1.0.0",
      minDiskMB: 100,
      preferredPorts: [4102, 4112, 4122],
    },
    dependencies: [
      { dependencyId: "albra-runtime", kind: "runtime", versionRange: ">=1.0.0", required: true, autoInstallable: true },
    ],
    configuration: { fields: [
      { key: "teamName", label: "Nombre del equipo comercial", scope: "USER" as const, type: "string" as const, required: true, defaultValue: "Equipo Comercial", systemManaged: false },
      { key: "defaultSource", label: "Origen por defecto", scope: "USER" as const, type: "select" as const, required: true, defaultValue: "WEB", options: [
        { value: "WEB", label: "Web" }, { value: "REFERRAL", label: "Referido" }, { value: "ADS", label: "Campañas" }, { value: "MANUAL", label: "Manual" },
      ], systemManaged: false },
      { key: "port", label: "Puerto del servicio", scope: "SYSTEM" as const, type: "number" as const, required: true, systemManaged: true },
      { key: "dataPath", label: "Ruta de datos", scope: "SYSTEM" as const, type: "string" as const, required: true, systemManaged: true },
    ] },
    health: { checks: [
      { checkId: "app-files", label: "Archivos de aplicación", target: "application" as const, critical: true },
      { checkId: "runtime", label: "Proceso real del servicio", target: "runtime" as const, critical: true },
    { checkId: "http-health", label: "Endpoint de salud autenticado", target: "http-health" as const, critical: true },
      { checkId: "database", label: "Base de datos", target: "database" as const, critical: true },
      { checkId: "storage", label: "Almacenamiento de datos", target: "storage" as const, critical: true },
    ], intervalSeconds: 30 },
    lifecycle: { supportedOperations: [...ALL_OPS], autoStartOnInstall: true, restartable: true },
    update: { migrations: [], supportsRollback: true, backupBeforeUpdate: true },
    security: { signedPackagesRequired: true, secretKeys: [], permissions: ["data:read", "data:write"], dataClassification: "internal" as const },
    providers: { providers: [] },
    deployment: { kinds: ["local"], preferredAdapter: "windows-local" as const },
  };
}

// ─────────────────── Application payload (archivos reales del paquete) ───────────────────

/**
 * V2 — Servidor de producto REAL e instrumentado.
 * Este archivo se instala como app/product.js y se ejecuta como proceso del SO
 * (bun/node) bajo el Process Runtime de ALBRA. Marcador requerido por el
 * verificador de identidad: ALBRA-PRODUCT-RUNTIME
 */
function productRuntimeServerJs(productId: string, displayName: string, version: string): string {
  return `// ${displayName} v${version} — ALBRA-PRODUCT-RUNTIME v2
// Proceso de producto real: HTTP con /health autenticado, diag, heartbeat,
// salida ordenada con evidencia. Sin dependencias externas.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const PRODUCT_ID = process.env.ALBRA_PRODUCT_ID || "${productId}";
const PRODUCT_VERSION = process.env.ALBRA_PRODUCT_VERSION || "${version}";
const BOOT_TOKEN = process.env.ALBRA_BOOT_TOKEN || "";
const RUNTIME_DIR = process.env.ALBRA_RUNTIME_DIR || path.join(process.cwd(), "runtime");
const DATA_DIR = process.env.ALBRA_DATA_DIR || path.join(process.cwd(), "data");
const PORT = parseInt(argValue("--port") || process.env.ALBRA_PORT || "0", 10);

if (!PORT || !BOOT_TOKEN) {
  console.error("[albra-product] configuración incompleta: se requieren --port y ALBRA_BOOT_TOKEN");
  process.exit(2);
}

const startedAt = Date.now();
const state = { requestsServed: 0, lastError: null };
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function writeJson(file, obj) {
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error("[albra-product] writeEvidence failed:", e.message);
  }
}
function writeExit(reason) {
  writeJson(path.join(RUNTIME_DIR, "exit.json"), {
    reason,
    pid: process.pid,
    at: new Date().toISOString(),
    uptimeS: Math.floor((Date.now() - startedAt) / 1000),
    requestsServed: state.requestsServed,
  });
}

// Heartbeat periódico (evidencia de vida sin depender de HTTP)
const hbTimer = setInterval(() => {
  writeJson(path.join(RUNTIME_DIR, "heartbeat.json"), {
    pid: process.pid,
    at: new Date().toISOString(),
    uptimeS: Math.floor((Date.now() - startedAt) / 1000),
    memRSSMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  });
}, 5000);
hbTimer.unref();

function send(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  state.requestsServed++;
  // Autenticación de instancia: todo endpoint exige el boot token de ALBRA
  if (req.headers["x-albra-token"] !== BOOT_TOKEN) {
    send(res, 401, { ok: false, error: "UNAUTHORIZED" });
    return;
  }
  const url = (req.url || "/").split("?")[0];
  const uptimeS = Math.floor((Date.now() - startedAt) / 1000);
  if (req.method === "GET" && url === "/health") {
    send(res, 200, { ok: true, product: PRODUCT_ID, version: PRODUCT_VERSION, pid: process.pid, uptimeS, state: "RUNNING", requestsServed: state.requestsServed });
    return;
  }
  if (req.method === "GET" && url === "/api/diag") {
    const mem = process.memoryUsage();
    send(res, 200, { ok: true, diag: { pid: process.pid, product: PRODUCT_ID, version: PRODUCT_VERSION, uptimeS, requestsServed: state.requestsServed, lastError: state.lastError, memory: { rssMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) }, platform: process.platform, nodeLike: process.version, dataDir: DATA_DIR } });
    return;
  }
  if (req.method === "GET" && url === "/api/status") {
    send(res, 200, { ok: true, status: "RUNNING", product: PRODUCT_ID, version: PRODUCT_VERSION, uptimeS });
    return;
  }
  if (req.method === "POST" && url === "/api/echo") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on("end", () => {
      try { send(res, 200, { ok: true, echo: JSON.parse(raw || "null") }); }
      catch { send(res, 400, { ok: false, error: "INVALID_JSON" }); }
    });
    return;
  }
  send(res, 404, { ok: false, error: "NOT_FOUND" });
});

server.on("error", (err) => {
  console.error("[albra-product] server error:", err.message);
  state.lastError = err.message;
  writeExit("SERVER_ERROR:" + (err.code || ""));
  process.exit(3);
});

function graceful(signal) {
  writeExit(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", () => graceful("SIGTERM"));
process.on("SIGINT", () => graceful("SIGINT"));
process.on("uncaughtException", (err) => {
  state.lastError = err.message;
  console.error("[albra-product] uncaught:", err.stack || err.message);
  writeExit("UNCAUGHT_EXCEPTION");
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[albra-product] " + PRODUCT_ID + " v" + PRODUCT_VERSION + " escuchando en 127.0.0.1:" + PORT + " (pid " + process.pid + ")");
});
`;
}

function crmProductJs(version: string): string {
  return productRuntimeServerJs("crm", "ALBRA CRM", version);
}

function crmManifestJson(version: string): string {
  return JSON.stringify(
    { productId: "crm", displayName: "ALBRA CRM", version, vendor: "ALBRA", entry: "product.js", features: version === "1.1.0" ? { tags: true } : {} },
    null,
    2
  );
}

function crmChangelog(version: string): string {
  return version === "1.1.0"
    ? `# ALBRA CRM Changelog

## 1.1.0
- NUEVO: etiquetas (tags) en contactos para segmentación.
- Mejora: rendimiento en la lista de contactos.

## 1.0.0
- Lanzamiento inicial: contactos y pipeline de oportunidades.
`
    : `# ALBRA CRM Changelog

## 1.0.0
- Lanzamiento inicial: contactos y pipeline de oportunidades.
`;
}

function leadsProductJs(version: string): string {
  return productRuntimeServerJs("leads", "ALBRA Agente Leads", version);
}

function leadsManifestJson(version: string): string {
  return JSON.stringify({ productId: "leads", displayName: "ALBRA Agente Leads", version, vendor: "ALBRA", entry: "product.js" }, null, 2);
}

// ─────────────────── Seeds (datos iniciales de primera instalación) ───────────────────

export const CRM_SEEDS = {
  contacts: [
    { name: "Laura Gómez", email: "laura@acme.co", company: "Acme S.A.S.", phone: "+57 300 111 2233" },
    { name: "Carlos Ruiz", email: "carlos@tecnova.io", company: "TecNova", phone: "+57 301 222 3344" },
    { name: "Diana Pérez", email: "diana@merkal.com", company: "Merkal", phone: "+57 302 333 4455" },
  ],
  deals: [
    { title: "Licencia CRM — 5 usuarios", contactName: "Laura Gómez", value: 4800000, stage: "NUEVO" },
    { title: "Implementación + capacitación", contactName: "Carlos Ruiz", value: 9200000, stage: "PROPUESTA" },
    { title: "Renovación anual", contactName: "Diana Pérez", value: 3100000, stage: "GANADO" },
  ],
};

export const LEADS_SEEDS = {
  leads: [
    { name: "Andrés Torres", company: "Torres Consultores", source: "WEB", status: "NUEVO", score: 45 },
    { name: "Marcela Díaz", company: "Diaz Retail", source: "ADS", status: "CALIFICADO", score: 72 },
    { name: "Jorge Salinas", company: "Salinas & Co", source: "REFERRAL", status: "CONTACTADO", score: 88 },
    { name: "Paula Méndez", company: "Méndez Digital", source: "MANUAL", status: "DESCARTADO", score: 12 },
  ],
};


// ─────────── Contratos CONTENEDORIZADOS (ORDEN MAESTRA F5) ───────────

function panelContract(version: string): ProductContract {
  return {
    contractVersion: "1.0.0",
    identity: {
      productId: "panel-de-control",
      name: "Panel de Control",
      displayName: "ALBRA Panel de Control",
      vendor: "ALBRA",
      description: "Centro de administración del ecosistema: descubre, instala, supervisa y opera los agentes ALBRA vía contrato EEC.",
      category: "plataforma",
      icon: "LayoutDashboard",
      version,
      releaseChannel: "stable",
    },
    requirements: {
      platforms: ["linux", "windows", "macos"],
      architectures: ["x64", "arm64"],
      minPlatformVersion: "1.0.0",
      minDiskMB: 200,
      preferredPorts: [3900],
    },
    dependencies: [],
    configuration: { fields: [
      { key: "port", label: "Puerto del servicio", scope: "SYSTEM" as const, type: "number" as const, required: true, systemManaged: true },
      { key: "dataPath", label: "Ruta de datos", scope: "SYSTEM" as const, type: "string" as const, required: true, systemManaged: true },
    ] },
    health: { checks: [
      { checkId: "container-health", label: "Healthcheck del contenedor (/api/health)", target: "http-health" as const, critical: true },
      { checkId: "compose-services", label: "Servicios Compose", target: "runtime" as const, critical: true },
    ], intervalSeconds: 30 },
    lifecycle: { supportedOperations: [...ALL_OPS], autoStartOnInstall: true, restartable: true },
    update: { migrations: [], supportsRollback: true, backupBeforeUpdate: true },
    security: {
      signedPackagesRequired: true,
      secretKeys: ["eec.ops.token"],
      permissions: ["data:read", "data:write", "ops:delegate"],
      dataClassification: "internal" as const,
    },
    providers: { providers: [] },
    deployment: { kinds: ["docker-compose"], preferredAdapter: "docker-compose" as const },
  };
}

function chismosoContract(version: string): ProductContract {
  return {
    contractVersion: "1.0.0",
    identity: {
      productId: "chismoso",
      name: "Agente Chismoso",
      displayName: "ALBRA Agente Chismoso",
      vendor: "ALBRA",
      description: "Agente de inteligencia de señales: investigación de mercado, monitoreo y reportes (dashboard + scheduler + backups + Redis).",
      category: "marketing",
      icon: "Radar",
      version,
      releaseChannel: "stable",
    },
    requirements: {
      platforms: ["linux", "windows", "macos"],
      architectures: ["x64", "arm64"],
      minPlatformVersion: "1.0.0",
      minDiskMB: 300,
      preferredPorts: [],
    },
    dependencies: [],
    configuration: { fields: [
      { key: "dbPath", label: "Ruta de la base SQLite (en volumen)", scope: "SYSTEM" as const, type: "string" as const, required: true, defaultValue: "/data/chismoso.db", systemManaged: true },
      { key: "outputDir", label: "Directorio de reportes (en volumen)", scope: "SYSTEM" as const, type: "string" as const, required: true, defaultValue: "/data/reports", systemManaged: true },
      { key: "authTokens", label: "Tokens de máquina (hashes SHA-256, coma)", scope: "USER" as const, type: "string" as const, required: false, systemManaged: false, description: "Generados por el operador con chismoso auth issue. Nunca se generan aleatoriamente." },
    ] },
    health: { checks: [
      { checkId: "container-health", label: "Healthcheck del contenedor (/api/livez → /api/health)", target: "http-health" as const, critical: true },
      { checkId: "redis", label: "Redis (redis-cli ping)", target: "runtime" as const, critical: true },
      { checkId: "scheduler", label: "Scheduler en ejecución", target: "runtime" as const, critical: false },
    ], intervalSeconds: 30 },
    lifecycle: { supportedOperations: [...ALL_OPS], autoStartOnInstall: true, restartable: true },
    update: { migrations: [], supportsRollback: true, backupBeforeUpdate: true },
    security: {
      signedPackagesRequired: true,
      secretKeys: ["chismoso_jwt_secret"],
      permissions: ["data:read", "data:write", "net:outbound"],
      dataClassification: "confidential" as const,
    },
    providers: { providers: [] },
    deployment: { kinds: ["docker-compose"], preferredAdapter: "docker-compose" as const },
  };
}


// ─────────── Compose ALBRA de los despliegues contenedorizados (F5) ───────────

/** PANEL DE CONTROL: es el punto de ENTRADA del operador → publica ${ALBRA_PANEL_PORT}. */
const PANEL_COMPOSE_ALBRA = `# ALBRA — Panel de Control (despliegue gestionado por el INSTALADOR)
# El PANEL es la puerta de entrada del operador: publica su puerto.
services:
  panel:
    image: \${PANEL_IMAGE:?PANEL_IMAGE debe fijarse por digest sha256}
    restart: unless-stopped
    env_file:
      - .env.albra
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: 0.0.0.0
    ports:
      - "\${ALBRA_PANEL_PORT:-3900}:3000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - panel_data:/app/db
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 15s
      timeout: 5s
      start_period: 20s
      retries: 5
    networks:
      - albra_gateway
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
volumes:
  panel_data:
networks:
  albra_gateway:
    external: true
    name: albra-agents
`;

/** CHISMOSO: sin puertos al host; acceso solo por la red interna albra-agents. */
const CHISMOSO_COMPOSE_ALBRA = `# ALBRA-managed CHISMOSO profile.
# El INSTALADOR crea .env.albra (0600) y fija los digests antes del up.
services:
  app:
    image: \${CHISMOSO_IMAGE:?CHISMOSO_IMAGE debe fijarse por digest sha256}
    restart: unless-stopped
    env_file:
      - .env.albra
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: 0.0.0.0
      REDIS_URL: redis://redis:6379
      CHISMOSO_DB_PATH: /data/chismoso.db
      CHISMOSO_OUTPUT_DIR: /data/reports
    expose:
      - "3000"
    volumes:
      - chismoso_data:/data
      - chismoso_reports:/data/reports
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - private
      - albra_gateway
    healthcheck:
      test: ["/opt/scripts/healthcheck.sh"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3
    security_opt:
      - no-new-privileges:true
    logging: &default-logging
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
    deploy:
      resources:
        limits: { cpus: "2.0", memory: 1G }

  scheduler:
    image: \${CHISMOSO_IMAGE:?CHISMOSO_IMAGE debe fijarse por digest sha256}
    restart: unless-stopped
    command: ["node", "chismoso/dist/scheduler/run.js"]
    env_file:
      - .env.albra
    environment:
      NODE_ENV: production
      CHISMOSO_DB_PATH: /data/chismoso.db
      CHISMOSO_OUTPUT_DIR: /data/reports
    volumes:
      - chismoso_data:/data
      - chismoso_reports:/data/reports
    depends_on:
      app:
        condition: service_healthy
    networks:
      - private
      - albra_gateway
    security_opt:
      - no-new-privileges:true
    logging: *default-logging
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512M }

  backup:
    image: \${CHISMOSO_IMAGE:?CHISMOSO_IMAGE debe fijarse por digest sha256}
    restart: unless-stopped
    entrypoint: ["/sbin/tini", "--"]
    command:
      - /bin/sh
      - -c
      - |
        echo "[backup] starting backup loop";
        while true; do
          sleep 6h;
          /opt/scripts/backup-sqlite.sh || echo "[backup] backup failed at \$\$(date -u +%FT%TZ)";
        done
    env_file:
      - .env.albra
    environment:
      CHISMOSO_DB_PATH: /data/chismoso.db
      BACKUP_DIR: /data/backups
    volumes:
      - chismoso_data:/data:ro
      - chismoso_backups:/data/backups
    depends_on:
      app:
        condition: service_healthy
    networks:
      - private
    security_opt:
      - no-new-privileges:true
    logging: *default-logging
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 256M }

  redis:
    image: \${CHISMOSO_REDIS_IMAGE:?CHISMOSO_REDIS_IMAGE debe fijarse por digest sha256}
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    volumes:
      - redis_data:/data
    networks:
      - private
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 5s
    security_opt:
      - no-new-privileges:true
    logging: *default-logging
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 256M }

volumes:
  chismoso_data:
  chismoso_reports:
  chismoso_backups:
  redis_data:

networks:
  private:
    driver: bridge
    internal: true
  albra_gateway:
    external: true
    name: albra-agents
`;

/** Declaración de despliegue embebida en manifest.metadata (contrato de fuente). */
const CHISMOSO_DEPLOYMENT_SOURCE: ContainerDeploymentSource = {
  kind: "docker-compose",
  composeFile: "compose.albra.yaml",
  envFile: ".env.albra",
  projectName: "chismoso",
  networkName: "albra-agents",
  generatedSecretKeys: ["CHISMOSO_JWT_SECRET"],
  images: [
    { service: "app", imageVar: "CHISMOSO_IMAGE", ref: "ghcr.io/albra8/chismoso:1.5.0" },
    { service: "scheduler", imageVar: "CHISMOSO_IMAGE", ref: "ghcr.io/albra8/chismoso:1.5.0" },
    { service: "backup", imageVar: "CHISMOSO_IMAGE", ref: "ghcr.io/albra8/chismoso:1.5.0" },
    { service: "redis", imageVar: "CHISMOSO_REDIS_IMAGE", ref: "redis:7.4" },
  ],
  healthTimeoutSeconds: 180,
} as const;

const PANEL_DEPLOYMENT_SOURCE: ContainerDeploymentSource = {
  kind: "docker-compose",
  composeFile: "compose.albra.yaml",
  envFile: ".env.albra",
  projectName: "albra-panel",
  networkName: "albra-agents",
  generatedSecretKeys: ["EEC_SESSION_SECRET"],
  envStatic: {
    ALBRA_OPS_URL: "http://host.docker.internal:3000",
  },
  envFromPlatformSecret: [
    { envVar: "ALBRA_OPS_TOKEN", secretKey: "eec.ops.token" },
  ],
  images: [
    { service: "panel", imageVar: "PANEL_IMAGE", ref: "ghcr.io/albra8/panel-de-control:1.0.0" },
  ],
  healthTimeoutSeconds: 120,
} as const;

const CHISMOSO_DEPLOYMENT_JSON = JSON.stringify(
  { albra: "container-deployment-source/1", productId: "chismoso", deployment: CHISMOSO_DEPLOYMENT_SOURCE },
  null, 2,
);

const PANEL_DEPLOYMENT_JSON = JSON.stringify(
  { albra: "container-deployment-source/1", productId: "panel-de-control", deployment: PANEL_DEPLOYMENT_SOURCE },
  null, 2,
);

/**
 * Registro de despliegues contenedores por producto (ORDEN MAESTRA F2/F5):
 * el bootstrap incrusta la declaración en manifest.metadata del paquete y el
 * instalador la recupera en DOWNLOAD vía parseSourceContract.
 */
export const CONTAINER_DEPLOYMENT_SOURCES: Record<string, ContainerDeploymentSource> = {
  "panel-de-control": PANEL_DEPLOYMENT_SOURCE,
  chismoso: CHISMOSO_DEPLOYMENT_SOURCE,
};

export { CHISMOSO_DEPLOYMENT_JSON, PANEL_DEPLOYMENT_JSON };

// ─────────────────── Package builds (bóveda) ───────────────────

export interface PackageBuild {
  packageId: string;
  version: string;
  displayName: string;
  contract: ProductContract;
  /** ORDEN MAESTRA F2/F5: despliegue Docker Compose gestionado (opcional). */
  deployment?: ContainerDeploymentSource;
  payload: {
    application: Array<{ path: string; content: string }>;
    seeds: { contacts?: unknown[]; deals?: unknown[]; leads?: unknown[] };
    migrations: Array<{ migrationId: string; fromVersion: string; toVersion: string; ops: string[] }>;
  };
}

function fileEntries(files: Array<{ path: string; content: string }>) {
  return files.map(f => ({ path: f.path, content: f.content, sha256: sha256(f.content), encoding: "utf8" as const }));
}
import crypto from "crypto";
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

export const PACKAGE_BUILDS: PackageBuild[] = [
  {
    packageId: "crm",
    version: "1.0.0",
    displayName: "ALBRA CRM",
    contract: crmContract("1.0.0"),
    payload: {
      application: [
        { path: "manifest.json", content: crmManifestJson("1.0.0") },
        { path: "product.js", content: crmProductJs("1.0.0") },
        { path: "CHANGELOG.md", content: crmChangelog("1.0.0") },
        { path: "README.md", content: "# ALBRA CRM\nProducto piloto del ecosistema ALBRA.\n" },
      ],
      seeds: CRM_SEEDS,
      migrations: [],
    },
  },
  {
    packageId: "crm",
    version: "1.1.0",
    displayName: "ALBRA CRM",
    contract: crmContract("1.1.0"),
    payload: {
      application: [
        { path: "manifest.json", content: crmManifestJson("1.1.0") },
        { path: "product.js", content: crmProductJs("1.1.0") },
        { path: "CHANGELOG.md", content: crmChangelog("1.1.0") },
        { path: "README.md", content: "# ALBRA CRM\nProducto piloto del ecosistema ALBRA.\n" },
      ],
      seeds: CRM_SEEDS,
      migrations: [
        { migrationId: "crm-2-tags", fromVersion: "1.0.0", toVersion: "1.1.0", ops: ["ADD_COLUMN:tags", "BACKFILL:tags=''", "ENABLE_FEATURE:tags"] },
      ],
    },
  },
  {
    packageId: "leads",
    version: "1.0.0",
    displayName: "ALBRA Agente Leads",
    contract: leadsContract("1.0.0"),
    payload: {
      application: [
        { path: "manifest.json", content: leadsManifestJson("1.0.0") },
        { path: "product.js", content: leadsProductJs("1.0.0") },
        { path: "README.md", content: "# ALBRA Agente Leads\nCaptura y calificación de prospectos.\n" },
      ],
      seeds: LEADS_SEEDS,
      migrations: [],
    },
  },
  {
    packageId: "panel-de-control",
    version: "1.0.0",
    displayName: "ALBRA Panel de Control",
    contract: panelContract("1.0.0"),
    deployment: PANEL_DEPLOYMENT_SOURCE,
    payload: {
      application: [
        { path: "compose.albra.yaml", content: PANEL_COMPOSE_ALBRA },
        { path: "README.md", content: "# ALBRA Panel de Control\nDesplegado y administrado por el INSTALADOR (red albra-agents).\n" },
      ],
      seeds: {},
      migrations: [],
    },
  },
  {
    packageId: "chismoso",
    version: "1.5.0",
    displayName: "ALBRA Agente Chismoso",
    contract: chismosoContract("1.5.0"),
    deployment: CHISMOSO_DEPLOYMENT_SOURCE,
    payload: {
      application: [
        { path: "compose.albra.yaml", content: CHISMOSO_COMPOSE_ALBRA },
        { path: "albra/deployment.json", content: CHISMOSO_DEPLOYMENT_JSON },
        { path: "README.md", content: "# ALBRA Agente Chismoso\nPrimer agente gestionado: red interna, sin puertos al host, secretos del INSTALADOR.\n" },
      ],
      seeds: {},
      migrations: [],
    },
  },
];

export { fileEntries };

// ─────────────────── Catálogo visible en el Launcher ───────────────────

export interface CatalogEntry {
  productId: string;
  displayName: string;
  description: string;
  icon: string;
  category: string;
  /** Producto con paquete instalable. */
  installable: boolean;
  /** Bloqueado por entitlement (🔒 No adquirido). */
  locked: boolean;
  requiredEntitlement?: string;
  latestVersion: string;
}

export const CATALOG: CatalogEntry[] = [
  { productId: "crm", displayName: "ALBRA CRM", description: "Contactos, pipeline de oportunidades y seguimiento comercial.", icon: "Users", category: "ventas", installable: true, locked: false, latestVersion: "1.1.0" },
  { productId: "leads", displayName: "ALBRA Agente Leads", description: "Captura y calificación de leads con embudo simple.", icon: "Target", category: "marketing", installable: true, locked: false, latestVersion: "1.0.0" },
  { productId: "panel-de-control", displayName: "ALBRA Panel de Control", description: "Centro de administración del ecosistema: descubre e instala agentes vía contrato EEC (despliegue Docker gestionado).", icon: "LayoutDashboard", category: "plataforma", installable: true, locked: false, latestVersion: "1.0.0" },
  { productId: "chismoso", displayName: "ALBRA Agente Chismoso", description: "Inteligencia de señales: investigación y reportes. Primer agente gestionado en Docker (red interna albra-agents, sin puertos al host).", icon: "Radar", category: "marketing", installable: true, locked: false, latestVersion: "1.5.0" },
  { productId: "krea", displayName: "ALBRA Agente KREA", description: "Asistente creativo con IA para generación de contenido.", icon: "Sparkles", category: "ia", installable: false, locked: true, requiredEntitlement: "entitlement.krea", latestVersion: "0.9.0" },
  { productId: "trading", displayName: "ALBRA Trading", description: "Automatización y monitoreo de operaciones de trading.", icon: "LineChart", category: "finanzas", installable: false, locked: true, requiredEntitlement: "entitlement.trading", latestVersion: "0.9.0" },
];

export function getContractFor(productId: string, version: string): ProductContract | null {
  const build = PACKAGE_BUILDS.find(b => b.packageId === productId && b.version === version);
  return build ? build.contract : null;
}

export function getLatestVersion(productId: string): string | null {
  const builds = PACKAGE_BUILDS.filter(b => b.packageId === productId).map(b => b.version);
  if (builds.length === 0) return null;
  return builds.sort((a, b) => Number(b.split(".")[1]) - Number(a.split(".")[1]))[0];
}

/** Versión base (más antigua) — la que instala una instalación fresca. */
export function getBaseVersion(productId: string): string | null {
  const builds = PACKAGE_BUILDS.filter(b => b.packageId === productId).map(b => b.version);
  if (builds.length === 0) return null;
  return builds.sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]))[0];
}
