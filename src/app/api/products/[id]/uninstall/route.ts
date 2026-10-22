/**
 * ALBRA API — POST /api/products/[id]/uninstall
 * Body: { dataMode: "KEEP" | "EXPORT" | "DELETE" } → { runId }
 * Corre en background (Run observable). BACKUP de seguridad automático.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getInstalled } from "@/lib/albra/core/registry";
import { runUninstall } from "@/lib/albra/core/uninstaller";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";
import type { DataMode } from "@/lib/albra/contracts";

export const dynamic = "force-dynamic";

const DATA_MODES: DataMode[] = ["KEEP", "EXPORT", "DELETE"];

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

    const body = await readJson<{ dataMode?: unknown }>(req);
    const dataMode = body?.dataMode;
    if (typeof dataMode !== "string" || !DATA_MODES.includes(dataMode as DataMode)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "dataMode must be KEEP | EXPORT | DELETE",
        "Modo de datos inválido. Usa KEEP, EXPORT o DELETE.",
      );
    }

    const result = await runUninstall(id, dataMode as DataMode);
    return NextResponse.json({
      runId: result.runId,
      ...(result.exportPath ? { exportPath: result.exportPath } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
