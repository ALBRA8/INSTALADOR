/**
 * ALBRA API — GET /api/products/[id]/logs?level&limit
 * Logs estructurados del producto (desc). level opcional: debug|info|warn|error.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { db } from "@/lib/db";
import { clampInt, errorResponse, iso } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);

    const url = new URL(req.url);
    const level = url.searchParams.get("level");
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);

    const rows = await db.logEntry.findMany({
      where: {
        productId: id,
        ...(level ? { level } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      logs: rows.map(r => ({
        id: r.id,
        level: r.level,
        channel: r.channel,
        productId: r.productId,
        message: r.message,
        data: r.data ?? null,
        createdAt: iso(r.createdAt) ?? "",
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
