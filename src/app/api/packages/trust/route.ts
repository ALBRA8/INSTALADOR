/**
 * ALBRA API — /api/packages/trust  (V2 WAVE C)
 * Aprobación explícita de scripts de instalación de un paquete.
 *   POST { fileName, approve: true, note? } → PlatformState
 *         `trust:scripts:<fileName>` = { policy:"APPROVED", approvedBy:"admin", approvedAt }
 *         (approve:false → revoca: policy "BLOCKED") + audit TRUST_POLICY_CHANGED.
 *   GET  ?fileName=crm-1.0.0.albra → estado actual de aprobación.
 *
 * El instalador consulta ESTE estado (fuente de autoridad en PlatformState);
 * nunca depende de campos mutables dentro del paquete.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { db } from "@/lib/db";
import { readScriptsTrustState, scriptsTrustKey } from "@/lib/albra/sources/github";
import { audit } from "@/lib/albra/core/audit";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

function assertFileName(fileName: unknown): string {
  if (!fileName || typeof fileName !== "string" || fileName.trim().length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "fileName required", "Indica el archivo del paquete (fileName), p. ej. 'crm-1.0.0.albra'.");
  }
  // Solo nombre de archivo plano (defensa path-traversal)
  return fileName.trim().replace(/[/\\]/g, "_");
}

export async function GET(req: Request) {
  try {
    await ensureBootstrap();
    const url = new URL(req.url);
    const fileName = assertFileName(url.searchParams.get("fileName"));
    const state = await readScriptsTrustState(fileName);
    return NextResponse.json(state);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<{ fileName?: unknown; approve?: unknown; note?: unknown }>(req);
    const fileName = assertFileName(body?.fileName);
    if (typeof body?.approve !== "boolean") {
      throw new ApiError(400, "VALIDATION_ERROR", "approve must be a boolean", "Indica approve: true para aprobar o false para revocar.");
    }
    const note = typeof body?.note === "string" ? body.note : undefined;

    const value = body.approve
      ? { policy: "APPROVED", approvedBy: "admin", approvedAt: new Date().toISOString(), fileName, ...(note ? { note } : {}) }
      : { policy: "BLOCKED", approvedBy: "admin", approvedAt: new Date().toISOString(), fileName, ...(note ? { note } : {}) };

    await db.platformState.upsert({
      where: { key: scriptsTrustKey(fileName) },
      create: { key: scriptsTrustKey(fileName), value: value as object },
      update: { value: value as object },
    });

    await audit({
      type: "TRUST_POLICY_CHANGED",
      actor: "admin",
      severity: body.approve ? "WARN" : "INFO",
      detail: { fileName, policy: value.policy, note: note ?? null, key: scriptsTrustKey(fileName) },
    });

    const state = await readScriptsTrustState(fileName);
    return NextResponse.json(state);
  } catch (e) {
    return errorResponse(e);
  }
}
