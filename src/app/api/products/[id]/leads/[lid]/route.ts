/**
 * ALBRA API — /api/products/[id]/leads/[lid]  (gated)
 * PATCH { status } → { lead } · DELETE → { ok }
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; lid: string }> },
) {
  try {
    await ensureBootstrap();
    const { id, lid } = await params;
    await assertRunning(id);

    const existing = await db.leadRecord.findUnique({ where: { id: lid } });
    if (!existing) {
      throw new ApiError(404, "LEAD_NOT_FOUND", `Lead ${lid} not found`, "El lead indicado no existe.");
    }

    const body = await readJson<{ status?: unknown }>(req);
    if (!isLeadStatus(body?.status)) {
      throw new ApiError(
        400,
        "STATUS_INVALID",
        "Field 'status' must be one of NUEVO | CALIFICADO | CONTACTADO | DESCARTADO",
        "Estado inválido. Usa NUEVO, CALIFICADO, CONTACTADO o DESCARTADO.",
      );
    }

    const lead = await db.leadRecord.update({ where: { id: lid }, data: { status: body.status } });
    return NextResponse.json({ lead: toLeadDTO(lead) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; lid: string }> },
) {
  try {
    await ensureBootstrap();
    const { id, lid } = await params;
    await assertRunning(id);

    const existing = await db.leadRecord.findUnique({ where: { id: lid } });
    if (!existing) {
      throw new ApiError(404, "LEAD_NOT_FOUND", `Lead ${lid} not found`, "El lead indicado no existe.");
    }

    await db.leadRecord.delete({ where: { id: lid } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
