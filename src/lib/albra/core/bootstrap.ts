/**
 * ALBRA — Bootstrap idempotente de la plataforma:
 * - Directorios + claves maestras
 - Bóveda de paquetes firmados (CRM 1.0.0/1.1.0, LEADS 1.0.0)
 * - Paquete "tampered" de demostración de seguridad (firma inválida)
 * - Estado de plataforma
 */
import fs from "fs";
import { db } from "@/lib/db";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import { getMasterKeyHex } from "@/lib/albra/core/package-keys";
import { PACKAGE_BUILDS, fileEntries } from "@/lib/albra/products/catalog";
import {
  buildPackage, writePackageFile, packageFilePath, verifyPackage, type AlbraPackage,
} from "@/lib/albra/package/format";
import { getDeploymentAdapter } from "@/lib/albra/adapters";
import { getLatestVersion } from "@/lib/albra/products/catalog";
import { reconcileAll } from "@/lib/albra/core/process-runtime";

let bootstrapPromise: Promise<void> | null = null;

async function doBootstrap(): Promise<void> {
  ensureDirs();
  getMasterKeyHex(); // genera claves si no existen

  // Bóveda de paquetes
  for (const build of PACKAGE_BUILDS) {
    const fileName = `${build.packageId}-${build.version}.albra`;
    const fp = packageFilePath(fileName);
    if (!fs.existsSync(fp)) {
      const pkg = buildPackage({
        manifest: {
          packageId: build.packageId,
          version: build.version,
          channel: "stable",
          displayName: build.displayName,
          createdAt: new Date().toISOString(),
          metadata: { vendor: "ALBRA", category: build.contract.identity.category },
        },
        contract: build.contract,
        payload: {
          application: fileEntries(build.payload.application),
          seeds: build.payload.seeds,
          migrations: build.payload.migrations,
          deployment: { adapter: "windows-local", installStrategy: "transactional-stage-commit" },
        },
      });
      writePackageFile(pkg);
    }
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as AlbraPackage;
    const verdict = verifyPackage(raw);
    await db.packageArtifact.upsert({
      where: { packageId_version: { packageId: build.packageId, version: build.version } },
      create: {
        packageId: build.packageId,
        version: build.version,
        channel: "stable",
        fileName,
        sha256: raw.integrity.packageHash,
        signature: raw.signature.value,
        verified: verdict.valid,
        manifest: raw.manifest as object,
      },
      update: {
        sha256: raw.integrity.packageHash,
        signature: raw.signature.value,
        verified: verdict.valid,
      },
    });
  }

  // Paquete tampered (demo de seguridad: firma inválida → RECHAZADO)
  const tamperedName = "crm-1.0.0-tampered.albra";
  const tamperedFp = packageFilePath(tamperedName);
  if (!fs.existsSync(tamperedFp)) {
    const original = JSON.parse(fs.readFileSync(packageFilePath("crm-1.0.0.albra"), "utf-8")) as AlbraPackage;
    original.payload.application[0].content += "\n// ⚠ CONTENIDO MANIPULADO — la firma ya no coincide";
    fs.writeFileSync(tamperedFp, JSON.stringify(original, null, 2), "utf-8");
  }

  // Estado de plataforma
  const adapter = getDeploymentAdapter();
  await db.platformState.upsert({
    where: { key: "platform:info" },
    create: { key: "platform:info", value: adapter.info() as unknown as object },
    update: { value: adapter.info() as unknown as object },
  });
  await db.platformState.upsert({
    where: { key: "platform:latest" },
    create: { key: "platform:latest", value: { crm: getLatestVersion("crm"), leads: getLatestVersion("leads") } as object },
    update: { value: { crm: getLatestVersion("crm"), leads: getLatestVersion("leads") } as object },
  });

  // V2 REAL RUNTIME: reconciliación DB ↔ sistema operativo al arrancar el INSTALADOR.
  // Detecta procesos huérfanos (los adopta), crashes (evidencia) y estados perdidos.
  try {
    const recs = await reconcileAll();
    const changed = recs.filter(r => r.changed);
    if (changed.length > 0) {
      const value = { at: new Date().toISOString(), changes: changed.map(c => ({ productId: c.productId, from: c.before, to: c.after, evidence: c.evidence })) };
      await db.platformState.upsert({
        where: { key: "platform:lastReconcile" },
        create: { key: "platform:lastReconcile", value },
        update: { value },
      });
    }
  } catch {
    /* la reconciliación nunca bloquea el bootstrap */
  }
}

export async function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = doBootstrap().catch(e => {
      bootstrapPromise = null;
      throw e;
    });
  }
  await bootstrapPromise;
}
