/**
 * ALBRA — Certification Runner (WAVE 10).
 * Ejecuta la suite completa del estándar ALBRA sobre el producto piloto:
 * INSTALL → CONFIGURE → START → HEALTH → STOP → RESTART → UPDATE →
 * HEALTH → ROLLBACK → HEALTH → DIAGNOSTICS → REPAIR → BACKUP → RESTORE →
 * UNINSTALL → CLEAN ROOM (reinstalación) → HEALTH.
 * Solo ALBRA CERTIFIED si todos los pasos pasan.
 */
import { db } from "@/lib/db";
import { runInstall } from "@/lib/albra/core/installer";
import { runUpdate, rollbackLastUpdate } from "@/lib/albra/core/updater";
import { runUninstall } from "@/lib/albra/core/uninstaller";
import { startProduct, stopProduct } from "@/lib/albra/core/runtime";
import { runHealthChecks } from "@/lib/albra/core/health";
import { createBackup, restoreBackup, latestBackup } from "@/lib/albra/core/backup";
import { collectDiagnostics } from "@/lib/albra/core/diagnostics";
import { executeRepair } from "@/lib/albra/core/repair";
import { awaitRun, getRun, registerRunPromise } from "@/lib/albra/core/runs";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";

export interface CertStepResult {
  step: string;
  label: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
  durationMs: number;
}

const SUITE: Array<{ step: string; label: string }> = [
  { step: "PREP", label: "Preparación (estado limpio)" },
  { step: "INSTALL", label: "Instalación transaccional" },
  { step: "CONFIGURE", label: "Configuración inicializada" },
  { step: "START", label: "Arranque del servicio" },
  { step: "HEALTH_1", label: "Salud: HEALTHY" },
  { step: "STOP", label: "Detención" },
  { step: "RESTART", label: "Reinicio" },
  { step: "BACKUP", label: "Copia de seguridad" },
  { step: "UPDATE", label: "Actualización a 1.1.0" },
  { step: "HEALTH_2", label: "Salud tras actualización" },
  { step: "ROLLBACK", label: "Rollback a versión anterior" },
  { step: "HEALTH_3", label: "Salud tras rollback" },
  { step: "DIAGNOSTICS", label: "Diagnóstico completo" },
  { step: "REPAIR", label: "Reparación (restage de archivos)" },
  { step: "RESTORE", label: "Restauración de backup" },
  { step: "UNINSTALL", label: "Desinstalación (DELETE)" },
  { step: "CLEANROOM", label: "Clean-room: reinstalación desde cero" },
  { step: "HEALTH_4", label: "Salud final" },
];

async function awaitRunStatus(runId: string): Promise<{ status: string; error: string | null }> {
  await awaitRun(runId);
  const row = await getRun(runId);
  return { status: row?.status ?? "UNKNOWN", error: row?.error ?? null };
}

export async function runCertification(productId = "crm", pace = 60): Promise<{ runId: string }> {
  const run = await db.lifecycleRun.create({
    data: { operation: "CERTIFICATION", productId, steps: [] as object[] },
  });
  const flow = (async () => {
    const results: CertStepResult[] = [];
    const record = async (step: string, label: string, fn: () => Promise<string>): Promise<boolean> => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        results.push({ step, label, status: "PASS", detail, durationMs: Date.now() - t0 });
        return true;
      } catch (e) {
        results.push({ step, label, status: "FAIL", detail: (e as Error).message, durationMs: Date.now() - t0 });
        return false;
      }
    };

    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    await record("PREP", "Preparación (estado limpio)", async () => {
      const installed = await db.installedProduct.findUnique({ where: { productId } });
      if (installed) {
        const { runId } = await runUninstall(productId, "DELETE", pace);
        const st = await awaitRunStatus(runId);
        if (st.status !== "SUCCESS") throw new Error(st.error ?? "PREP_UNINSTALL_FAILED");
      }
      return "Estado limpio garantizado";
    });
    await wait(pace);

    let ok = results.every(r => r.status === "PASS");

    if (ok) ok = await record("INSTALL", "Instalación transaccional", async () => {
      const { runId } = await runInstall(productId, { paceMs: pace });
      const st = await awaitRunStatus(runId);
      if (st.status !== "SUCCESS") throw new Error(st.error ?? "INSTALL_FAILED");
      return "Instalado con commit transaccional";
    });

    if (ok) ok = await record("CONFIGURE", "Configuración inicializada", async () => {
      const configs = await db.configRecord.findMany({ where: { productId } });
      if (configs.length < 3) throw new Error("CONFIG_INCOMPLETE");
      return `${configs.length} scopes de configuración (USER/SYSTEM/PRODUCT)`;
    });

    if (ok) ok = await record("START", "Arranque del servicio", async () => {
      const res = await startProduct(productId);
      if (!res.ok) throw new Error(res.error ?? "START_FAILED");
      return `Puerto ${res.port}`;
    });

    if (ok) ok = await record("HEALTH_1", "Salud: HEALTHY", async () => {
      const h = await runHealthChecks(productId);
      if (h.overall !== "HEALTHY") throw new Error(`Health=${h.overall}`);
      return `${h.checks.length} checks ejecutados`;
    });

    if (ok) ok = await record("STOP", "Detención", async () => {
      const res = await stopProduct(productId);
      if (!res.ok) throw new Error(res.error ?? "STOP_FAILED");
      return "Detenido";
    });

    if (ok) ok = await record("RESTART", "Reinicio", async () => {
      const res = await startProduct(productId);
      if (!res.ok) throw new Error(res.error ?? "START_FAILED");
      return "Reiniciado";
    });

    if (ok) ok = await record("BACKUP", "Copia de seguridad", async () => {
      const b = await createBackup(productId, "MANUAL", "Certification suite");
      return `Backup ${b.id.slice(0, 8)}…`;
    });

    if (ok) ok = await record("UPDATE", "Actualización a 1.1.0", async () => {
      const { runId } = await runUpdate(productId, "1.1.0", null, pace);
      const st = await awaitRunStatus(runId);
      if (st.status !== "SUCCESS") throw new Error(st.error ?? "UPDATE_FAILED");
      return "v1.1.0 commitada";
    });

    if (ok) ok = await record("HEALTH_2", "Salud tras actualización", async () => {
      const h = await runHealthChecks(productId);
      if (h.overall !== "HEALTHY") throw new Error(`Health=${h.overall}`);
      return "HEALTHY en v1.1.0";
    });

    if (ok) ok = await record("ROLLBACK", "Rollback a versión anterior", async () => {
      const { runId } = await rollbackLastUpdate(productId, pace);
      const st = await awaitRunStatus(runId);
      if (st.status !== "SUCCESS") throw new Error(st.error ?? "ROLLBACK_FAILED");
      const version = (await db.installedProduct.findUnique({ where: { productId } }))?.version;
      if (version !== "1.0.0") throw new Error(`Versión tras rollback: ${version}`);
      return "Restaurado a v1.0.0";
    });

    if (ok) ok = await record("HEALTH_3", "Salud tras rollback", async () => {
      const h = await runHealthChecks(productId);
      if (h.overall !== "HEALTHY") throw new Error(`Health=${h.overall}`);
      return "HEALTHY en v1.0.0";
    });

    if (ok) ok = await record("DIAGNOSTICS", "Diagnóstico completo", async () => {
      const bundle = await collectDiagnostics(productId);
      return `${bundle.findings.length} hallazgos clasificados`;
    });

    if (ok) ok = await record("REPAIR", "Reparación (restage de archivos)", async () => {
      const res = await executeRepair(productId, "RESTAGE_FILES", true, pace);
      if (!res.ok) throw new Error(res.message);
      return "Archivos verificados contra paquete firmado";
    });

    if (ok) ok = await record("RESTORE", "Restauración de backup", async () => {
      const b = await latestBackup(productId);
      if (!b) throw new Error("NO_BACKUP");
      const r = await restoreBackup(b.id);
      if (!r.ok) throw new Error(r.error ?? "RESTORE_FAILED");
      return "Datos restaurados";
    });

    if (ok) ok = await record("UNINSTALL", "Desinstalación (DELETE)", async () => {
      const { runId } = await runUninstall(productId, "DELETE", pace);
      const st = await awaitRunStatus(runId);
      if (st.status !== "SUCCESS") throw new Error(st.error ?? "UNINSTALL_FAILED");
      return "Desinstalado y validado";
    });

    if (ok) ok = await record("CLEANROOM", "Clean-room: reinstalación desde cero", async () => {
      const { runId } = await runInstall(productId, { paceMs: pace });
      const st = await awaitRunStatus(runId);
      if (st.status !== "SUCCESS") throw new Error(st.error ?? "CLEANROOM_INSTALL_FAILED");
      return "Reinstalado sin estado previo";
    });

    if (ok) ok = await record("HEALTH_4", "Salud final", async () => {
      const h = await runHealthChecks(productId);
      if (h.overall !== "HEALTHY") throw new Error(`Health=${h.overall}`);
      return "HEALTHY — producto operativo";
    });

    const passed = results.length === SUITE.length && results.every(r => r.status === "PASS");
    await db.lifecycleRun.update({
      where: { id: run.id },
      data: {
        status: passed ? "SUCCESS" : "FAILURE",
        steps: results as unknown as object[],
        result: { passed, total: results.length, failures: results.filter(r => r.status === "FAIL").length } as object,
        finishedAt: new Date(),
      },
    });
    await db.platformState.upsert({
      where: { key: `certification:${productId}` },
      create: { key: `certification:${productId}`, value: { passed, at: new Date().toISOString(), runId: run.id } as object },
      update: { value: { passed, at: new Date().toISOString(), runId: run.id } as object },
    });
    await audit({ type: "CERTIFICATION_COMPLETED", productId, severity: passed ? "INFO" : "WARN", detail: { passed, results: results.map(r => `${r.step}:${r.status}`) } });
    await log({ productId, channel: "AUDIT", level: passed ? "info" : "warn", message: `Certificación ${passed ? "APROBADA" : "FALLIDA"}` });
  })();
  registerRunPromise(run.id, flow);
  return { runId: run.id };
}

export async function getCertification(productId: string) {
  const row = await db.lifecycleRun.findFirst({
    where: { operation: "CERTIFICATION", productId },
    orderBy: { startedAt: "desc" },
  });
  return row;
}
