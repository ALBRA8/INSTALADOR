/**
 * ALBRA API — /api/products/[id]/crm/deals/[did]  (gated)
 * PATCH { stage } → { deal } · DELETE → { ok }
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  try {
    await ensureBootstrap();
    const { id, did } = await params;
    await assertRunning(id);

    const existing = await db.crmDeal.findUnique({ where: { id: did } });
    if (!existing) {
      throw new ApiError(404, "DEAL_NOT_FOUND", `Deal ${did} not found`, "La oportunidad indicada no existe.");
    }

    const body = await readJson<{ stage?: unknown }>(req);
    if (!isDealStage(body?.stage)) {
      throw new ApiError(
        400,
        "STAGE_INVALID",
        "Field 'stage' must be one of NUEVO | CONTACTADO | PROPUESTA | GANADO | PERDIDO",
        "Etapa inválida. Usa NUEVO, CONTACTADO, PROPUESTA, GANADO o PERDIDO.",
      );
    }

    const deal = await db.crmDeal.update({ where: { id: did }, data: { stage: body.stage } });
    return NextResponse.json({ deal: toDealDTO(deal) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  try {
    await ensureBootstrap();
    const { id, did } = await params;
    await assertRunning(id);

    const existing = await db.crmDeal.findUnique({ where: { id: did } });
    if (!existing) {
      throw new ApiError(404, "DEAL_NOT_FOUND", `Deal ${did} not found`, "La oportunidad indicada no existe.");
    }

    await db.crmDeal.delete({ where: { id: did } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
