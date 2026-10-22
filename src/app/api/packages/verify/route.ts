/**
 * ALBRA API — POST /api/packages/verify
 * Body: { fileName } → { valid, reason? }
 * Verificación criptográfica de un paquete de la bóveda.
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
      return NextResponse.json({ valid: false, reason: "PACKAGE_FILE_NOT_FOUND" });
    }

    const verdict = verifyPackage(pkg);
    return NextResponse.json(
      verdict.valid
        ? { valid: true }
        : { valid: false, reason: verdict.reason },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
