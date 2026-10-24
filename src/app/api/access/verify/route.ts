/**
 * ALBRA — SERVICIO DE LICENCIAMIENTO (API de verificación de acceso).
 * POST /api/access/verify
 *
 * Este endpoint representa la API EXTERNA de licenciamiento de este
 * despliegue. El instalador la consume vía HTTP (ver core/access-key.ts) y
 * en producción puede sustituirse configurando ALBRA_ACCESS_API_URL hacia
 * el licenciante real: el contrato (contracts/access.ts) es idéntico.
 *
 * Reglas de veredicto (fail-closed):
 *  - Formato ALBRA-XXXX-XXXX-XXXX
 *  - Clave existente en el registro de claves emitidas
 *  - No revocada, no expirada y vinculada al producto solicitado ("*" = universal)
 * La respuesta SIEMPRE es 200 con { valid: boolean, ... }.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { readIssuedKeys } from "@/lib/albra/core/access-key";
import { AccessKeyVerifyRequestSchema } from "@/lib/albra/contracts/access";
import { errorResponse } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ valid: false, code: "FORMAT_INVALID", reason: "Body no es JSON válido" });
    }

    const parsed = AccessKeyVerifyRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        valid: false,
        code: "FORMAT_INVALID",
        reason: "Solicitud fuera de contrato (clave o packageId inválidos)",
      });
    }

    const { accessKey, packageId } = parsed.data;
    const entry = readIssuedKeys().keys.find(k => k.key === accessKey);
    if (!entry) {
      return NextResponse.json({ valid: false, code: "ACCESS_KEY_UNKNOWN", reason: "Clave no registrada en el registro de licencias" });
    }
    if (entry.revoked) {
      return NextResponse.json({ valid: false, code: "ACCESS_KEY_REVOKED", reason: "Clave revocada por el licenciante" });
    }
    if (entry.expiresAt && Date.parse(entry.expiresAt) < Date.now()) {
      return NextResponse.json({ valid: false, code: "ACCESS_KEY_EXPIRED", reason: `Clave expirada en ${entry.expiresAt}` });
    }
    if (entry.packageId !== "*" && entry.packageId !== packageId) {
      return NextResponse.json({
        valid: false,
        code: "ACCESS_KEY_PRODUCT_MISMATCH",
        reason: `La clave está vinculada al proyecto '${entry.packageId}', no a '${packageId}'`,
      });
    }

    return NextResponse.json({
      valid: true,
      plan: entry.plan,
      licensee: entry.licensee,
      issuedAt: entry.issuedAt,
      expiresAt: entry.expiresAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
