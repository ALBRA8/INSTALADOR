/**
 * ALBRA API — Contrato de operaciones para la EEC (sin construir la EEC).
 *
 * GET  /api/ops → describeContract() + tokenConfigured (NUNCA el token).
 * POST /api/ops → Authorization: Bearer <ops-token> + EecOpsRequestSchema
 *                 → EecOpsResponse (executeOps despacha a los motores reales).
 *
 * El token vive cifrado en el SecretStore (SecretRecord key='eec.ops.token');
 * el admin lo obtiene/rota una única vez vía POST /api/ops/token {confirm:true}.
 * NO existe GET /api/ops/token por diseño.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { executeOps, describeContract, getOpsToken, hasOpsToken, verifyOpsToken } from "@/lib/albra/core/ops";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureBootstrap();
    const tokenConfigured = await hasOpsToken();
    return NextResponse.json({ ...describeContract(), tokenConfigured });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    // Autenticación Bearer (comparación en tiempo constante; el token se
    // provisiona perezosamente aquí, jamás se expone en la respuesta).
    const header = req.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const expected = await getOpsToken();
    if (!verifyOpsToken(provided, expected)) {
      throw new ApiError(
        401,
        "OPS_UNAUTHORIZED",
        "Missing or invalid Authorization: Bearer <ops-token>",
        "Token de operaciones ausente o inválido.",
      );
    }

    const body = await readJson<unknown>(req);
    if (body === null || typeof body !== "object") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must be a JSON object conforming to EecOpsRequestSchema",
        "El cuerpo debe ser un JSON válido según EecOpsRequestSchema.",
      );
    }

    const response = await executeOps(body, "EEC");
    return NextResponse.json(response);
  } catch (e) {
    return errorResponse(e);
  }
}
