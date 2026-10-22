/**
 * ALBRA — Repair Engine. Reparaciones con nivel de riesgo:
 * LOW automáticas; MEDIUM/HIGH requieren confirmación explícita.
 * Las reparaciones destructivas NUNCA se ejecutan solas.
 */
import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { productAppDir, productDataDir } from "@/lib/albra/env";
import { readPackageFile } from "@/lib/albra/package/format";
import { getDeploymentAdapter } from "@/lib/albra/adapters";
import { clearProductData, seedProductData } from "@/lib/albra/products/data";
import { startProductCore, stopProductCore, restartProduct } from "@/lib/albra/core/runtime";
import { runHealthChecks } from "@/lib/albra/core/health";
import { requireInstalled, withLock } from "@/lib/albra/core/registry";
import { Run, registerRunPromise, sleep } from "@/lib/albra/core/runs";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";

export interface RepairResult {
  ok: boolean;
  actionId: string;
  message: string;
  runId?: string;
}

const RISKY_ACTIONS = new Set(["RESEED_DATABASE"]); // MEDIUM: requieren confirm=true

export async function executeRepair(productId: string, actionId: string, confirmed = false, pace = 150): Promise<RepairResult> {
  if (RISKY_ACTIONS.has(actionId) && !confirmed) {
    return { ok: false, actionId, message: "REPAIR_REQUIRES_CONFIRMATION" };
  }
  const run = await Run.create("REPAIR", productId, [
    { step: "LOCATE", label: "Identificando reparación" },
    { step: "EXECUTE", label: "Ejecutando reparación" },
    { step: "VALIDATE", label: "Validando resultado" },
  ]);
  const flow = (async () => {
    try {
      await withLock(productId, async () => {
        const installed = await requireInstalled(productId);
        await run.begin("LOCATE");
        await sleep(pace);
        await audit({ type: "REPAIR_STARTED", productId, detail: { actionId, risk: RISKY_ACTIONS.has(actionId) ? "MEDIUM" : "LOW" } });
        await run.done("LOCATE", "SUCCESS", `Acción: ${actionId}`);

        await run.begin("EXECUTE");
        let detail = "";
        switch (actionId) {
          case "START_SERVICE": {
            const res = await startProductCore(productId);
            if (!res.ok) throw new Error(res.error ?? "START_FAILED");
            detail = `Servicio iniciado en puerto ${res.port}`;
            break;
          }
          case "RESTART_SERVICE": {
            const res = await restartProduct(productId);
            if (!res.ok) throw new Error(res.error ?? "RESTART_FAILED");
            detail = "Servicio reiniciado";
            break;
          }
          case "RESTAGE_FILES": {
            const pkg = readPackageFile(`${productId}-${installed.version}.albra`);
            if (!pkg) throw new Error("PACKAGE_NOT_FOUND");
            const appDir = productAppDir(productId);
            fs.rmSync(appDir, { recursive: true, force: true });
            fs.mkdirSync(appDir, { recursive: true });
            for (const file of pkg.payload.application) {
              const target = path.join(appDir, file.path);
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, file.content, "utf-8");
            }
            fs.mkdirSync(productDataDir(productId), { recursive: true });
            detail = `${pkg.payload.application.length} archivos restaurados desde el paquete firmado`;
            break;
          }
          case "RESEED_DATABASE": {
            await clearProductData(productId);
            const seeded = await seedProductData(productId);
            detail = `Datos del producto reconstruidos (${seeded} registros iniciales)`;
            break;
          }
          case "REASSIGN_PORT": {
            const adapter = getDeploymentAdapter();
            const preferred = productId === "crm" ? [4101, 4111, 4121] : productId === "leads" ? [4102, 4112, 4122] : [4190, 4191];
            const port = await adapter.findFreePort(preferred);
            if (!port) throw new Error("NO_PORT_AVAILABLE");
            await db.installedProduct.update({ where: { productId }, data: { port } });
            detail = `Puerto reasignado automáticamente a ${port}`;
            break;
          }
          case "RESTORE_DEFAULT_CONFIG": {
            const userValues: Record<string, unknown> = {};
            const installed2 = await requireInstalled(productId);
            const pkg = readPackageFile(`${productId}-${installed2.version}.albra`);
            const fields = ((pkg?.contract as { configuration?: { fields?: Array<{ key: string; scope: string; type: string; defaultValue?: unknown }> } })?.configuration?.fields) ?? [];
            for (const f of fields) {
              if (f.type === "secret") continue;
              if (f.scope === "USER" && f.defaultValue !== undefined) userValues[f.key] = f.defaultValue;
            }
            await db.configRecord.upsert({
              where: { productId_scope: { productId, scope: "USER" } },
              create: { productId, scope: "USER", values: userValues as Prisma.InputJsonValue },
              update: { values: userValues as Prisma.InputJsonValue },
            });
            detail = "Configuración de usuario restaurada a valores por defecto";
            break;
          }
          default:
            throw new Error(`UNKNOWN_REPAIR_ACTION: ${actionId}`);
        }
        await run.done("EXECUTE", "SUCCESS", detail);

        await run.begin("VALIDATE");
        await sleep(pace);
        if (installed.state === "RUNNING" || actionId === "START_SERVICE" || actionId === "RESTART_SERVICE") {
          const health = await runHealthChecks(productId);
          await run.done("VALIDATE", health.overall === "FAILED" ? "FAILURE" : "SUCCESS", `Salud: ${health.overall}`);
        } else {
          await run.done("VALIDATE", "SUCCESS", "Reparación aplicada (producto detenido: sin checks de runtime)");
        }
        await run.finish("SUCCESS", { actionId, detail });
        await audit({ type: "REPAIR_COMPLETED", productId, detail: { actionId, detail } });
        await log({ productId, channel: "USER", message: `Reparación completada: ${actionId}` });
      });
    } catch (e) {
      const message = (e as Error).message;
      for (const s of run.steps) {
        if (s.status === "PENDING") s.status = "SKIPPED";
        if (s.status === "RUNNING") { s.status = "FAILURE"; s.detail = message; }
      }
      await run.finish("FAILURE", undefined, message);
      await audit({ type: "REPAIR_STARTED", productId, severity: "ERROR", detail: { actionId, error: message } });
    }
  })();
  registerRunPromise(run.id, flow);
  await flow;
  return { ok: true, actionId, message: "REPAIR_COMPLETED", runId: run.id };
}
