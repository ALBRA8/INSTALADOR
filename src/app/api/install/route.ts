/**
 * ALBRA API — POST /api/install
 * Body: { packageId } → { runId }
 * - 403 ENTITLEMENT_REQUIRED si el producto está bloqueado (no adquirido).
 * - 400 si el producto no es instalable.
 * La instalación corre en background (Run observable vía /api/runs/[id]).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { runInstall } from "@/lib/albra/core/installer";
import { CATALOG } from "@/lib/albra/products/catalog";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<{ packageId?: unknown }>(req);
    const packageId = body?.packageId;
    if (!packageId || typeof packageId !== "string" || packageId.trim().length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a non-empty string packageId",
        "Indica el paquete a instalar (packageId).",
      );
    }

    const entry = CATALOG.find(c => c.productId === packageId);
    if (!entry) {
      throw new ApiError(
        404,
        "PACKAGE_NOT_FOUND",
        `No catalog entry for ${packageId}`,
        "El paquete solicitado no existe en el catálogo.",
      );
    }
    if (entry.locked) {
      throw new ApiError(
        403,
        "ENTITLEMENT_REQUIRED",
        `Product ${packageId} requires ${entry.requiredEntitlement ?? "an entitlement"}`,
        "Producto no adquirido",
      );
    }
    if (!entry.installable) {
      throw new ApiError(
        400,
        "NOT_INSTALLABLE",
        `Product ${packageId} is not installable`,
        "Este producto no está disponible para instalación.",
      );
    }

    const { runId } = await runInstall(packageId);
    return NextResponse.json({ runId });
  } catch (e) {
    return errorResponse(e);
  }
}
