/**
 * ALBRA API — POST /api/install
 * Body: { packageId }                      → { runId }   (bóveda local)
 * Body: { source: { repo, refType, ref, assetName? } } → importPackageFromGithub
 *        primero y luego instala el packageId resultante      (V2 WAVE C).
 * - 403 ENTITLEMENT_REQUIRED si el producto está bloqueado (no adquirido).
 * - 400 si el producto no es instalable / fuente inválida (BRANCH_REF_REJECTED).
 * La instalación corre en background (Run observable vía /api/runs/[id]).
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { runInstall } from "@/lib/albra/core/installer";
import { CATALOG } from "@/lib/albra/products/catalog";
import { importPackageFromGithub } from "@/lib/albra/sources/github";
import { GithubSourceSchema } from "@/lib/albra/contracts/source";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<{ packageId?: unknown; source?: unknown }>(req);

    // ── Instalación desde fuente GitHub (V2 WAVE C): importar → instalar ──
    if (body?.source !== undefined) {
      const parsed = GithubSourceSchema.safeParse(body.source);
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
      const imported = await importPackageFromGithub(parsed.data);
      // La instalación usa la bóveda ya verificada; el origen queda registrado
      // en InstalledProduct (originType/Repo/Ref/Commit) vía runInstall opts.
      const { runId } = await runInstall(imported.packageId, {
        origin: {
          repo: imported.origin.repo,
          refType: imported.origin.refType,
          ref: imported.origin.ref,
          commitSha: imported.origin.commitSha,
        },
      });
      return NextResponse.json({ runId, imported: {
        packageId: imported.packageId,
        version: imported.version,
        fileName: imported.fileName,
        sha256: imported.sha256,
        origin: imported.origin,
      } });
    }

    // ── Instalación clásica desde la bóveda local (comportamiento intacto) ──
    const packageId = body?.packageId;
    if (!packageId || typeof packageId !== "string" || packageId.trim().length === 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a non-empty string packageId",
        "Indica el paquete a instalar (packageId).",
      );
    }

    const entry = CATALOG.find(c => c.productId === packageId);
    if (!entry) {
      throw new ApiError(
        404,
        "PACKAGE_NOT_FOUND",
        `No catalog entry for ${packageId}`,
        "El paquete solicitado no existe en el catálogo.",
      );
    }
    if (entry.locked) {
      throw new ApiError(
        403,
        "ENTITLEMENT_REQUIRED",
        `Product ${packageId} requires ${entry.requiredEntitlement ?? "an entitlement"}`,
        "Producto no adquirido",
      );
    }
    if (!entry.installable) {
      throw new ApiError(
        400,
        "NOT_INSTALLABLE",
        `Product ${packageId} is not installable`,
        "Este producto no está disponible para instalación.",
      );
    }

    const { runId } = await runInstall(packageId);
    return NextResponse.json({ runId });
  } catch (e) {
    return errorResponse(e);
  }
}
