/**
 * ALBRA — LAYER 3: PACKAGE SYSTEM
 * Formato ALBRA-PACKAGE v1 (.albra = JSON firmado y verificable).
 *
 *   PACKAGE → HASH → SIGNATURE → VERIFY → INSTALL
 *
 * Estructura interna: manifest / contracts / application / assets /
 * dependencies / deployment / migrations / metadata / signature.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/albra/env";
import { getMasterKeyHex } from "@/lib/albra/core/package-keys";

export const PACKAGE_FORMAT = "ALBRA-PACKAGE";
export const PACKAGE_FORMAT_VERSION = "1.0.0";
export const SIGNATURE_KEY_ID = "albra-root-2025";

export interface PackageFileEntry {
  path: string;
  sha256: string;
  /** Contenido textual del archivo (base64 si es binario). */
  content: string;
  encoding: "utf8" | "base64";
}

export interface AlbraPackage {
  format: typeof PACKAGE_FORMAT;
  formatVersion: string;
  manifest: {
    packageId: string;
    version: string;
    channel: string;
    displayName: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  };
  /** Product Contract completo embebido (validado al instalar). */
  contract: unknown;
  payload: {
    application: PackageFileEntry[];
    seeds: { contacts?: unknown[]; deals?: unknown[]; leads?: unknown[] };
    migrations: Array<{
      migrationId: string;
      fromVersion: string;
      toVersion: string;
      ops: string[];
    }>;
    deployment: { adapter: string; installStrategy: string };
  };
  integrity: {
    algorithm: "sha256";
    payloadHash: string;
    packageHash: string;
  };
  signature: {
    algorithm: "HMAC-SHA256";
    keyId: string;
    value: string;
  };
}

function canonical(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

function hashPackageCore(pkg: Omit<AlbraPackage, "integrity" | "signature">): { payloadHash: string; packageHash: string } {
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(pkg.payload))
    .digest("hex");
  const core = {
    format: pkg.format,
    formatVersion: pkg.formatVersion,
    manifest: pkg.manifest,
    contract: pkg.contract,
    payloadHash,
  };
  const packageHash = crypto.createHash("sha256").update(canonical(core)).digest("hex");
  return { payloadHash, packageHash };
}

export function signPackageHash(packageHash: string): string {
  return crypto.createHmac("sha256", Buffer.from(getMasterKeyHex(), "hex")).update(packageHash).digest("hex");
}

/** Construye el paquete completo con hashes y firma. */
export function buildPackage(input: {
  manifest: AlbraPackage["manifest"];
  contract: unknown;
  payload: AlbraPackage["payload"];
}): AlbraPackage {
  const core: Omit<AlbraPackage, "integrity" | "signature"> = {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    manifest: input.manifest,
    contract: input.contract,
    payload: input.payload,
  };
  const { payloadHash, packageHash } = hashPackageCore(core);
  const pkg: AlbraPackage = {
    ...core,
    integrity: { algorithm: "sha256", payloadHash, packageHash },
    signature: { algorithm: "HMAC-SHA256", keyId: SIGNATURE_KEY_ID, value: signPackageHash(packageHash) },
  };
  return pkg;
}

export type VerifyResult =
  | { valid: true; packageHash: string; packageId: string; version: string }
  | { valid: false; reason: string; packageId?: string; version?: string };

/** Verificación completa: estructura → hashes → firma. Rechaza paquetes inválidos. */
export function verifyPackage(raw: unknown): VerifyResult {
  try {
    const obj = raw as AlbraPackage;
    if (!obj || typeof obj !== "object") return { valid: false, reason: "PACKAGE_MALFORMED" };
    if (obj.format !== PACKAGE_FORMAT) return { valid: false, reason: "PACKAGE_FORMAT_UNKNOWN" };
    if (obj.formatVersion !== PACKAGE_FORMAT_VERSION) {
      return { valid: false, reason: `PACKAGE_FORMAT_VERSION_UNSUPPORTED (${obj.formatVersion})` };
    }
    if (!obj.manifest?.packageId || !obj.manifest?.version) {
      return { valid: false, reason: "PACKAGE_MANIFEST_INVALID" };
    }
    if (!Array.isArray(obj.payload?.application)) {
      return { valid: false, reason: "PACKAGE_PAYLOAD_INVALID", packageId: obj.manifest.packageId };
    }
    // Recalcular hash de archivos (integridad por archivo)
    for (const file of obj.payload.application) {
      const actual = crypto.createHash("sha256").update(file.content, "utf-8").digest("hex");
      if (actual !== file.sha256) {
        return {
          valid: false,
          reason: `FILE_CHECKSUM_MISMATCH: ${file.path}`,
          packageId: obj.manifest.packageId,
          version: obj.manifest.version,
        };
      }
    }
    // Recalcular payloadHash + packageHash
    const core = {
      format: obj.format,
      formatVersion: obj.formatVersion,
      manifest: obj.manifest,
      contract: obj.contract,
      payload: obj.payload,
    };
    const recomputed = hashPackageCore(core);
    if (recomputed.payloadHash !== obj.integrity?.payloadHash) {
      return { valid: false, reason: "PAYLOAD_HASH_MISMATCH", packageId: obj.manifest.packageId, version: obj.manifest.version };
    }
    if (recomputed.packageHash !== obj.integrity?.packageHash) {
      return { valid: false, reason: "PACKAGE_HASH_MISMATCH", packageId: obj.manifest.packageId, version: obj.manifest.version };
    }
    // Verificar firma HMAC
    const expectedSig = signPackageHash(obj.integrity.packageHash);
    if (!obj.signature || obj.signature.value !== expectedSig) {
      return { valid: false, reason: "SIGNATURE_INVALID", packageId: obj.manifest.packageId, version: obj.manifest.version };
    }
    return { valid: true, packageHash: obj.integrity.packageHash, packageId: obj.manifest.packageId, version: obj.manifest.version };
  } catch (e) {
    return { valid: false, reason: `PACKAGE_PARSE_ERROR: ${(e as Error).message}` };
  }
}

export function packageFilePath(fileName: string): string {
  // Defensa path-traversal: solo nombre de archivo plano.
  const safe = path.basename(fileName);
  return path.join(PATHS.packages, safe);
}

export function readPackageFile(fileName: string): AlbraPackage | null {
  const fp = packageFilePath(fileName);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as AlbraPackage;
  } catch {
    return null;
  }
}

export function writePackageFile(pkg: AlbraPackage): string {
  const { mkdirSync, writeFileSync } = fs;
  const dir = packageFilePath("");
  mkdirSync(dir, { recursive: true });
  const fileName = `${pkg.manifest.packageId}-${pkg.manifest.version}.albra`;
  writeFileSync(path.join(dir, fileName), JSON.stringify(pkg, null, 2), "utf-8");
  return fileName;
}
