/**
 * ALBRA — LAYER 3: PACKAGE SYSTEM
 * Formato ALBRA-PACKAGE v1 (.albra = JSON firmado y verificable).
 *
 *   PACKAGE → HASH (INTEGRIDAD) → SIGNATURE (AUTENTICIDAD) → VERIFY → INSTALL
 *
 * Estructura interna: manifest / contracts / application / assets /
 * dependencies / deployment / migrations / metadata / signature.
 *
 * V2 TRUST CHAIN (prompt maestro §5):
 *  - La INTEGRIDAD (sha256 por archivo → payloadHash → packageHash) NO
 *    cambia: los paquetes existentes de la bóveda siguen verificando igual.
 *  - La AUTENTICIDAD es una capa aparte: firma Ed25519 (keyId + base64,
 *    formato "albra-sig-2") verificada contra el almacén de claves
 *    confiables (core/signing.ts). El HMAC local pasa a modo DEV explícito
 *    (trustLevel DEV_LOCAL): una clave compartida local no prueba quién
 *    produjo un paquete.
 *  - Salvaguardas de formato: límites de tamaño y validación de paths.
 *  - La clave privada de firma jamás se incluye en paquetes.
 *  - packageHash (integridad) es byte-compatible con V1; la firma es otra capa.
 *  - Rotación probada: revoke → SIGNING_KEY_REVOKED → rotate → re-trust FULL.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/albra/env";
import {
  signPackageHash,
  verifyPackageHash,
  signPackageHashHmacDev,
  verifyPackageHashHmacDev,
  getActiveSigner,
  getTrustEntry,
  isKeyRevoked,
} from "@/lib/albra/core/signing";

export const PACKAGE_FORMAT = "ALBRA-PACKAGE";
export const PACKAGE_FORMAT_VERSION = "1.0.0";
/** keyId del modo DEV (HMAC local). No es una identidad de procedencia. */
export const SIGNATURE_KEY_ID = "albra-root-2025";
/** Marcador de la capa de firma v2 (asimétrica). */
export const SIGNATURE_FORMAT_V2 = "albra-sig-2";

// ───────────── Salvaguardas de formato (prompt maestro §5) ─────────────
export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024; // 100 MB por paquete
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB por archivo
export const MAX_FILES = 500; // archivos por paquete

export interface PackageFileEntry {
  path: string;
  sha256: string;
  /** Contenido textual del archivo (base64 si es binario). */
  content: string;
  encoding: "utf8" | "base64";
}

/** Firma v2 (albra-sig-2): asimétrica ed25519 o hmac-dev explícito. */
export interface PackageSignatureV2 {
  format: typeof SIGNATURE_FORMAT_V2;
  alg: "ed25519" | "hmac-dev";
  keyId?: string;
  value: string;
  /** Legado (solo lectura, código pre-V2): usar `alg`. */
  algorithm?: "HMAC-SHA256";
}

/** Firma legacy (paquetes previos a V2): HMAC local sin campo alg. */
export interface PackageSignatureLegacy {
  algorithm: "HMAC-SHA256";
  keyId: string;
  value: string;
}

export type PackageSignature = PackageSignatureV2 | PackageSignatureLegacy;

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
  signature: PackageSignature;
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

/**
 * Construye el paquete completo con hashes y firma.
 * opts.signer (default "ed25519"): intenta firma asimétrica con la identidad
 * local; si no existe clave privada → degrada a hmac-dev (modo desarrollo
 * explícito, nunca declara procedencia). Con "hmac-dev" firma directo en
 * modo DEV.
 */
export function buildPackage(
  input: {
    manifest: AlbraPackage["manifest"];
    contract: unknown;
    payload: AlbraPackage["payload"];
  },
  opts?: { signer?: "ed25519" | "hmac-dev" },
): AlbraPackage {
  const core: Omit<AlbraPackage, "integrity" | "signature"> = {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    manifest: input.manifest,
    contract: input.contract,
    payload: input.payload,
  };
  const { payloadHash, packageHash } = hashPackageCore(core);

  const signer = getActiveSigner();
  let signature: PackageSignature;
  if ((opts?.signer ?? "ed25519") === "ed25519" && signer.hasPrivate && signer.keyId) {
    signature = {
      format: SIGNATURE_FORMAT_V2,
      alg: "ed25519",
      keyId: signer.keyId,
      value: signPackageHash(packageHash),
    };
  } else {
    signature = {
      format: SIGNATURE_FORMAT_V2,
      alg: "hmac-dev",
      keyId: SIGNATURE_KEY_ID,
      value: signPackageHashHmacDev(packageHash),
    };
  }

  const pkg: AlbraPackage = {
    ...core,
    integrity: { algorithm: "sha256", payloadHash, packageHash },
    signature,
  };
  return pkg;
}

// ───────────── Verificación: integridad + autenticidad ─────────────

export type TrustVerdict = "TRUSTED" | "UNTRUSTED_SIGNER" | "DEV_LOCAL" | "NONE";

export type VerifyResult =
  | {
      valid: true;
      packageHash: string;
      packageId: string;
      version: string;
      trustLevel: "TRUSTED" | "UNTRUSTED_SIGNER" | "DEV_LOCAL";
      reasons: string[];
      signerKeyId?: string;
      /** Compat: primer reason (o "OK"). */
      reason: string;
    }
  | {
      valid: false;
      reason: string;
      reasons: string[];
      packageId?: string;
      version?: string;
      trustLevel: "NONE";
    };

/** ¿El contrato embebido exige paquetes firmados por clave confiable? */
function requiresSignedPackages(contract: unknown): boolean {
  try {
    const sec = (contract as { security?: { signedPackagesRequired?: unknown } })?.security;
    return sec?.signedPackagesRequired === true;
  } catch {
    return false;
  }
}

/** Path de archivo de payload seguro: relativo, POSIX, sin "..", no vacío. */
function isSafePayloadPath(p: unknown): boolean {
  if (typeof p !== "string" || p.length === 0 || p.trim().length === 0) return false;
  if (p.includes("\\")) return false; // separador Windows
  if (p.startsWith("/")) return false; // absoluto POSIX
  if (/^[A-Za-z]:[\\/]/.test(p)) return false; // absoluto Windows (C:\ o C:/)
  const parts = p.split("/");
  if (parts.some(seg => seg === ".." || seg === "")) return false; // traversal y segmentos vacíos
  return true;
}

/** Verificación completa: límites → estructura → hashes → firma → confianza. */
export function verifyPackage(raw: unknown): VerifyResult {
  try {
    const obj = raw as AlbraPackage;
    if (!obj || typeof obj !== "object") return invalid("PACKAGE_MALFORMED");
    if (obj.format !== PACKAGE_FORMAT) return invalid("PACKAGE_FORMAT_UNKNOWN");
    if (obj.formatVersion !== PACKAGE_FORMAT_VERSION) {
      return invalid(`PACKAGE_FORMAT_VERSION_UNSUPPORTED (${obj.formatVersion})`);
    }
    if (!obj.manifest?.packageId || !obj.manifest?.version) {
      return invalid("PACKAGE_MANIFEST_INVALID");
    }
    if (!Array.isArray(obj.payload?.application)) {
      return invalid("PACKAGE_PAYLOAD_INVALID", obj.manifest.packageId, obj.manifest.version);
    }
    const pid = obj.manifest.packageId;
    const ver = obj.manifest.version;

    // ── Salvaguardas de formato (§5): límites de tamaño ──
    let totalBytes = 0;
    try {
      totalBytes = Buffer.byteLength(JSON.stringify(obj), "utf-8");
    } catch {
      return invalid("PACKAGE_MALFORMED", pid, ver);
    }
    if (totalBytes > MAX_PACKAGE_BYTES) {
      return invalid(`PACKAGE_TOO_LARGE: ${totalBytes} bytes (max ${MAX_PACKAGE_BYTES})`, pid, ver, "PACKAGE_TOO_LARGE");
    }
    if (obj.payload.application.length > MAX_FILES) {
      return invalid(`PACKAGE_TOO_LARGE: ${obj.payload.application.length} files (max ${MAX_FILES})`, pid, ver, "PACKAGE_TOO_LARGE");
    }

    // ── Salvaguardas de formato: paths seguros, tamaños y duplicados ──
    const seen = new Set<string>();
    for (const file of obj.payload.application) {
      if (!isSafePayloadPath(file?.path)) {
        return invalid(`PATH_UNSAFE: ${String(file?.path ?? "<vacío>")}`, pid, ver, "PATH_UNSAFE");
      }
      if (seen.has(file.path)) {
        return invalid(`DUPLICATE_PATH: ${file.path}`, pid, ver, "DUPLICATE_PATH");
      }
      seen.add(file.path);
      if (Buffer.byteLength(String(file?.content ?? ""), "utf-8") > MAX_FILE_BYTES) {
        return invalid(`FILE_TOO_LARGE: ${file.path} (max ${MAX_FILE_BYTES} bytes)`, pid, ver, "FILE_TOO_LARGE");
      }
    }

    // ── INTEGRIDAD (idéntica a V1: no romper paquetes existentes) ──
    for (const file of obj.payload.application) {
      const actual = crypto.createHash("sha256").update(file.content, "utf-8").digest("hex");
      if (actual !== file.sha256) {
        return invalid(`FILE_CHECKSUM_MISMATCH: ${file.path}`, pid, ver, "FILE_CHECKSUM_MISMATCH");
      }
    }
    const core = {
      format: obj.format,
      formatVersion: obj.formatVersion,
      manifest: obj.manifest,
      contract: obj.contract,
      payload: obj.payload,
    };
    const recomputed = hashPackageCore(core);
    if (recomputed.payloadHash !== obj.integrity?.payloadHash) {
      return invalid("PAYLOAD_HASH_MISMATCH", pid, ver, "PAYLOAD_HASH_MISMATCH");
    }
    if (recomputed.packageHash !== obj.integrity?.packageHash) {
      return invalid("PACKAGE_HASH_MISMATCH", pid, ver, "PACKAGE_HASH_MISMATCH");
    }
    const packageHash = obj.integrity.packageHash;

    // ── AUTENTICIDAD (capa aparte de la integridad) ──
    const sig = obj.signature as PackageSignature | undefined;
    if (!sig || typeof sig.value !== "string" || sig.value.length === 0) {
      return invalid("SIGNATURE_INVALID", pid, ver, "SIGNATURE_INVALID");
    }

    const isLegacyHmac =
      !("alg" in sig) && (sig as PackageSignatureLegacy).algorithm === "HMAC-SHA256";
    const alg = "alg" in sig ? sig.alg : undefined;

    if (isLegacyHmac || alg === "hmac-dev") {
      // Modo DEV: integridad verificada contra la clave local compartida.
      // NO prueba procedencia → trustLevel DEV_LOCAL (la UI lo muestra como advertencia).
      if (!verifyPackageHashHmacDev(packageHash, sig.value)) {
        return invalid("SIGNATURE_INVALID", pid, ver, "SIGNATURE_INVALID");
      }
      return {
        valid: true,
        packageHash,
        packageId: pid,
        version: ver,
        trustLevel: "DEV_LOCAL",
        reasons: ["DEV_LOCAL_SIGNATURE"],
        signerKeyId: ("keyId" in sig && sig.keyId) || SIGNATURE_KEY_ID,
        reason: "DEV_LOCAL_SIGNATURE",
      };
    }

    if (alg === "ed25519") {
      const keyId = "keyId" in sig ? sig.keyId : undefined;
      if (!keyId) return invalid("SIGNATURE_INVALID", pid, ver, "SIGNATURE_INVALID");

      // Revocación primero: una clave revocada invalida el paquete aunque la
      // criptografía cuadre (rotación/compromiso).
      if (isKeyRevoked(keyId)) {
        return invalid("SIGNING_KEY_REVOKED", pid, ver, "SIGNING_KEY_REVOKED");
      }
      // Verificación criptográfica (false también si la clave no existe).
      if (!verifyPackageHash(packageHash, keyId, sig.value)) {
        return invalid("SIGNATURE_INVALID", pid, ver, "SIGNATURE_INVALID");
      }
      const entry = getTrustEntry(keyId);
      if (entry && entry.trust === "FULL") {
        return {
          valid: true,
          packageHash,
          packageId: pid,
          version: ver,
          trustLevel: "TRUSTED",
          reasons: [],
          signerKeyId: keyId,
          reason: "OK",
        };
      }
      if (entry && entry.trust === "DEV") {
        // Registrada como clave de desarrollo: válida localmente, no procedencia.
        return {
          valid: true,
          packageHash,
          packageId: pid,
          version: ver,
          trustLevel: "DEV_LOCAL",
          reasons: ["DEV_TRUSTED_SIGNER"],
          signerKeyId: keyId,
          reason: "DEV_TRUSTED_SIGNER",
        };
      }
      // Clave no registrada en el almacén de confianza.
      if (requiresSignedPackages(obj.contract)) {
        return invalid("SIGNER_NOT_TRUSTED", pid, ver, "SIGNER_NOT_TRUSTED");
      }
      return {
        valid: true,
        packageHash,
        packageId: pid,
        version: ver,
        trustLevel: "UNTRUSTED_SIGNER",
        reasons: ["UNTRUSTED_SIGNER"],
        signerKeyId: keyId,
        reason: "UNTRUSTED_SIGNER",
      };
    }

    return invalid("SIGNATURE_INVALID", pid, ver, "SIGNATURE_INVALID");
  } catch (e) {
    return invalid(`PACKAGE_PARSE_ERROR: ${(e as Error).message}`);
  }
}

function invalid(reason: string, packageId?: string, version?: string, short?: string): VerifyResult {
  return {
    valid: false,
    reason,
    reasons: [short ?? reason],
    ...(packageId !== undefined ? { packageId } : {}),
    ...(version !== undefined ? { version } : {}),
    trustLevel: "NONE",
  };
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
