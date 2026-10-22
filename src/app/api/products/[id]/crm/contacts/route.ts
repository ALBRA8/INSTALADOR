/**
 * ALBRA API — /api/products/[id]/crm/contacts  (datos del producto, gated)
 * GET  → contactos (asc). POST { name*, email?, phone?, company?, tags? } → 201.
 * Requiere el servicio en RUNNING (503 SERVICE_STOPPED si está detenido).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { db } from "@/lib/db";
import { ApiError, assertRunning, errorResponse, readJson, toContactDTO } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;
    await assertRunning(id);

    const rows = await db.crmContact.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ contacts: rows.map(toContactDTO) });
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
      email?: unknown;
      phone?: unknown;
      company?: unknown;
      tags?: unknown;
    }>(req);

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Field 'name' is required",
        "El nombre del contacto es obligatorio.",
      );
    }

    const contact = await db.crmContact.create({
      data: {
        name,
        email: typeof body?.email === "string" && body.email.trim().length > 0 ? body.email.trim() : null,
        phone: typeof body?.phone === "string" && body.phone.trim().length > 0 ? body.phone.trim() : null,
        company: typeof body?.company === "string" && body.company.trim().length > 0 ? body.company.trim() : null,
        tags: typeof body?.tags === "string" && body.tags.trim().length > 0 ? body.tags.trim() : null,
      },
    });

    return NextResponse.json({ contact: toContactDTO(contact) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
