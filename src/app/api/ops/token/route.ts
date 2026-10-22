/**
 * ALBRA API — Rotación del token de operaciones EEC (operación admin explícita).
 *
 * POST /api/ops/token {confirm:true} → regenera el token, lo persiste cifrado
 * en el SecretStore y lo devuelve UNA SOLA VEZ en la respuesta. Queda auditado
 * como OPS_EXECUTED {operation:"TOKEN_ROTATE", rotated:true} (actor "admin").
 *
 * NO existe GET de este recurso: el token solo se lee del SecretStore.
 * Delimitado (futuro): exigir el token vigente o canal admin/mTLS para rotar.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { rotateOpsToken } from "@/lib/albra/core/ops";
import { audit } from "@/lib/albra/core/audit";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<{ confirm?: unknown }>(req);
    if (body?.confirm !== true) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Rotation must be confirmed with { confirm: true }",
        "Confirma la rotación del token enviando { confirm: true }.",
      );
    }

    const token = await rotateOpsToken();
    await audit({
      type: "OPS_EXECUTED",
      actor: "admin",
      detail: { operation: "TOKEN_ROTATE", rotated: true },
    });

    // Única vez que el token viaja en una respuesta; no volverá a exponerse.
    return NextResponse.json({
      token,
      note: "Guarda este valor ahora: no se volverá a mostrar. Úsalo como 'Authorization: Bearer <token>' en /api/ops.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
