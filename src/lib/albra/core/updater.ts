/**
 * ALBRA — Update Engine (LAYER 5) transaccional con rollback automático:
 *
 * CHECK → DOWNLOAD → VERIFY → BACKUP → STAGE → STOP → SWAP → MIGRATE →
 * START → HEALTH → COMMIT
 *
 * Si algo falla tras STOP/SWAP: ROLLBACK → RESTORE → START PREVIOUS → HEALTH.
 * Nunca deja una actualización rota sin un estado claramente reportado.
 */
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import {
  PATHS, ensureDirs, productAppDir, productStagingDir, productPreviousDir,
  writeFileAtomic, commitDirectory,
} from "@/lib/albra/env";
import { readPackageFile, verifyPackage, type AlbraPackage } from "@/lib/albra/package/format";
import { parseProductContract } from "@/lib/albra/contracts";
import { withLock } from "@/lib/albra/core/registry";
import { runHealthChecks } from "@/lib/albra/core/health";
import { startProductCore, stopProductCore } from "@/lib/albra/core/runtime";
import { createBackup } from "@/lib/albra/core/backup";
import { executeMigration } from "@/lib/albra/products/migrations";
import { importProductData } from "@/lib/albra/products/data";
import { Run, sleep, registerRunPromise } from "@/lib/albra/core/runs";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";

const STEP_DEFS = [
  { step: "CHECK", label: "Comprobando actualización disponible" },
  { step: "DOWNLOAD", label: "Descargando paquete" },
  { step: "VERIFY", label: "Verificando hash y firma" },
  { step: "BACKUP", label: "Copia de seguridad previa" },
  { step: "STAGE", label: "Preparando nueva versión (staging)" },
  { step: "STOP", label: "Deteniendo servicio" },
  { step: "SWAP", label: "Intercambiando versión (swap atómico)" },
  { step: "MIGRATE", label: "Ejecutando migraciones de datos" },
  { step: "START", label: "Iniciando nueva versión" },
  { step: "HEALTH", label: "Verificación de salud" },
  { step: "COMMIT", label: "Confirmando actualización" },
  { step: "ROLLBACK_RESTORE", label: "ROLLBACK: restaurando versión anterior" },
  { step: "ROLLBACK_START", label: "ROLLBACK: iniciando versión anterior" },
  { step: "ROLLBACK_HEALTH", label: "ROLLBACK: verificando salud" },
];

export type InjectFailure = "MIGRATION" | "START" | null;

function semverLt(a: string, b: string): boolean {
  const [a1, a2, a3] = a.split(".").map(Number);
  const [b1, b2, b3] = b.split(".").map(Number);
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 < b3;
}

export async function runUpdate(productId: string, targetVersion: string, injectFailure: InjectFailure = null, pace = 200): Promise<{ runId: string }> {
  const run = await Run.create("UPDATE", productId, STEP_DEFS);
  const flow = (async () => {
    const stagingDir = productStagingDir(productId, run.id);
    let swapped = false;
    let stopped = false;
    let backupId: string | null = null;
    try {
      await withLock(productId, async () => {
        const installed = await db.installedProduct.findUnique({ where: { productId } });
        if (!installed) throw new Error("PRODUCT_NOT_INSTALLED");
        const currentVersion = installed.version;

        // CHECK
        await run.begin("CHECK");
        await sleep(pace);
        if (targetVersion === currentVersion) throw new Error("ALREADY_ON_TARGET_VERSION");
        if (semverLt(targetVersion, currentVersion)) throw new Error("DOWNGRADE_NOT_ALLOWED — usa Rollback");
        const pkg = readPackageFile(`${productId}-${targetVersion}.albra`);
        if (!pkg) throw new Error("PACKAGE_NOT_FOUND");
        const parsed = parseProductContract(pkg.contract);
        if (!parsed.ok) throw new Error(`CONTRACT_INVALID — ${parsed.errors.join("; ")}`);
        const targetContract = parsed.contract!;
        const migration = targetContract.update.migrations.find(m => m.fromVersion === currentVersion && m.toVersion === targetVersion) ?? null;
        const needsMigration = migration !== null;
        await run.done("CHECK", "SUCCESS", `v${currentVersion} → v${targetVersion}${needsMigration ? ` · migración: ${migration!.migrationId}` : " · sin migraciones"}`);

        // DOWNLOAD
        await run.begin("DOWNLOAD");
        await sleep(pace);
        ensureDirs();
        const dlPath = path.join(PATHS.downloads, `${productId}-${targetVersion}.albra`);
        writeFileAtomic(dlPath, JSON.stringify(pkg));
        await run.done("DOWNLOAD", "SUCCESS", "Paquete recibido desde la bóveda ALBRA");

        // VERIFY
        await run.begin("VERIFY");
        await sleep(pace);
        const verdict = verifyPackage(JSON.parse(fs.readFileSync(dlPath, "utf-8")));
        if (!verdict.valid) throw new Error(`PACKAGE_INVALID — ${verdict.reason}`);
        await run.done("VERIFY", "SUCCESS", "Firma y hash válidos");

        // BACKUP (auto, previo a tocar nada)
        await run.begin("BACKUP");
        await sleep(pace);
        const backup = await createBackup(productId, "PRE_UPDATE", `Auto-backup antes de actualizar a v${targetVersion}`);
        backupId = backup.id;
        await run.done("BACKUP", "SUCCESS", "Snapshot de datos y versión creado");

        // STAGE
        await run.begin("STAGE");
        await sleep(pace);
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });
        for (const file of pkg.payload.application) {
          const target = path.join(stagingDir, file.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, file.content, "utf-8");
        }
        await run.done("STAGE", "SUCCESS", `${pkg.payload.application.length} archivos staged para v${targetVersion}`);

        // STOP
        await run.begin("STOP");
        await sleep(pace);
        await stopProductCore(productId);
        stopped = true;
        await run.done("STOP", "SUCCESS", "Servicio detenido de forma segura");

        // SWAP (app → .previous, staging → app)
        await run.begin("SWAP");
        await sleep(pace);
        const appDir = productAppDir(productId);
        const prevDir = productPreviousDir(productId);
        fs.rmSync(prevDir, { recursive: true, force: true });
        if (fs.existsSync(appDir)) fs.renameSync(appDir, prevDir);
        fs.renameSync(stagingDir, appDir);
        swapped = true;
        // El registro refleja la versión en disco desde el swap (coherencia para health checks)
        await db.installedProduct.update({ where: { productId }, data: { version: targetVersion } });
        await run.done("SWAP", "SUCCESS", "Versión anterior preservada en .previous");

        // MIGRATE
        await run.begin("MIGRATE");
        await sleep(pace);
        if (injectFailure === "MIGRATION") {
          throw new Error("MIGRATION_FAILED — fallo simulado por el usuario (inyección de fallo)");
        }
        if (needsMigration) {
          const res = await executeMigration(migration!.migrationId, productId);
          await run.done("MIGRATE", res.applied ? "SUCCESS" : "WARNING", res.description);
        } else {
          await run.done("MIGRATE", "SKIPPED", "Sin migraciones declaradas");
        }

        // START
        await run.begin("START");
        await sleep(pace);
        if (injectFailure === "START") {
          throw new Error("SERVICE_START_FAILED — fallo simulado por el usuario (inyección de fallo)");
        }
        const startRes = await startProductCore(productId);
        if (!startRes.ok) throw new Error(`SERVICE_START_FAILED — ${startRes.error}`);
        await run.done("START", "SUCCESS", `v${targetVersion} activa en puerto ${startRes.port}`);

        // HEALTH
        await run.begin("HEALTH");
        await sleep(pace);
        const health = await runHealthChecks(productId);
        if (health.overall === "FAILED") throw new Error("HEALTH_CHECK_FAILED_AFTER_UPDATE");
        await run.done("HEALTH", health.overall === "HEALTHY" ? "SUCCESS" : "WARNING", `Salud: ${health.overall}`);

        // COMMIT
        await run.begin("COMMIT");
        await sleep(pace);
        await db.installedProduct.update({
          where: { productId },
          data: { packageHash: verdict.packageHash },
        });
        fs.rmSync(prevDir, { recursive: true, force: true });
        await run.done("COMMIT", "SUCCESS", `Actualización confirmada: v${targetVersion}`);
        await run.finish("SUCCESS", { fromVersion: currentVersion, toVersion: targetVersion, backupId });
        await audit({ type: "UPDATE_COMPLETED", productId, detail: { fromVersion: currentVersion, toVersion: targetVersion } });
      });
    } catch (e) {
      const message = (e as Error).message;
      await log({ productId, level: "error", message: `Actualización interrumpida: ${message}` });

      const pendingSkip = () => {
        for (const s of run.steps) {
          if (["ROLLBACK_RESTORE", "ROLLBACK_START", "ROLLBACK_HEALTH"].includes(s.step)) continue;
          if (s.status === "PENDING") s.status = "SKIPPED";
          if (s.status === "RUNNING") { s.status = "FAILURE"; s.detail = message; }
        }
      };

      if (stopped || swapped) {
        // ROLLBACK automático — nunca dejar el producto roto.
        try {
          await run.begin("ROLLBACK_RESTORE");
          await sleep(pace);
          const appDir = productAppDir(productId);
          const prevDir = productPreviousDir(productId);
          if (swapped) {
            fs.rmSync(appDir, { recursive: true, force: true });
            if (fs.existsSync(prevDir)) fs.renameSync(prevDir, appDir);
          }
          if (backupId) {
            const bk = await db.backupRecord.findUnique({ where: { id: backupId } });
            if (bk) {
              await importProductData(productId, bk.payload as Parameters<typeof importProductData>[1]);
              await db.installedProduct.update({ where: { productId }, data: { version: bk.version } });
            }
          }
          await run.done("ROLLBACK_RESTORE", "SUCCESS", "Versión anterior restaurada + datos del backup");
        } catch (rbError) {
          await run.done("ROLLBACK_RESTORE", "FAILURE", (rbError as Error).message);
        }
        try {
          await run.begin("ROLLBACK_START");
          await sleep(pace);
          const startRes = await startProductCore(productId);
          if (!startRes.ok) throw new Error(startRes.error ?? "START_FAILED");
          await run.done("ROLLBACK_START", "SUCCESS", "Servicio anterior reactivado");
        } catch (rbError) {
          await run.done("ROLLBACK_START", "FAILURE", (rbError as Error).message);
        }
        try {
          await run.begin("ROLLBACK_HEALTH");
          await sleep(pace);
          const health = await runHealthChecks(productId);
          await run.done("ROLLBACK_HEALTH", health.overall === "FAILED" ? "FAILURE" : "SUCCESS", `Salud tras rollback: ${health.overall}`);
        } catch (rbError) {
          await run.done("ROLLBACK_HEALTH", "FAILURE", (rbError as Error).message);
        }
        pendingSkip();
        await run.finish("ROLLED_BACK", { reason: message, backupId }, message);
        await audit({ type: "UPDATE_ROLLED_BACK", productId, severity: "WARN", detail: { reason: message } });
      } else {
        pendingSkip();
        await run.finish("FAILURE", undefined, message);
        await audit({ type: "UPDATE_FAILED", productId, severity: "ERROR", detail: { reason: message } });
      }
    }
  })();
  registerRunPromise(run.id, flow);
  return { runId: run.id };
}

/**
 * Rollback post-commit (vault-based): restaura la versión anterior usando
 * el paquete original de la bóveda + el backup PRE_UPDATE de datos.
 */
export async function rollbackLastUpdate(productId: string, pace = 200): Promise<{ runId: string }> {
  const STEP_DEFS_RB = [
    { step: "LOCATE", label: "Localizando versión anterior y backup" },
    { step: "VERIFY_PREV", label: "Verificando paquete anterior" },
    { step: "STOP", label: "Deteniendo servicio" },
    { step: "RESTORE_APP", label: "Restaurando aplicación anterior" },
    { step: "RESTORE_DATA", label: "Restaurando datos del backup" },
    { step: "REGISTER", label: "Restaurando registro de versión" },
    { step: "START", label: "Iniciando versión anterior" },
    { step: "HEALTH", label: "Verificando salud" },
  ];
  const run = await Run.create("ROLLBACK", productId, STEP_DEFS_RB);
  const flow = (async () => {
    try {
      await withLock(productId, async () => {
        const installed = await db.installedProduct.findUnique({ where: { productId } });
        if (!installed) throw new Error("PRODUCT_NOT_INSTALLED");

        await run.begin("LOCATE");
        await sleep(pace);
        const backup = await db.backupRecord.findFirst({
          where: { productId, kind: "PRE_UPDATE", version: { not: installed.version } },
          orderBy: { createdAt: "desc" },
        });
        if (!backup) throw new Error("NO_PREVIOUS_VERSION — no hay actualización que revertir");
        await run.done("LOCATE", "SUCCESS", `Objetivo: restaurar v${backup.version} (desde v${installed.version})`);

        await run.begin("VERIFY_PREV");
        await sleep(pace);
        const pkg: AlbraPackage | null = readPackageFile(`${productId}-${backup.version}.albra`);
        if (!pkg) throw new Error("PREVIOUS_PACKAGE_MISSING");
        const verdict = verifyPackage(pkg);
        if (!verdict.valid) throw new Error(`PREVIOUS_PACKAGE_INVALID — ${verdict.reason}`);
        await run.done("VERIFY_PREV", "SUCCESS", "Paquete anterior íntegro y firmado");

        await run.begin("STOP");
        await sleep(pace);
        await stopProductCore(productId);
        await run.done("STOP", "SUCCESS", "Servicio detenido");

        await run.begin("RESTORE_APP");
        await sleep(pace);
        const stagingDir = productStagingDir(productId, run.id);
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });
        for (const file of pkg.payload.application) {
          const target = path.join(stagingDir, file.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, file.content, "utf-8");
        }
        commitDirectory(stagingDir, productAppDir(productId));
        await run.done("RESTORE_APP", "SUCCESS", `Aplicación v${backup.version} restaurada desde la bóveda`);

        await run.begin("RESTORE_DATA");
        await sleep(pace);
        await importProductData(productId, backup.payload as Parameters<typeof importProductData>[1]);
        await run.done("RESTORE_DATA", "SUCCESS", "Datos restaurados desde el backup PRE_UPDATE");

        await run.begin("REGISTER");
        await sleep(pace);
        await db.installedProduct.update({
          where: { productId },
          data: { version: backup.version, packageHash: verdict.packageHash },
        });
        await run.done("REGISTER", "SUCCESS", `Registro revertido a v${backup.version}`);

        await run.begin("START");
        await sleep(pace);
        const startRes = await startProductCore(productId);
        if (!startRes.ok) throw new Error(`SERVICE_START_FAILED — ${startRes.error}`);
        await run.done("START", "SUCCESS", `v${backup.version} en ejecución`);

        await run.begin("HEALTH");
        await sleep(pace);
        const health = await runHealthChecks(productId);
        await run.done("HEALTH", health.overall === "FAILED" ? "FAILURE" : "SUCCESS", `Salud: ${health.overall}`);
        if (health.overall === "FAILED") throw new Error("HEALTH_CHECK_FAILED_AFTER_ROLLBACK");

        await run.finish("SUCCESS", { restoredVersion: backup.version });
        await audit({ type: "UPDATE_ROLLED_BACK", productId, detail: { restoredVersion: backup.version, via: "vault" } });
      });
    } catch (e) {
      const message = (e as Error).message;
      for (const s of run.steps) {
        if (s.status === "PENDING") s.status = "SKIPPED";
        if (s.status === "RUNNING") { s.status = "FAILURE"; s.detail = message; }
      }
      await run.finish("FAILURE", undefined, message);
      await audit({ type: "UPDATE_ROLLED_BACK", productId, severity: "ERROR", detail: { error: message } });
    }
  })();
  registerRunPromise(run.id, flow);
  return { runId: run.id };
}
