/**
 * ALBRA — Contrato de API compartido cliente/servidor.
 * Única fuente de verdad para la UI.
 */

// ───────────── Runs (observabilidad de operaciones) ─────────────

export type RunStepStatus = "PENDING" | "RUNNING" | "SUCCESS" | "WARNING" | "FAILURE" | "SKIPPED";
export type RunStatus = "RUNNING" | "SUCCESS" | "WARNING" | "FAILURE" | "ROLLED_BACK";

export interface RunStepDTO {
  step: string;
  label: string;
  status: RunStepStatus;
  detail?: string;
  at?: string;
  durationMs?: number;
}

export interface LifecycleRunDTO {
  id: string;
  productId: string | null;
  operation: string;
  status: RunStatus;
  steps: RunStepDTO[];
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

// ───────────── Catálogo / Launcher ─────────────

export type LifecycleStateDTO =
  | "AVAILABLE" | "INSTALLING" | "INSTALLED" | "STARTING" | "RUNNING"
  | "STOPPED" | "DEGRADED" | "FAILED" | "UPDATING" | "REPAIRING" | "UNINSTALLING";

export interface CatalogItem {
  productId: string;
  displayName: string;
  description: string;
  icon: string;
  category: string;
  state: LifecycleStateDTO;
  health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  locked: boolean;
  requiredEntitlement?: string | null;
  port: number | null;
  busy: boolean;
  certified: boolean;
}

// ───────────── Detalle de producto ─────────────

export interface ConfigFieldDTO {
  key: string;
  label: string;
  scope: "USER" | "SYSTEM" | "PRODUCT";
  type: "string" | "email" | "number" | "select" | "boolean" | "secret";
  required: boolean;
  defaultValue?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  systemManaged: boolean;
}

export interface HealthCheckDTO {
  checkId: string;
  label: string;
  target: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIP";
  detail?: string;
  critical: boolean;
}

export interface ProviderDTO {
  providerId: string;
  label: string;
  kind: string;
  status: string;
  description?: string;
}

export interface BackupDTO {
  id: string;
  kind: string;
  version: string;
  note?: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface ProductDetail {
  productId: string;
  displayName: string;
  vendor: string;
  version: string;
  state: LifecycleStateDTO;
  health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  port: number | null;
  runtimeHandle: string | null;
  installPath: string | null;
  dataPath: string | null;
  installedAt: string | null;
  lastHealthAt: string | null;
  checks: HealthCheckDTO[];
  providers: ProviderDTO[];
  updates: Array<{ version: string; hasMigration: boolean }>;
  rollbackAvailable: boolean;
  backups: BackupDTO[];
  configFields: ConfigFieldDTO[];
  configValues: { USER: Record<string, unknown>; SYSTEM: Record<string, unknown>; PRODUCT: Record<string, unknown> };
  certified: boolean;
  certifiedAt?: string | null;
}

// ───────────── Preflight / Paquetes / Sistema ─────────────

export interface PreflightIssueDTO {
  code: string;
  severity: "BLOCKER" | "WARNING" | "RESOLVED";
  message: string;
}

export interface PreflightReportDTO {
  ok: boolean;
  issues: PreflightIssueDTO[];
  platform: {
    adapterLabel: string;
    platform: string;
    arch: string;
    osRelease: string;
    nodeVersion: string;
    freeDiskMB: number;
  };
  assignedPort?: number;
}

export interface PackageDTO {
  fileName: string;
  packageId: string;
  version: string;
  displayName: string;
  channel: string;
  sizeBytes: number;
  verified: boolean;
  verifyReason?: string;
  sha256: string;
  signatureKeyId: string;
  tampered: boolean;
}

export interface SystemInfoDTO {
  version: string;
  adapterId: string;
  adapterLabel: string;
  platform: string;
  arch: string;
  osRelease: string;
  nodeVersion: string;
  totalMemMB: number;
  freeDiskMB: number;
  albraHome: string;
  productsInstalled: number;
  packagesInVault: number;
  uptimeS: number;
}

// ───────────── Diagnóstico / Reparación ─────────────

export interface RepairActionDTO {
  actionId: string;
  label: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  description: string;
}

export interface FindingDTO {
  findingId: string;
  code: string;
  severity: "INFO" | "WARN" | "ERROR";
  title: string;
  explain: string;
  repairs: RepairActionDTO[];
}

export interface DiagnosticsDTO {
  productId: string;
  collectedAt: string;
  summary: {
    state: string;
    version: string;
    latestAvailable: string | null;
    health: string;
    lastHealthAt: string | null;
    platform: string;
    appFilesOk: boolean;
    secretCount: number;
  };
  system: Record<string, unknown>;
  recentLogs: Array<{ level: string; message: string; createdAt: string }>;
  configSummary: Record<string, unknown>;
  findings: FindingDTO[];
}

// ───────────── Certificación / Auditoría ─────────────

export interface CertificationStepDTO {
  step: string;
  label: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
  durationMs: number;
}

export interface CertificationDTO {
  id: string;
  productId: string | null;
  status: RunStatus;
  passed: boolean;
  steps: CertificationStepDTO[];
  startedAt: string;
  finishedAt?: string | null;
}

export interface AuditDTO {
  id: string;
  type: string;
  productId?: string | null;
  actor: string;
  severity: "INFO" | "WARN" | "ERROR";
  detail?: unknown;
  createdAt: string;
}

// ───────────── Reportes (docs module) ─────────────

export interface ReportSectionDTO {
  heading: string;
  body: string;
}

export interface ReportDocDTO {
  id: string;
  title: string;
  summary: string;
  sections: ReportSectionDTO[];
}

// ───────────── Datos de productos piloto ─────────────

export interface CrmContactDTO {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  tags?: string | null;
  createdAt: string;
}

export interface CrmDealDTO {
  id: string;
  title: string;
  contactId?: string | null;
  value: number;
  stage: "NUEVO" | "CONTACTADO" | "PROPUESTA" | "GANADO" | "PERDIDO";
  createdAt: string;
}

export interface LeadDTO {
  id: string;
  name: string;
  company?: string | null;
  source: string;
  status: "NUEVO" | "CALIFICADO" | "CONTACTADO" | "DESCARTADO";
  score: number;
  createdAt: string;
}
