/**
 * ALBRA API — GET /api/audit?limit
 * Trail de auditoría (eventos de seguridad y ciclo de vida), descendente.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { db } from "@/lib/db";
import { clampInt, errorResponse, iso } from "@/lib/albra/api-serialize";
import type { AuditDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureBootstrap();

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);

    const rows = await db.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const events: AuditDTO[] = rows.map(r => ({
      id: r.id,
      type: r.type,
      productId: r.productId,
      actor: r.actor,
      severity: r.severity as AuditDTO["severity"],
      detail: r.detail ?? null,
      createdAt: iso(r.createdAt) ?? "",
    }));

    return NextResponse.json({ events });
  } catch (e) {
    return errorResponse(e);
  }
}
