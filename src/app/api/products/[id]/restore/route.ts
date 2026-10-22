/**
 * ALBRA API — POST /api/products/[id]/restore
 * Body: { backupId } → { ok } o 400/404.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { restoreBackup } from "@/lib/albra/core/backup";
import { db } from "@/lib/db";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);

    const body = await readJson<{ backupId?: unknown }>(req);
    const backupId = body?.backupId;
    if (!backupId || typeof backupId !== "string" || backupId.trim().length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a non-empty string backupId",
        "Indica el backup a restaurar (backupId).",
      );
    }

    const record = await db.backupRecord.findUnique({ where: { id: backupId } });
    if (!record || record.productId !== id) {
      throw new ApiError(
        404,
        "BACKUP_NOT_FOUND",
        `Backup ${backupId} not found for ${id}`,
        "El backup indicado no existe para este producto.",
      );
    }

    const result = await restoreBackup(backupId);
    if (!result.ok) {
      throw new ApiError(
        400,
        result.error ?? "RESTORE_FAILED",
        `Restore failed: ${result.error ?? "unknown"}`,
        "No se pudo restaurar el backup.",
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
