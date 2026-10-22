/**
 * ALBRA — Backup Engine (BACKUP → OPERATION → VALIDATION con restore).
 * Los productos declaran qué datos son críticos; aquí se serializan
 * a snapshot JSON persistido (DB + archivo en disco).
 */
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { PATHS, ensureDirs, writeFileAtomic } from "@/lib/albra/env";
import { requireInstalled } from "@/lib/albra/core/registry";
import { exportProductData, importProductData, type ProductDataSnapshot } from "@/lib/albra/products/data";
import { log } from "@/lib/albra/core/logger";
import { audit } from "@/lib/albra/core/audit";

export async function createBackup(productId: string, kind: "PRE_UPDATE" | "MANUAL" | "PRE_UNINSTALL", note?: string): Promise<{ id: string }> {
  const installed = await requireInstalled(productId);
  const snapshot = await exportProductData(productId);
  const json = JSON.stringify({ productId, version: installed.version, createdAt: new Date().toISOString(), snapshot });
  const fileName = `${productId}-${kind.toLowerCase()}-${Date.now()}.json`;
  const filePath = path.join(PATHS.backups, fileName);
  ensureDirs();
  writeFileAtomic(filePath, json);

  // Validación: re-leer y parsear
  const validation = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { snapshot: ProductDataSnapshot };
  if (!validation.snapshot) throw new Error("BACKUP_VALIDATION_FAILED");

  const row = await db.backupRecord.create({
    data: {
      productId,
      kind,
      version: installed.version,
      note,
      sizeBytes: Buffer.byteLength(json, "utf-8"),
      payload: snapshot as object,
      filePath,
    },
  });
  await audit({ type: "BACKUP_CREATED", productId, detail: { kind, sizeBytes: row.sizeBytes, version: row.version } });
  await log({ productId, channel: "SYSTEM", message: `Backup ${kind} creado (${(row.sizeBytes / 1024).toFixed(1)} KB)` });
  return { id: row.id };
}

export async function listBackups(productId: string) {
  return db.backupRecord.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, version: true, note: true, sizeBytes: true, filePath: true, createdAt: true },
  });
}

export async function restoreBackup(backupId: string): Promise<{ ok: boolean; error?: string }> {
  const row = await db.backupRecord.findUnique({ where: { id: backupId } });
  if (!row) return { ok: false, error: "BACKUP_NOT_FOUND" };
  await importProductData(row.productId, row.payload as ProductDataSnapshot);
  await audit({ type: "RESTORE_COMPLETED", productId: row.productId, detail: { backupId, version: row.version } });
  await log({ productId: row.productId, channel: "USER", message: "Datos restaurados desde la copia de seguridad" });
  return { ok: true };
}

export async function latestBackup(productId: string) {
  return db.backupRecord.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
}

export async function deleteBackupsFor(productId: string): Promise<void> {
  await db.backupRecord.deleteMany({ where: { productId } });
}
