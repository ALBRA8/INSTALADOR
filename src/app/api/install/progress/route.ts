/**
 * ALBRA API — GET /api/install/progress?runId=…
 *
 * Progreso de una instalación POR MÓDULO: devuelve el run (pasos) y una fila
 * por proyecto/dependencia/runtime/fuente para que la GUI pinte una barra de
 * progreso INDEPENDIENTE por cada elemento que se está instalando.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getRun } from "@/lib/albra/core/runs";
import { listInstallModules } from "@/lib/albra/core/progress";
import { ApiError, errorResponse, toRunDTO } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureBootstrap();
    const runId = new URL(req.url).searchParams.get("runId");
    if (!runId) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "runId is required",
        "Falta el identificador del run (runId).",
      );
    }
    const row = await getRun(runId);
    if (!row) {
      throw new ApiError(404, "RUN_NOT_FOUND", `Run ${runId} not found`, "La operación solicitada no existe.");
    }
    const modules = await listInstallModules(runId);
    const run = toRunDTO(row);
    const overall = modules.find(m => m.moduleType === "PROJECT")?.percent ?? 0;
    return NextResponse.json({
      run,
      overall,
      modules: modules.map(m => ({
        moduleKey: m.moduleKey,
        moduleType: m.moduleType,
        label: m.label,
        status: m.status,
        percent: m.percent,
        detail: m.detail,
        order: m.order,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
