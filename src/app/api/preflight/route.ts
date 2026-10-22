/**
 * ALBRA API — POST /api/preflight
 * Body: { packageId } → PreflightReportDTO (bloqueos, avisos y
 * resolución automática de puertos antes de instalar).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { preflight } from "@/lib/albra/core/installer";
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
        "Indica el paquete a verificar (packageId).",
      );
    }

    const report = await preflight(packageId);
    return NextResponse.json(report);
  } catch (e) {
    return errorResponse(e);
  }
}
