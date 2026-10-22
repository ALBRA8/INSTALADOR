/**
 * ALBRA API — /api/products/[id]/crm/deals  (datos del producto, gated)
 * GET → oportunidades (asc). POST { title*, contactId?, value?, stage? } → 201.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { db } from "@/lib/db";
import {
  ApiError,
  assertRunning,
  errorResponse,
  isDealStage,
  readJson,
  toDealDTO,
} from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;
    await assertRunning(id);

    const rows = await db.crmDeal.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ deals: rows.map(toDealDTO) });
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
      title?: unknown;
      contactId?: unknown;
      value?: unknown;
      stage?: unknown;
    }>(req);

    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (title.length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Field 'title' is required",
        "El título de la oportunidad es obligatorio.",
      );
    }

    const stage = body?.stage === undefined || body?.stage === null ? "NUEVO" : body.stage;
    if (!isDealStage(stage)) {
      throw new ApiError(
        400,
        "STAGE_INVALID",
        `Invalid stage: ${String(stage)}`,
        "Etapa inválida. Usa NUEVO, CONTACTADO, PROPUESTA, GANADO o PERDIDO.",
      );
    }

    const value = body?.value === undefined || body?.value === null ? 0 : Number(body.value);
    if (!Number.isFinite(value)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Field 'value' must be a number",
        "El valor debe ser un número.",
      );
    }

    const deal = await db.crmDeal.create({
      data: {
        title,
        contactId: typeof body?.contactId === "string" && body.contactId.trim().length > 0 ? body.contactId.trim() : null,
        value,
        stage,
      },
    });

    return NextResponse.json({ deal: toDealDTO(deal) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
