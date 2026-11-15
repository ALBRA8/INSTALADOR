/**
 * ALBRA API — GET /api/runs?productId&limit
 * Lista de runs de ciclo de vida (observabilidad de operaciones).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { verifyRunAccess } from "@/lib/albra/core/ops";
import { listRuns } from "@/lib/albra/core/runs";
import { ApiError, clampInt, errorResponse, toRunDTO } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureBootstrap();
    if (!(await verifyRunAccess(req))) {
      throw new ApiError(401, "OPS_UNAUTHORIZED", "Missing or invalid operations token", "Token de operaciones ausente o inválido (o acceso remoto sin credencial).");
    }

    const url = new URL(req.url);
    const productId = url.searchParams.get("productId") ?? undefined;
    const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);

    const rows = await listRuns(productId ?? undefined, limit);
    return NextResponse.json({ runs: rows.map(toRunDTO) });
  } catch (e) {
    return errorResponse(e);
  }
}
