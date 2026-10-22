/**
 * ALBRA API — GET /api/packages
 * Bóveda de paquetes .albra: verificación completa (estructura → hash →
 * firma) de cada paquete. Válidos primero, luego por packageId/version.
 */
import fs from "fs";
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import { readPackageFile, verifyPackage } from "@/lib/albra/package/format";
import { errorResponse } from "@/lib/albra/api-serialize";
import type { PackageDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureBootstrap();
    ensureDirs();

    const fileNames = fs.readdirSync(PATHS.packages).filter(f => f.endsWith(".albra"));

    const packages: PackageDTO[] = fileNames.map(fileName => {
      const sizeBytes = fs.statSync(fs.realpathSync(`${PATHS.packages}/${fileName}`)).size;
      const pkg = readPackageFile(fileName);
      if (!pkg) {
        return {
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
        };
      }
      const verdict = verifyPackage(pkg);
      return {
        fileName,
        packageId: pkg.manifest.packageId,
        version: pkg.manifest.version,
        displayName: pkg.manifest.displayName,
        channel: pkg.manifest.channel,
        sizeBytes,
        verified: verdict.valid,
        ...(verdict.valid ? {} : { verifyReason: verdict.reason }),
        sha256: pkg.integrity.packageHash,
        signatureKeyId: pkg.signature.keyId,
        tampered: fileName.includes("tampered"),
      };
    });

    packages.sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return `${a.packageId}-${a.version}`.localeCompare(`${b.packageId}-${b.version}`);
    });

    return NextResponse.json({ packages });
  } catch (e) {
    return errorResponse(e);
  }
}
