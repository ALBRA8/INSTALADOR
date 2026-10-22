/**
 * ALBRA — Diagnostics Engine: COLLECT → CLASSIFY → EXPLAIN → SUGGEST → REPAIR.
 * Genera hallazgos con código técnico + explicación para el usuario,
 * y sugerencias de reparación con nivel de riesgo. Bundle exportable
 * SIN secretos (redaction aplicada).
 */
import fs from "fs";
import { db } from "@/lib/db";
import { productAppDir } from "@/lib/albra/env";
import { getDeploymentAdapter } from "@/lib/albra/adapters";
import { requireInstalled } from "@/lib/albra/core/registry";
import { latestHealth } from "@/lib/albra/core/health";
import { getLatestVersion } from "@/lib/albra/products/catalog";
import { listSecrets, redactValue } from "@/lib/albra/core/secrets";
import type { DiagnosticFinding } from "@/lib/albra/contracts";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";

export interface DiagnosticsBundle {
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
  recentLogs: Array<{ level: string; message: string; createdAt: Date }>;
  configSummary: Record<string, unknown>;
  findings: DiagnosticFinding[];
}

export async function collectDiagnostics(productId: string): Promise<DiagnosticsBundle> {
  const installed = await requireInstalled(productId);
  const adapter = getDeploymentAdapter();
  const platform = adapter.info();
  const health = await latestHealth(productId);
  const logs = await db.logEntry.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { level: true, message: true, createdAt: true },
  });
  const configs = await db.configRecord.findMany({ where: { productId } });
  const secrets = await listSecrets(productId);
  const appDir = productAppDir(productId);
  const appFilesOk = fs.existsSync(`${appDir}/manifest.json`) && fs.existsSync(`${appDir}/product.js`);
  const latestAvailable = getLatestVersion(productId);

  const findings: DiagnosticFinding[] = [];

  // Clasificación por estado de ciclo de vida
  if (installed.state === "STOPPED") {
    findings.push({
      findingId: "f-state",
      code: "SERVICE_STOPPED",
      severity: "WARN",
      title: "El producto está detenido",
      explain: "No pudimos servir el producto porque el servicio está detenido. Puedes iniciarlo sin riesgo.",
      repairs: [{ actionId: "START_SERVICE", label: "Iniciar servicio", risk: "LOW", description: "Inicia el servicio del producto." }],
    });
  }
  if (installed.state === "FAILED" || health?.overall === "FAILED") {
    findings.push({
      findingId: "f-health",
      code: "SERVICE_UNHEALTHY",
      severity: "ERROR",
      title: "El producto reporta estado de fallo",
      explain: "ALBRA detectó que el producto no pasó sus verificaciones de salud. Un reinicio suele resolverlo.",
      repairs: [
        { actionId: "RESTART_SERVICE", label: "Reiniciar servicio", risk: "LOW", description: "Reinicia el servicio de forma segura." },
        { actionId: "RESTAGE_FILES", label: "Reparar archivos de aplicación", risk: "LOW", description: "Reintala los archivos desde el paquete firmado y verifica su integridad." },
      ],
    });
  }
  // Checks de salud fallidos específicos
  const failedChecks = ((health?.checks ?? []) as Array<{ checkId: string; status: string; label: string }>).filter(c => c.status === "FAIL");
  for (const check of failedChecks) {
    if (check.checkId === "database") {
      findings.push({
        findingId: `f-db-${check.checkId}`,
        code: "DATABASE_UNAVAILABLE",
        severity: "ERROR",
        title: "Base de datos no accesible",
        explain: "El producto no puede leer sus datos. ALBRA puede reconstruir el esquema de datos del producto.",
        repairs: [
          { actionId: "RESEED_DATABASE", label: "Reconstruir datos del producto", risk: "MEDIUM", description: "Restablece los datos del producto a su estado inicial. Requiere confirmación." },
        ],
      });
    }
    if (check.checkId === "app-files") {
      findings.push({
        findingId: `f-files-${check.checkId}`,
        code: "FILE_CHECKSUM_MISMATCH",
        severity: "ERROR",
        title: "Archivos de aplicación inconsistentes",
        explain: "Los archivos instalados no coinciden con el paquete firmado. ALBRA puede reinstalarlos desde la bóveda.",
        repairs: [{ actionId: "RESTAGE_FILES", label: "Reinstalar archivos desde el paquete", risk: "LOW", description: "Re-stage de archivos desde el paquete firmado." }],
      });
    }
    if (check.checkId === "storage") {
      findings.push({
        findingId: `f-storage-${check.checkId}`,
        code: "STORAGE_ERROR",
        severity: "ERROR",
        title: "Almacenamiento de datos sin acceso",
        explain: "No se puede escribir en el directorio de datos del producto.",
        repairs: [{ actionId: "RESTAGE_FILES", label: "Recrear estructura de archivos", risk: "LOW", description: "Recrea la estructura de directorios del producto." }],
      });
    }
  }
  // Stale runtime: marcado RUNNING pero sin health reciente
  if (installed.state === "RUNNING" && installed.lastHealthAt) {
    const staleMs = Date.now() - new Date(installed.lastHealthAt).getTime();
    if (staleMs > 10 * 60 * 1000) {
      findings.push({
        findingId: "f-stale",
        code: "STALE_RUNTIME",
        severity: "WARN",
        title: "Runtime sin latido reciente",
        explain: "El servicio está marcado como activo pero no reporta salud desde hace más de 10 minutos.",
        repairs: [{ actionId: "RESTART_SERVICE", label: "Reiniciar servicio", risk: "LOW", description: "Reinicia el servicio para recuperar el latido." }],
      });
    }
  }
  if (configs.length < 3) {
    findings.push({
      findingId: "f-config",
      code: "CONFIG_MISSING",
      severity: "WARN",
      title: "Configuración incompleta",
      explain: "Faltan secciones de configuración del producto. ALBRA puede restaurar los valores por defecto.",
      repairs: [{ actionId: "RESTORE_DEFAULT_CONFIG", label: "Restaurar configuración por defecto", risk: "LOW", description: "Restaura valores por defecto de USER/SYSTEM/PRODUCT." }],
    });
  }
  if (findings.length === 0) {
    findings.push({
      findingId: "f-ok",
      code: "NO_ISSUES",
      severity: "INFO",
      title: "Sin problemas detectados",
      explain: "Todos los subsistemas reportan un estado normal.",
      repairs: [],
    });
  }

  const bundle: DiagnosticsBundle = {
    productId,
    collectedAt: new Date().toISOString(),
    summary: {
      state: installed.state,
      version: installed.version,
      latestAvailable,
      health: health?.overall ?? "UNKNOWN",
      lastHealthAt: installed.lastHealthAt?.toISOString() ?? null,
      platform: `${platform.platform}/${platform.arch}`,
      appFilesOk,
      secretCount: secrets.length,
    },
    system: redactValue({
      adapter: platform.adapterId,
      os: platform.osRelease,
      node: platform.nodeVersion,
      freeDiskMB: platform.freeDiskMB,
      albraHome: platform.albraHome,
    }) as Record<string, unknown>,
    recentLogs: logs,
    configSummary: redactValue(Object.fromEntries(configs.map(c => [c.scope, c.values]))) as Record<string, unknown>,
    findings,
  };

  await db.diagnosticBundleRec.create({
    data: {
      productId,
      summary: bundle.summary as unknown as object,
      findings: findings as unknown as object[],
    },
  });
  await audit({ type: "DIAGNOSTICS_COLLECTED", productId, detail: { findings: findings.map(f => f.code) } });
  await log({ productId, channel: "SYSTEM", message: `Diagnóstico recogido: ${findings.length} hallazgos` });
  return bundle;
}
