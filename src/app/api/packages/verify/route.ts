/**
 * ALBRA API — POST /api/packages/verify
 * Body: { fileName } → verificación criptográfica de un paquete de la bóveda.
 *
 * V2 TRUST CHAIN: la respuesta distingue INTEGRIDAD (valid) de AUTENTICIDAD
 * (trustLevel + signerKeyId + reasons):
 *   TRUSTED            → firmado por clave FULL registrada y no revocada
 *   UNTRUSTED_SIGNER   → firma Ed25519 válida pero clave no registrada
 *   DEV_LOCAL          → HMAC local / clave DEV (desarrollo; mostrar advertencia)
 *   NONE               → rechazado (reason/reasons con el código exacto)
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { readPackageFile, verifyPackage } from "@/lib/albra/package/format";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<{ fileName?: unknown }>(req);
    const fileName = body?.fileName;
    if (!fileName || typeof fileName !== "string" || fileName.trim().length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a non-empty string fileName",
        "Indica el nombre del paquete (fileName).",
      );
    }

    const pkg = readPackageFile(fileName);
    if (!pkg) {
      return NextResponse.json({ valid: false, reason: "PACKAGE_FILE_NOT_FOUND", reasons: ["PACKAGE_FILE_NOT_FOUND"], trustLevel: "NONE" });
    }

    const verdict = verifyPackage(pkg);
    if (verdict.valid) {
      return NextResponse.json({
        valid: true,
        trustLevel: verdict.trustLevel,
        reasons: verdict.reasons,
        ...(verdict.signerKeyId ? { signerKeyId: verdict.signerKeyId } : {}),
        packageHash: verdict.packageHash,
        packageId: verdict.packageId,
        version: verdict.version,
      });
    }
    return NextResponse.json({
      valid: false,
      reason: verdict.reason,
      reasons: verdict.reasons,
      trustLevel: verdict.trustLevel,
      ...(verdict.packageId ? { packageId: verdict.packageId } : {}),
      ...(verdict.version ? { version: verdict.version } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
