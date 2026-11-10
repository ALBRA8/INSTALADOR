/**
 * ALBRA API — POST /api/packages/import  (V2 WAVE C)
 * Body: { repo, refType, ref, assetName? }
 * → importPackageFromGithub: resolve → download → checksum del originador →
 *   verifyPackage → contrato → bóveda → { packageId, version, fileName, sha256, origin }.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { importPackageFromGithub } from "@/lib/albra/sources/github";
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

    const result = await importPackageFromGithub(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
