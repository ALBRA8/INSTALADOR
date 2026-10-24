/**
 * ALBRA API — POST /api/packages/import  (V2 WAVE C)
 * Body: { repo, refType, ref, assetName?, accessKey }
 * V3 PUERTA DE ACCESO: accessKey OBLIGATORIA — se valida vía la API externa
 * de licenciamiento ANTES de descargar el asset (fail-closed).
 * → importPackageFromGithub: resolve → download → checksum del originador →
 *   verifyPackage → contrato → bóveda → { packageId, version, fileName, sha256, origin }.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { importPackageFromGithub } from "@/lib/albra/sources/github";
import { validateProjectAccessKey } from "@/lib/albra/core/access-key";
import { GithubSourceSchema } from "@/lib/albra/contracts/source";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object") {
      throw new ApiError(400, "VALIDATION_ERROR", "Body must be a JSON object", "Envía un objeto JSON con repo, refType y ref.");
    }
    // V3 PUERTA DE ACCESO: sin clave validada no hay descarga.
    const accessKey = typeof body.accessKey === "string" ? body.accessKey : "";
    if (!accessKey.trim()) {
      throw new ApiError(
        403,
        "ACCESS_KEY_REQUIRED",
        "ACCESS_KEY_REQUIRED",
        "Se requiere la clave única de acceso del proyecto antes de descargar paquetes.",
      );
    }
    const parsed = GithubSourceSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const isBranch = first?.message.startsWith("BRANCH_REF_REJECTED");
      throw new ApiError(
        400,
        isBranch ? "BRANCH_REF_REJECTED" : "VALIDATION_ERROR",
        first ? `${first.path.join(".")}: ${first.message}` : "Invalid source",
        first?.message ?? "Fuente inválida.",
      );
    }
    // Validación vía API externa ANTES de descargar (identidad conocida: repo).
    const access = await validateProjectAccessKey({
      packageId: parsed.data.repo.split("/").pop() ?? "github-source",
      accessKey,
    });
    if (!access.ok) {
      throw new ApiError(403, access.code, `${access.code} (endpoint ${access.endpoint})`, access.userMessage);
    }

    const result = await importPackageFromGithub(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
