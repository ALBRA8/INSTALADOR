/**
 * ALBRA API — POST /api/sources/resolve  (V2 WAVE C)
 * Body: { repo, refType, ref, assetName? } → resolución DRY-RUN (sin descarga):
 * devuelve el origen fijado (tag + commitSha + asset) y, si el body del
 * release declara el manifiesto del originador (albra-sha256/albra-package),
 * su verificación. Errores canónicos: SOURCE_NOT_FOUND (404),
 * BRANCH_REF_REJECTED (400), GITHUB_RATE_LIMITED (429), GITHUB_UNREACHABLE (502).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { resolveGithubSource } from "@/lib/albra/sources/github";
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

    const resolved = await resolveGithubSource(parsed.data);

    // Verificación del manifiesto del originador (si el release lo declara)
    const shaMatch = resolved.releaseBody?.match(/^albra-sha256:\s*([0-9a-f]{64})$/im)?.[1];
    const pkgMatch = resolved.releaseBody?.match(/^albra-package:\s*([A-Za-z0-9._-]+)-(\d+\.\d+\.\d+)$/im);
    const originManifest = {
      declaredSha256: shaMatch ?? null,
      declaredPackageId: pkgMatch?.[1] ?? null,
      declaredVersion: pkgMatch?.[2] ?? null,
    };

    return NextResponse.json({
      source: {
        repo: resolved.repo,
        refType: resolved.refType,
        ref: resolved.ref,
        ...(resolved.tag ? { tag: resolved.tag } : {}),
        commitSha: resolved.commitSha,
        ...(resolved.asset ? { asset: resolved.asset } : {}),
      },
      originManifest,
      pinned: resolved.refType === "commit" || Boolean(resolved.commitSha),
      note: "Dry-run: no se descargó ningún asset. POST /api/packages/import para importar a la bóveda.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
