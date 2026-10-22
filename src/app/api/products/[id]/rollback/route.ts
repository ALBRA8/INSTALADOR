/**
 * ALBRA API — POST /api/products/[id]/rollback
 * Revierte a la versión anterior (paquete de la bóveda + backup PRE_UPDATE).
 * → { runId }
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getInstalled } from "@/lib/albra/core/registry";
import { rollbackLastUpdate } from "@/lib/albra/core/updater";
import { ApiError, errorResponse } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const installed = await getInstalled(id);
    if (!installed) {
      throw new ApiError(
        404,
        "PRODUCT_NOT_INSTALLED",
        `Product ${id} not installed`,
        "Este producto no está instalado.",
      );
    }

    const { runId } = await rollbackLastUpdate(id);
    return NextResponse.json({ runId });
  } catch (e) {
    return errorResponse(e);
  }
}
