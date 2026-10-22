/**
 * ALBRA API — /api/products/[id]/leads  (datos del producto, gated)
 * GET → leads (asc). POST { name*, company?, source?, status?, score? } → 201.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { db } from "@/lib/db";
import {
  ApiError,
  assertRunning,
  errorResponse,
  isLeadStatus,
  readJson,
  toLeadDTO,
} from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;
    await assertRunning(id);

    const rows = await db.leadRecord.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ leads: rows.map(toLeadDTO) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;
    await assertRunning(id);

    const body = await readJson<{
      name?: unknown;
      company?: unknown;
      source?: unknown;
      status?: unknown;
      score?: unknown;
    }>(req);

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Field 'name' is required",
        "El nombre del lead es obligatorio.",
      );
    }

    const status = body?.status === undefined || body?.status === null ? "NUEVO" : body.status;
    if (!isLeadStatus(status)) {
      throw new ApiError(
        400,
        "STATUS_INVALID",
        `Invalid status: ${String(status)}`,
        "Estado inválido. Usa NUEVO, CALIFICADO, CONTACTADO o DESCARTADO.",
      );
    }

    const score = body?.score === undefined || body?.score === null ? 0 : Number(body.score);
    if (!Number.isFinite(score)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Field 'score' must be a number",
        "La puntuación (score) debe ser un número.",
      );
    }

    const lead = await db.leadRecord.create({
      data: {
        name,
        company: typeof body?.company === "string" && body.company.trim().length > 0 ? body.company.trim() : null,
        source: typeof body?.source === "string" && body.source.trim().length > 0 ? body.source.trim() : "WEB",
        status,
        score: Math.round(score),
      },
    });

    return NextResponse.json({ lead: toLeadDTO(lead) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
