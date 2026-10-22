/**
 * ALBRA — Migraciones de datos por producto (Update Contract).
 * Cada migración es idempotente y declarada en el contrato del paquete.
 */
import { db } from "@/lib/db";
import { setProductMeta } from "@/lib/albra/products/data";

export async function executeMigration(migrationId: string, productId: string): Promise<{ applied: boolean; description: string }> {
  if (migrationId === "crm-2-tags") {
    // ADD_COLUMN tags (columna ya presente en esquema) + BACKFILL vacío + ENABLE_FEATURE
    await db.crmContact.updateMany({ where: { tags: null }, data: { tags: "" } });
    const current = await db.configRecord.findUnique({ where: { productId_scope: { productId, scope: "PRODUCT" } } });
    const values = { ...((current?.values ?? {}) as Record<string, unknown>), schemaVersion: 2, tagsEnabled: true };
    await db.configRecord.upsert({
      where: { productId_scope: { productId, scope: "PRODUCT" } },
      create: { productId, scope: "PRODUCT", values },
      update: { values },
    });
    return { applied: true, description: "Etiquetas de contactos habilitadas y datos retrocompatibles" };
  }
  return { applied: false, description: `Migración desconocida: ${migrationId}` };
}
