/**
 * ALBRA API — /api/products/[id]/backup
 * GET  → { backups: BackupDTO[] }
 * POST { note? } → { id } (crea backup MANUAL)
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { createBackup, listBackups } from "@/lib/albra/core/backup";
import { errorResponse, iso, readJson } from "@/lib/albra/api-serialize";
import type { BackupDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);
    const rows = await listBackups(id);

    const backups: BackupDTO[] = rows.map(b => ({
      id: b.id,
      kind: b.kind,
      version: b.version,
      note: b.note ?? null,
      sizeBytes: b.sizeBytes ?? 0,
      createdAt: iso(b.createdAt) ?? "",
    }));

    return NextResponse.json({ backups });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    await requireInstalled(id);
    const body = await readJson<{ note?: unknown }>(req).catch(() => null);
    const note = typeof body?.note === "string" ? body.note.slice(0, 500) : undefined;

    const backup = await createBackup(id, "MANUAL", note);
    return NextResponse.json({ id: backup.id });
  } catch (e) {
    return errorResponse(e);
  }
}
