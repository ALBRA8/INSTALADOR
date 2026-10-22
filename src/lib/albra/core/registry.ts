/**
 * ALBRA — Registry (LAYER 5): registro local de productos instalados.
 */
import { db } from "@/lib/db";
import type { InstalledProduct } from "@prisma/client";

export async function getInstalled(productId: string): Promise<InstalledProduct | null> {
  return db.installedProduct.findUnique({ where: { productId } });
}

export async function requireInstalled(productId: string): Promise<InstalledProduct> {
  const p = await getInstalled(productId);
  if (!p) throw new Error("PRODUCT_NOT_INSTALLED");
  return p;
}

export async function listInstalled(): Promise<InstalledProduct[]> {
  return db.installedProduct.findMany({ orderBy: { createdAt: "asc" } });
}

export async function setState(productId: string, state: string): Promise<void> {
  await db.installedProduct.update({ where: { productId }, data: { state } });
}

/**
 * ALBRA — Lock de operaciones: una operación de ciclo de vida a la vez
 * por producto (evita instalaciones/actualizaciones concurrentes).
 */
const locks = new Set<string>();

export function isLocked(productId: string): boolean {
  return locks.has(productId);
}

export async function withLock<T>(productId: string, fn: () => Promise<T>): Promise<T> {
  if (locks.has(productId)) throw new Error("PRODUCT_BUSY");
  locks.add(productId);
  try {
    return await fn();
  } finally {
    locks.delete(productId);
  }
}
