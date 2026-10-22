/**
 * ALBRA API — GET /api/packages
 * Bóveda de paquetes .albra: verificación completa (límites de formato →
 * estructura → hash → firma → confianza) de cada paquete. Válidos primero,
 * luego por packageId/version.
 *
 * V2 TRUST CHAIN: además de `verified` (integridad+firma), expone la capa de
 * AUTENTICIDAD: trustLevel (TRUSTED | UNTRUSTED_SIGNER | DEV_LOCAL | NONE),
 * signerKeyId y signatureAlg; y sincroniza esas columnas en PackageArtifact
 * (solo filenames canónicos — el paquete tampered de demo no toca el registro).
 */
import fs from "fs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import { readPackageFile, verifyPackage, type PackageSignature } from "@/lib/albra/package/format";
import { errorResponse } from "@/lib/albra/api-serialize";
import type { PackageDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

function signatureAlgOf(sig: PackageSignature | undefined): string | null {
  if (!sig) return null;
  if ("alg" in sig) return sig.alg;
  if ((sig as { algorithm?: string }).algorithm === "HMAC-SHA256") return "hmac-dev";
  return null;
}

export async function GET() {
  try {
    await ensureBootstrap();
    ensureDirs();

    const fileNames = fs.readdirSync(PATHS.packages).filter(f => f.endsWith(".albra"));

    const packages: PackageDTO[] = [];
    for (const fileName of fileNames) {
      const sizeBytes = fs.statSync(fs.realpathSync(`${PATHS.packages}/${fileName}`)).size;
      const pkg = readPackageFile(fileName);
      if (!pkg) {
        packages.push({
          fileName,
          packageId: fileName.replace(/\.albra$/, ""),
          version: "",
          displayName: "",
          channel: "",
          sizeBytes,
          verified: false,
          verifyReason: "PACKAGE_PARSE_ERROR",
          sha256: "",
          signatureKeyId: "",
          tampered: fileName.includes("tampered"),
          trustLevel: "NONE",
          reasons: ["PACKAGE_PARSE_ERROR"],
          signatureAlg: null,
        });
        continue;
      }
      const verdict = verifyPackage(pkg);
      const sigAlg = signatureAlgOf(pkg.signature);
      const sigKeyId = pkg.signature.keyId ?? "";
      packages.push({
        fileName,
        packageId: pkg.manifest.packageId,
        version: pkg.manifest.version,
        displayName: pkg.manifest.displayName,
        channel: pkg.manifest.channel,
        sizeBytes,
        verified: verdict.valid,
        ...(verdict.valid ? {} : { verifyReason: verdict.reason }),
        sha256: pkg.integrity.packageHash,
        signatureKeyId: sigKeyId,
        tampered: fileName.includes("tampered"),
        // V2: capa de autenticidad (además de la integridad)
        trustLevel: verdict.trustLevel,
        reasons: verdict.reasons,
        signatureAlg: sigAlg,
        ...(verdict.valid && verdict.signerKeyId ? { signerKeyId: verdict.signerKeyId } : {}),
      });

      // Sincroniza la capa de confianza al registro local (PackageArtifact).
      // Solo filenames canónicos: el demo "tampered" comparte packageId/version
      // con el paquete legítimo y NO debe contaminar el registro.
      if (fileName === `${pkg.manifest.packageId}-${pkg.manifest.version}.albra`) {
        try {
          await db.packageArtifact.updateMany({
            where: { packageId: pkg.manifest.packageId, version: pkg.manifest.version },
            data: {
              verified: verdict.valid,
              signatureAlg: sigAlg,
              signerKeyId: verdict.valid && verdict.signerKeyId ? verdict.signerKeyId : sigKeyId || null,
              trustLevel: verdict.trustLevel,
            },
          });
        } catch {
          /* la sincronización de confianza nunca rompe el listado */
        }
      }
    }

    packages.sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return `${a.packageId}-${a.version}`.localeCompare(`${b.packageId}-${b.version}`);
    });

    return NextResponse.json({ packages });
  } catch (e) {
    return errorResponse(e);
  }
}
