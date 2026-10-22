/**
 * ALBRA — Uninstall Engine:
 *
 * PRECHECK → BACKUP → STOP → REMOVE APPLICATION → REMOVE SERVICES →
 * REMOVE CONFIGURATION → CLEAN → VALIDATE
 *
 * Modos de datos: KEEP (conservar) / EXPORT (exportar y eliminar) / DELETE.
 */
import fs from "fs";
import { db } from "@/lib/db";
import { PATHS, ensureDirs, productAppDir, productDataDir, productPreviousDir } from "@/lib/albra/env";
import { withLock } from "@/lib/albra/core/registry";
import { stopProduct } from "@/lib/albra/core/runtime";
import { createBackup, deleteBackupsFor } from "@/lib/albra/core/backup";
import { deleteSecretsFor } from "@/lib/albra/core/secrets";
import { clearProductData, exportProductData } from "@/lib/albra/products/data";
import { Run, sleep, registerRunPromise } from "@/lib/albra/core/runs";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";
import type { DataMode } from "@/lib/albra/contracts";

const STEP_DEFS = [
  { step: "PRECHECK", label: "Comprobaciones previas" },
  { step: "BACKUP", label: "Copia de seguridad de seguridad" },
  { step: "STOP", label: "Deteniendo servicio" },
  { step: "REMOVE_APPLICATION", label: "Eliminando aplicación" },
  { step: "REMOVE_SERVICES", label: "Eliminando servicios" },
  { step: "REMOVE_CONFIGURATION", label: "Eliminando configuración y secretos" },
  { step: "CLEAN", label: "Limpieza final" },
  { step: "VALIDATE", label: "Validando desinstalación" },
];

export async function runUninstall(productId: string, dataMode: DataMode, pace = 200): Promise<{ runId: string; exportPath?: string }> {
  const run = await Run.create("UNINSTALL", productId, STEP_DEFS);
  let exportPath: string | undefined;
  const flow = (async () => {
    try {
      await withLock(productId, async () => {
        const installed = await db.installedProduct.findUnique({ where: { productId } });
        if (!installed) throw new Error("PRODUCT_NOT_INSTALLED");

        await run.begin("PRECHECK");
        await sleep(pace);
        if (installed.state === "RUNNING" && productId === "") throw new Error("IMPOSSIBLE"); // noop guard
        await run.done("PRECHECK", "SUCCESS", `Desinstalando v${installed.version} · modo de datos: ${dataMode}`);

        await run.begin("BACKUP");
        await sleep(pace);
        const bk = await createBackup(productId, "PRE_UNINSTALL", "Backup de seguridad antes de desinstalar");
        await run.done("BACKUP", "SUCCESS", `Backup de seguridad creado (${bk.id.slice(0, 8)}…)`);

        await run.begin("STOP");
        await sleep(pace);
        await stopProduct(productId);
        await run.done("STOP", "SUCCESS", "Servicio detenido");

        await run.begin("REMOVE_APPLICATION");
        await sleep(pace);
        fs.rmSync(productAppDir(productId), { recursive: true, force: true });
        fs.rmSync(productPreviousDir(productId), { recursive: true, force: true });
        await run.done("REMOVE_APPLICATION", "SUCCESS", "Archivos de aplicación eliminados");

        await run.begin("REMOVE_SERVICES");
        await sleep(pace);
        await db.providerRecord.deleteMany({ where: { productId } });
        await run.done("REMOVE_SERVICES", "SUCCESS", "Servicios y proveedores desregistrados");

        await run.begin("REMOVE_CONFIGURATION");
        await sleep(pace);
        await db.configRecord.deleteMany({ where: { productId } });
        const secretsRemoved = await deleteSecretsFor(productId);
        await run.done("REMOVE_CONFIGURATION", "SUCCESS", `Configuración eliminada · ${secretsRemoved} secretos borrados del SecretStore`);

        await run.begin("CLEAN");
        await sleep(pace);
        if (dataMode === "EXPORT") {
          ensureDirs();
          const snapshot = await exportProductData(productId);
          exportPath = `${PATHS.exports}/${productId}-data-${Date.now()}.json`;
          fs.writeFileSync(exportPath, JSON.stringify({ productId, exportedAt: new Date().toISOString(), snapshot }, null, 2), "utf-8");
          await clearProductData(productId);
          fs.rmSync(productDataDir(productId), { recursive: true, force: true });
          await run.done("CLEAN", "SUCCESS", `Datos exportados a ${exportPath} y eliminados`);
        } else if (dataMode === "DELETE") {
          await clearProductData(productId);
          fs.rmSync(productDataDir(productId), { recursive: true, force: true });
          await deleteBackupsFor(productId);
          await run.done("CLEAN", "SUCCESS", "Datos del producto eliminados permanentemente");
        } else {
          await run.done("CLEAN", "SUCCESS", "Datos conservados para una futura reinstalación (modo KEEP)");
        }

        await run.begin("VALIDATE");
        await sleep(pace);
        await db.healthSnapshot.deleteMany({ where: { productId } });
        await db.diagnosticBundleRec.deleteMany({ where: { productId } });
        await db.installedProduct.delete({ where: { productId } });
        const remaining = await db.installedProduct.findUnique({ where: { productId } });
        if (remaining) throw new Error("UNINSTALL_VALIDATION_FAILED");
        await run.done("VALIDATE", "SUCCESS", "Registro limpio · producto disponible en el catálogo");

        await run.finish("SUCCESS", { dataMode, exportPath });
        await audit({ type: "UNINSTALL_COMPLETED", productId, detail: { dataMode, exportPath } });
        await log({ productId, channel: "USER", message: "Producto desinstalado correctamente" });
      });
    } catch (e) {
      const message = (e as Error).message;
      for (const s of run.steps) {
        if (s.status === "PENDING") s.status = "SKIPPED";
        if (s.status === "RUNNING") { s.status = "FAILURE"; s.detail = message; }
      }
      await run.finish("FAILURE", undefined, message);
      await audit({ type: "UNINSTALL_STARTED", productId, severity: "ERROR", detail: { error: message } });
    }
  })();
  registerRunPromise(run.id, flow);
  return { runId: run.id, exportPath };
}
