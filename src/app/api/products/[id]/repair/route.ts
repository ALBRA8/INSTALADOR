/**
 * ALBRA API — POST /api/products/[id]/repair
 * Body: { actionId, confirmed? }
 * LOW → automáticas; MEDIUM/HIGH requieren confirmed=true
 * (REPAIR_REQUIRES_CONFIRMATION → 400). Resultado verificado contra el
 * estado real del run para no reportar éxito falso.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { executeRepair } from "@/lib/albra/core/repair";
import { getRun } from "@/lib/albra/core/runs";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const body = await readJson<{ actionId?: unknown; confirmed?: unknown }>(req);
    const actionId = body?.actionId;
    if (!actionId || typeof actionId !== "string" || actionId.trim().length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a non-empty string actionId",
        "Indica la acción de reparación (actionId).",
      );
    }

    await requireInstalled(id);

    const result = await executeRepair(id, actionId, body?.confirmed === true);

    if (!result.ok && result.message === "REPAIR_REQUIRES_CONFIRMATION") {
      throw new ApiError(
        400,
        "REPAIR_REQUIRES_CONFIRMATION",
        result.message,
        "Esta reparación requiere confirmación explícita",
      );
    }

    // El repair engine reporta ok genérico; contrastamos con el run real.
    if (result.runId) {
      const run = await getRun(result.runId);
      if (run && run.status === "FAILURE") {
        return NextResponse.json({
          ok: false,
          actionId: result.actionId,
          message: run.error ?? "REPAIR_FAILED",
          runId: result.runId,
        });
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
