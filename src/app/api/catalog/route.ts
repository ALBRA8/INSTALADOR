/**
 * ALBRA API — GET /api/catalog
 * Catálogo del Launcher: estado de instalación, salud, puerto,
 * actualizaciones disponibles, lock de operaciones y certificación.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { CATALOG, getLatestVersion } from "@/lib/albra/products/catalog";
import { listInstalled, isLocked } from "@/lib/albra/core/registry";
import { db } from "@/lib/db";
import { errorResponse, semverGt } from "@/lib/albra/api-serialize";
import type { CatalogItem, LifecycleStateDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureBootstrap();

    const installedList = await listInstalled();
    const installedMap = new Map(installedList.map(p => [p.productId, p]));

    const products: CatalogItem[] = [];
    for (const entry of CATALOG) {
      const inst = installedMap.get(entry.productId) ?? null;
      const certRow = await db.platformState.findUnique({
        where: { key: `certification:${entry.productId}` },
      });
      const cert = (certRow?.value ?? null) as { passed?: boolean } | null;
      // Última versión con paquete en la bóveda; fallback a la del catálogo
      // (productos bloqueados sin paquete declaran su versión de referencia).
      const latestVersion = getLatestVersion(entry.productId) ?? entry.latestVersion;

      products.push({
        productId: entry.productId,
        displayName: entry.displayName,
        description: entry.description,
        icon: entry.icon,
        category: entry.category,
        state: (inst?.state ?? "AVAILABLE") as LifecycleStateDTO,
        health: (inst?.health ?? "UNKNOWN") as CatalogItem["health"],
        installedVersion: inst?.version ?? null,
        latestVersion,
        updateAvailable: Boolean(inst && latestVersion && semverGt(latestVersion, inst.version)),
        locked: entry.locked,
        requiredEntitlement: entry.requiredEntitlement ?? null,
        port: inst?.port ?? null,
        busy: inst ? isLocked(entry.productId) : false,
        certified: Boolean(cert?.passed),
      });
    }

    return NextResponse.json({ products });
  } catch (e) {
    return errorResponse(e);
  }
}
