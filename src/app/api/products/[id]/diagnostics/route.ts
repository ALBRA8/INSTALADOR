/**
 * ALBRA API — /api/products/[id]/diagnostics
 * POST → recoge bundle de diagnóstico ahora (COLLECT → CLASSIFY → EXPLAIN
 *        → SUGGEST), persistido y SIN secretos (redaction).
 * GET  → último bundle persistido o 404.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { collectDiagnostics } from "@/lib/albra/core/diagnostics";
import { db } from "@/lib/db";
import { ApiError, errorResponse, iso } from "@/lib/albra/api-serialize";
import type { DiagnosticsDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);
    const bundle = await collectDiagnostics(id);

    const dto: DiagnosticsDTO = {
      productId: bundle.productId,
      collectedAt: bundle.collectedAt,
      summary: bundle.summary,
      system: bundle.system,
      recentLogs: bundle.recentLogs.map(l => ({
        level: l.level,
        message: l.message,
        createdAt: iso(l.createdAt) ?? "",
      })),
      configSummary: bundle.configSummary,
      findings: bundle.findings.map(f => ({
        findingId: f.findingId,
        code: f.code,
        severity: f.severity,
        title: f.title,
        explain: f.explain,
        repairs: f.repairs.map(r => ({
          actionId: r.actionId,
          label: r.label,
          risk: r.risk,
          description: r.description,
        })),
      })),
    };
    return NextResponse.json(dto);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);
    const rec = await db.diagnosticBundleRec.findFirst({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!rec) {
      throw new ApiError(
        404,
        "DIAGNOSTICS_NOT_FOUND",
        `No diagnostic bundle for ${id}`,
        "Aún no hay diagnósticos. Ejecuta un diagnóstico primero.",
      );
    }

    return NextResponse.json({
      bundle: {
        id: rec.id,
        productId: rec.productId,
        summary: rec.summary,
        findings: rec.findings,
        createdAt: iso(rec.createdAt),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
