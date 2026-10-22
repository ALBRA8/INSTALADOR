/**
 * ALBRA — LAYER 6: PRODUCTS (catálogo)
 * Cada producto es independiente. Aislamiento por contrato explícito.
 * Piloto: CRM. Segundo producto instalable: LEADS (prueba de aislamiento).
 * KREA y TRADING: bloqueados por entitlement (concepto futuro SaaS).
 */
import type { ProductContract } from "@/lib/albra/contracts";

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
    { checkId: "runtime", label: "Runtime del servicio", target: "runtime" as const, critical: true },
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
      { checkId: "runtime", label: "Runtime del servicio", target: "runtime" as const, critical: true },
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

function crmProductJs(version: string): string {
  return `// ALBRA CRM — runtime module v${version}
// Módulo de producto. Se ejecuta bajo el Runtime Manager de ALBRA Platform.
export const product = {
  id: "crm",
  version: "${version}",
  start(ctx) { ctx.log("CRM service started"); return { status: "RUNNING" }; },
  stop(ctx) { ctx.log("CRM service stopped"); return { status: "STOPPED" }; },
  health(ctx) { return ctx.checkDatabase() && ctx.checkStorage() ? "HEALTHY" : "DEGRADED"; },
  migrate(ctx, migration) { ctx.log("Running migration " + migration.migrationId); return migration.run(); },
};
`;
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
  return `// ALBRA Agente Leads — runtime module v${version}
export const product = {
  id: "leads",
  version: "${version}",
  start(ctx) { ctx.log("Leads service started"); return { status: "RUNNING" }; },
  stop(ctx) { ctx.log("Leads service stopped"); return { status: "STOPPED" }; },
  health(ctx) { return ctx.checkDatabase() ? "HEALTHY" : "DEGRADED"; },
};
`;
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

// ─────────────────── Package builds (bóveda) ───────────────────

export interface PackageBuild {
  packageId: string;
  version: string;
  displayName: string;
  contract: ProductContract;
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
