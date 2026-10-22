/**
 * ALBRA — LAYER 1: PRODUCT STANDARD + LAYER 2: UNIVERSAL CONTRACTS
 *
 * Contratos separados por responsabilidad. Ningún "manifest monstruoso":
 * cada contrato tiene schema, versión, validación y reglas de compatibilidad.
 */
import { z } from "zod";

// ───────────────────────── Primitives ─────────────────────────

export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver (x.y.z)");
export type SemVer = z.infer<typeof SemVer>;

export const LifecycleState = z.enum([
  "AVAILABLE", "INSTALLING", "INSTALLED", "STARTING", "RUNNING", "STOPPED",
  "DEGRADED", "FAILED", "UPDATING", "REPAIRING", "UNINSTALLING",
]);
export type LifecycleState = z.infer<typeof LifecycleState>;

export const HealthStatus = z.enum(["HEALTHY", "DEGRADED", "FAILED", "UNKNOWN"]);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const HealthCheckStatus = z.enum(["PASS", "WARN", "FAIL", "SKIP"]);

export const LifecycleOperation = z.enum([
  "INSTALL", "CONFIGURE", "START", "STOP", "RESTART", "UPDATE", "ROLLBACK",
  "DIAGNOSTICS", "REPAIR", "BACKUP", "RESTORE", "UNINSTALL",
]);
export type LifecycleOperation = z.infer<typeof LifecycleOperation>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const DataMode = z.enum(["KEEP", "EXPORT", "DELETE"]);
export type DataMode = z.infer<typeof DataMode>;

// ───────────────── Product Contract (identity + requirements) ─────────────────

export const ProductIdentitySchema = z.object({
  productId: z.string().min(2).regex(/^[a-z0-9-]+$/),
  name: z.string(),
  displayName: z.string(),
  vendor: z.string().default("ALBRA"),
  description: z.string(),
  category: z.string().default("business"),
  icon: z.string().default("Package"),
  version: SemVer,
  releaseChannel: z.enum(["stable", "beta", "alpha"]).default("stable"),
  /** Entitlement requerido para adquirir el producto (futuro SaaS). */
  requiredEntitlement: z.string().optional(),
});
export type ProductIdentity = z.infer<typeof ProductIdentitySchema>;

export const RequirementsSchema = z.object({
  platforms: z.array(z.enum(["windows", "linux", "macos"])).min(1),
  architectures: z.array(z.enum(["x64", "arm64"])).min(1),
  minPlatformVersion: SemVer,
  minDiskMB: z.number().int().positive(),
  preferredPorts: z.array(z.number().int()).default([]),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export const DependencySpecSchema = z.object({
  dependencyId: z.string(),
  kind: z.enum(["runtime", "service", "library", "product"]),
  versionRange: z.string(),
  required: z.boolean().default(true),
  autoInstallable: z.boolean().default(true),
});
export type DependencySpec = z.infer<typeof DependencySpecSchema>;

// ───────────────── Configuration Contract ─────────────────

export const ConfigScope = z.enum(["USER", "SYSTEM", "PRODUCT"]);
export type ConfigScope = z.infer<typeof ConfigScope>;

export const ConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  scope: ConfigScope,
  type: z.enum(["string", "email", "number", "select", "boolean", "secret"]),
  required: z.boolean().default(false),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  description: z.string().optional(),
  /** true = administrado por ALBRA, el usuario no lo edita (paths, ports, runtime). */
  systemManaged: z.boolean().default(false),
});
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

export const ConfigurationContractSchema = z.object({
  fields: z.array(ConfigFieldSchema),
});
export type ConfigurationContract = z.infer<typeof ConfigurationContractSchema>;

// ───────────────── Health Contract ─────────────────

export const HealthCheckSpecSchema = z.object({
  checkId: z.string(),
  label: z.string(),
  target: z.enum(["application", "runtime", "database", "dependencies", "storage", "port", "providers", "http-health"]),
  critical: z.boolean().default(true),
});
export type HealthCheckSpec = z.infer<typeof HealthCheckSpecSchema>;

export const HealthContractSchema = z.object({
  checks: z.array(HealthCheckSpecSchema).min(1),
  intervalSeconds: z.number().int().positive().default(30),
});
export type HealthContract = z.infer<typeof HealthContractSchema>;

// ───────────────── Lifecycle / Update / Rollback / Security ─────────────────

export const LifecycleContractSchema = z.object({
  supportedOperations: z.array(LifecycleOperation),
  autoStartOnInstall: z.boolean().default(true),
  restartable: z.boolean().default(true),
});
export type LifecycleContract = z.infer<typeof LifecycleContractSchema>;

export const MigrationSpecSchema = z.object({
  migrationId: z.string(),
  fromVersion: SemVer,
  toVersion: SemVer,
  description: z.string(),
  /** Riesgo de la migración de datos. HIGH requiere confirmación. */
  risk: RiskLevel.default("LOW"),
});
export type MigrationSpec = z.infer<typeof MigrationSpecSchema>;

export const UpdateContractSchema = z.object({
  migrations: z.array(MigrationSpecSchema).default([]),
  supportsRollback: z.boolean().default(true),
  backupBeforeUpdate: z.boolean().default(true),
});
export type UpdateContract = z.infer<typeof UpdateContractSchema>;

export const SecurityContractSchema = z.object({
  signedPackagesRequired: z.boolean().default(true),
  secretKeys: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  dataClassification: z.enum(["public", "internal", "confidential"]).default("internal"),
});
export type SecurityContract = z.infer<typeof SecurityContractSchema>;

// ───────────────── Providers Contract ─────────────────

export const ProviderStatus = z.enum([
  "DISCOVERED", "AVAILABLE", "CONFIGURED", "AUTHENTICATED", "CONNECTED",
  "HEALTHY", "DEGRADED", "INVALID", "EXPIRED", "BLOCKED",
]);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const ProviderSpecSchema = z.object({
  providerId: z.string(),
  label: z.string(),
  kind: z.enum(["smtp", "database", "storage", "ai", "payment", "custom"]),
  required: z.boolean().default(false),
  description: z.string().optional(),
});
export type ProviderSpec = z.infer<typeof ProviderSpecSchema>;

export const ProvidersContractSchema = z.object({
  providers: z.array(ProviderSpecSchema).default([]),
});
export type ProvidersContract = z.infer<typeof ProvidersContractSchema>;

// ───────────────── Deployment Contract ─────────────────

export const DeploymentKind = z.enum(["local", "selfhosted", "saas"]);
export const DeploymentAdapterId = z.enum(["windows-local", "linux-local", "local-dev", "selfhosted-vps"]);

export const DeploymentContractSchema = z.object({
  kinds: z.array(DeploymentKind).min(1),
  preferredAdapter: DeploymentAdapterId,
});
export type DeploymentContract = z.infer<typeof DeploymentContractSchema>;

// ───────────────── Diagnostics Contract ─────────────────

export const DiagnosticFindingSchema = z.object({
  findingId: z.string(),
  code: z.string(), // SERVICE_STOPPED, DATABASE_UNAVAILABLE, FILE_CHECKSUM_MISMATCH...
  severity: z.enum(["INFO", "WARN", "ERROR"]),
  title: z.string(),
  explain: z.string(),
  repairs: z.array(z.object({
    actionId: z.string(),
    label: z.string(),
    risk: RiskLevel,
    description: z.string(),
  })).default([]),
});
export type DiagnosticFinding = z.infer<typeof DiagnosticFindingSchema>;

// ───────────────── THE PRODUCT CONTRACT (composition, not monolith) ─────────────────

export const ProductContractSchema = z.object({
  contractVersion: SemVer,
  identity: ProductIdentitySchema,
  requirements: RequirementsSchema,
  dependencies: z.array(DependencySpecSchema).default([]),
  configuration: ConfigurationContractSchema,
  health: HealthContractSchema,
  lifecycle: LifecycleContractSchema,
  update: UpdateContractSchema,
  security: SecurityContractSchema,
  providers: ProvidersContractSchema,
  deployment: DeploymentContractSchema,
});
export type ProductContract = z.infer<typeof ProductContractSchema>;

// ───────────────── Compatibility Engine ─────────────────

export type CompatibilityResult =
  | "COMPATIBLE"
  | "INCOMPATIBLE"
  | "UPGRADE_REQUIRED"
  | "MIGRATION_REQUIRED";

function compareSemVer(a: string, b: string): number {
  const [a1, a2, a3] = a.split(".").map(Number);
  const [b1, b2, b3] = b.split(".").map(Number);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function checkCompatibility(opts: {
  platformVersion: string;
  platform: "windows" | "linux" | "macos";
  arch: "x64" | "arm64";
  contract: ProductContract;
}): { result: CompatibilityResult; reasons: string[] } {
  const reasons: string[] = [];
  const c = opts.contract;
  if (!c.requirements.platforms.includes(opts.platform)) {
    reasons.push(`Plataforma ${opts.platform} no soportada (${c.requirements.platforms.join(", ")})`);
  }
  if (!c.requirements.architectures.includes(opts.arch)) {
    reasons.push(`Arquitectura ${opts.arch} no soportada`);
  }
  if (compareSemVer(opts.platformVersion, c.requirements.minPlatformVersion) < 0) {
    reasons.push(`Se requiere ALBRA Platform >= ${c.requirements.minPlatformVersion}`);
    return { result: "UPGRADE_REQUIRED", reasons };
  }
  if (compareSemVer(c.contractVersion, "1.0.0") < 0) {
    reasons.push("Contract schema antiguo: requiere migración de contrato");
    return { result: "MIGRATION_REQUIRED", reasons };
  }
  if (reasons.length > 0) return { result: "INCOMPATIBLE", reasons };
  return { result: "COMPATIBLE", reasons };
}

export function parseProductContract(raw: unknown): { ok: boolean; contract?: ProductContract; errors: string[] } {
  const parsed = ProductContractSchema.safeParse(raw);
  if (parsed.success) return { ok: true, contract: parsed.data, errors: [] };
  return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
}
