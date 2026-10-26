/**
 * ALBRA API — POST /api/license/validate
 *
 * Validación OBLIGATORIA de la clave única de acceso del proyecto contra la
 * API externa de licencias. La GUI la llama antes de habilitar el botón
 * INSTALAR; el motor además RE-valida en el paso LICENSE (defensa en profundidad).
 *
 * Body: { accessKey: string, productId: string }
 *   200 { valid: true, keyId, licensee, plan, entitlements, expiresAt }
 *   200 { valid: false, code: KEY_NOT_FOUND|KEY_EXPIRED|KEY_DISABLED|PRODUCT_NOT_AUTHORIZED|… }
 *   503 { valid: false, code: LICENSE_API_UNREACHABLE|… }  (API externa no disponible)
 *   400 VALIDATION_ERROR
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { validateAccessKey } from "@/lib/albra/core/license";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

const EXTERNAL_FAILURE_CODES = new Set(["LICENSE_API_UNREACHABLE", "LICENSE_API_ERROR", "LICENSE_API_MALFORMED"]);

export async function POST(req: Request) {
  try {
    await ensureBootstrap();
    const body = (await readJson<{ accessKey?: unknown; productId?: unknown }>(req)) ?? {};
    const accessKey = typeof body.accessKey === "string" ? body.accessKey : "";
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    if (!accessKey.trim() || !productId) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "accessKey and productId are required",
        "Ingresa la clave única de acceso del proyecto.",
      );
    }

    const verdict = await validateAccessKey({ accessKey, productId });
    if (!verdict.ok) {
      const status = EXTERNAL_FAILURE_CODES.has(verdict.code) ? 503 : 200;
      return NextResponse.json(
        { valid: false, code: verdict.code, userMessage: verdict.userMessage },
        { status },
      );
    }
    return NextResponse.json({
      valid: true,
      keyId: verdict.keyId,
      licensee: verdict.licensee,
      plan: verdict.plan,
      entitlements: verdict.entitlements,
      expiresAt: verdict.expiresAt,
      internal: verdict.internal,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
