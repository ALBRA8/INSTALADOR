/**
 * ALBRA API — /api/products/[id]/health
 * GET  → último snapshot de salud (404 si nunca se ejecutó).
 * POST → ejecuta los checks del Health Contract ahora mismo.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { latestHealth, runHealthChecks } from "@/lib/albra/core/health";
import { ApiError, asArray, errorResponse, iso } from "@/lib/albra/api-serialize";
import type { HealthCheckDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);
    const snapshot = await latestHealth(id);
    if (!snapshot) {
      throw new ApiError(
        404,
        "HEALTH_NOT_FOUND",
        `No health snapshot for ${id}`,
        "Aún no hay verificaciones de salud. Ejecuta una comprobación.",
      );
    }

    const checks = asArray<HealthCheckDTO>(snapshot.checks).map(c => ({
      ...c,
      ...(c.detail !== undefined ? { detail: c.detail } : {}),
      critical: Boolean(c.critical),
    }));

    return NextResponse.json({
      overall: snapshot.overall,
      checks,
      createdAt: iso(snapshot.createdAt),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);
    const result = await runHealthChecks(id);
    return NextResponse.json({ overall: result.overall, checks: result.checks });
  } catch (e) {
    return errorResponse(e);
  }
}
