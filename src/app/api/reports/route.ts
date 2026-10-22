/**
 * ALBRA API — GET /api/reports
 * Módulo de documentación: los 10 reportes oficiales de la plataforma.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { REPORTS } from "@/lib/albra/reports-content";
import { errorResponse } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureBootstrap();
    return NextResponse.json({ reports: REPORTS });
  } catch (e) {
    return errorResponse(e);
  }
}
