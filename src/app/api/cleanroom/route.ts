/**
 * ALBRA API — POST /api/cleanroom
 * Reset a máquina limpia: elimina instalaciones, datos de producto,
 * configuración y secretos; conserva la bóveda y la auditoría.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { resetCleanRoom } from "@/lib/albra/core/cleanroom";
import { errorResponse } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ensureBootstrap();
    const result = await resetCleanRoom();
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
