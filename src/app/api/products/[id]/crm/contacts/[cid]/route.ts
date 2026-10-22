/**
 * ALBRA API — /api/products/[id]/crm/contacts/[cid]  (gated)
 * PATCH { tags } → { contact } · DELETE → { ok }
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { db } from "@/lib/db";
import { ApiError, assertRunning, errorResponse, readJson, toContactDTO } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    await ensureBootstrap();
    const { id, cid } = await params;
    await assertRunning(id);

    const existing = await db.crmContact.findUnique({ where: { id: cid } });
    if (!existing) {
      throw new ApiError(404, "CONTACT_NOT_FOUND", `Contact ${cid} not found`, "El contacto indicado no existe.");
    }

    const body = await readJson<{ tags?: unknown }>(req);
    const tags = typeof body?.tags === "string" && body.tags.trim().length > 0 ? body.tags.trim() : null;

    const contact = await db.crmContact.update({ where: { id: cid }, data: { tags } });
    return NextResponse.json({ contact: toContactDTO(contact) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    await ensureBootstrap();
    const { id, cid } = await params;
    await assertRunning(id);

    const existing = await db.crmContact.findUnique({ where: { id: cid } });
    if (!existing) {
      throw new ApiError(404, "CONTACT_NOT_FOUND", `Contact ${cid} not found`, "El contacto indicado no existe.");
    }

    await db.crmContact.delete({ where: { id: cid } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
