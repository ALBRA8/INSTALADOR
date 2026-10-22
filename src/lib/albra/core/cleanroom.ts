/**
 * ALBRA — Clean-room (WAVE 9): devuelve la plataforma a una "máquina limpia".
 * Borra instalaciones, datos de producto, configuraciones y secretos de
 * producto; conserva la bóveda de paquetes firmados y la auditoría.
 */
import fs from "fs";
import { db } from "@/lib/db";
import { PATHS } from "@/lib/albra/env";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";

export async function resetCleanRoom(): Promise<{ ok: true; removed: Record<string, number> }> {
  // Detener y desregistrar productos
  const products = await db.installedProduct.findMany();
  for (const p of products) {
    await db.installedProduct.delete({ where: { productId: p.productId } });
  }
  // Datos de productos (tablas compartidas por aislamiento de nombres)
  await db.crmDeal.deleteMany({});
  await db.crmContact.deleteMany({});
  await db.leadRecord.deleteMany({});
  // Configuración, secretos, providers, health, diagnósticos, backups, runs de producto
  const removed = {
    products: products.length,
    configs: (await db.configRecord.deleteMany({})).count,
    secrets: (await db.secretRecord.deleteMany({ where: { productId: { not: null } } })).count,
    providers: (await db.providerRecord.deleteMany({})).count,
    health: (await db.healthSnapshot.deleteMany({})).count,
    diagnostics: (await db.diagnosticBundleRec.deleteMany({})).count,
    backups: (await db.backupRecord.deleteMany({})).count,
    runs: (await db.lifecycleRun.deleteMany({})).count,
  };
  // Filesystem: directorios de productos, backups y descargas
  for (const dir of [PATHS.products, PATHS.backups, PATHS.downloads]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  await audit({ type: "CLEANROOM_RESET", severity: "WARN", detail: removed });
  await log({ channel: "AUDIT", level: "warn", message: "Entorno clean-room restaurado", data: removed });
  return { ok: true, removed };
}
