/**
 * ALBRA API — POST /api/products/[id]/update
 * Body: { targetVersion, injectFailure? } → { runId }
 * injectFailure: "MIGRATION" | "START" (simulación de fallos para demo
 * de rollback automático). Corre en background (Run observable).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getInstalled } from "@/lib/albra/core/registry";
import { runUpdate, type InjectFailure } from "@/lib/albra/core/updater";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const body = await readJson<{ targetVersion?: unknown; injectFailure?: unknown }>(req);
    const targetVersion = body?.targetVersion;
    if (!targetVersion || typeof targetVersion !== "string" || targetVersion.trim().length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a non-empty string targetVersion",
        "Indica la versión objetivo (targetVersion).",
      );
    }

    let injectFailure: InjectFailure = null;
    if (body?.injectFailure === "MIGRATION" || body?.injectFailure === "START") {
      injectFailure = body.injectFailure;
    }

    const { runId } = await runUpdate(id, targetVersion.trim(), injectFailure);
    return NextResponse.json({ runId });
  } catch (e) {
    return errorResponse(e);
  }
}
