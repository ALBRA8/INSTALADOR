/**
 * ALBRA API — GET /api/runs/[id]
 * Detalle de un run (pasos con estado y timestamps) para polling en vivo.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getRun } from "@/lib/albra/core/runs";
import { ApiError, errorResponse, toRunDTO } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const row = await getRun(id);
    if (!row) {
      throw new ApiError(
        404,
        "RUN_NOT_FOUND",
        `Run ${id} not found`,
        "La operación solicitada no existe.",
      );
    }
    return NextResponse.json(toRunDTO(row));
  } catch (e) {
    return errorResponse(e);
  }
}
