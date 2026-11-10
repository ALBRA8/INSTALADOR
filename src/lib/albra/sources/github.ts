/**
 * ALBRA — V2 WAVE C: MOTOR DE FUENTES GITHUB.
 *
 * Instalación GENÉRICA de agentes/productos desde GitHub con versión FIJADA:
 *   resolve (dry-run) → download (streaming + límite) → verificación
 *   (checksum del originador + firma .albra + contrato) → bóveda.
 *
 * Seguridad:
 *   - El token (GITHUB_TOKEN o PATHS.keys/github.token) NUNCA se loguea.
 *   - refs de rama (main/master/develop, refs/heads/*) RECHAZADAS.
 *   - El asset se compara con `albra-sha256:` del body del release si existe.
 *   - El paquete debe pasar verifyPackage() (hash + firma HMAC) y
 *     parseProductContract() antes de entrar en la bóveda.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { db } from "@/lib/db";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import {
  verifyPackage, packageFilePath, SIGNATURE_KEY_ID, type AlbraPackage,
} from "@/lib/albra/package/format";
import { parseProductContract } from "@/lib/albra/contracts";
import { validateSourceRef, type GithubRefType } from "@/lib/albra/contracts/source";
import { ApiError } from "@/lib/albra/api-serialize";
import { log } from "@/lib/albra/core/logger";
import { audit } from "@/lib/albra/core/audit";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "ALBRA-Platform";
const API_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
export const MAX_ASSET_BYTES = 200 * 1024 * 1024; // 200 MB

// ───────────────────────── Token ─────────────────────────

/**
 * Token de GitHub: process.env.GITHUB_TOKEN ?? PATHS.keys/github.token.
 * NUNCA se incluye en logs ni respuestas (el logger además lo redacta).
 */
export function getGithubToken(): string | null {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fp = path.join(PATHS.keys, "github.token");
    if (!fs.existsSync(fp)) return null;
    const value = fs.readFileSync(fp, "utf-8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// ───────────────────────── Tipos ─────────────────────────

export interface GithubSourceRequest {
  repo: string;
  refType: GithubRefType;
  ref: string;
  assetName?: string;
}

export interface ResolvedGithubSource {
  repo: string;
  refType: GithubRefType;
  ref: string;
  /** Tag canónico (release). */
  tag?: string;
  /** SHA de commit FIJADO resuelto (nunca un nombre de rama). */
  commitSha: string | null;
  asset?: { name: string; url: string; size: number };
  /** Body del release (contiene albra-sha256:/albra-package: si el editor lo declara). */
  releaseBody?: string;
}

export interface ImportedPackageResult {
  packageId: string;
  version: string;
  fileName: string;
  /** sha256 de los BYTES del asset descargado (el que firma el release). */
  sha256: string;
  /** Hash interno del paquete (integrity.packageHash, consistente con la bóveda). */
  packageHash: string;
  origin: { repo: string; refType: GithubRefType; ref: string; commitSha: string | null };
  /** true si ya existía en la bóveda con el mismo contenido (importación idempotente). */
  alreadyInVault: boolean;
}

// ───────────────────────── HTTP GitHub ─────────────────────────

function assertRepoFormat(repo: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ApiError(400, "VALIDATION_ERROR", `Invalid repo '${repo}'`, "El repo debe tener formato 'owner/name'.");
  }
}

/** Lanza ApiError 400 BRANCH_REF_REJECTED si la ref es de rama. */
function assertPinnableRef(ref: string, refType?: string): void {
  const v = validateSourceRef(ref, refType);
  if (!v.ok) {
    throw new ApiError(
      400,
      v.code,
      v.message,
      v.message.replace("BRANCH_REF_REJECTED — ", "ALBRA solo instala versiones fijadas: "),
    );
  }
}

async function ghFetchJson(pathname: string): Promise<unknown> {
  const token = getGithubToken();
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${pathname}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiError(
      502,
      "GITHUB_UNREACHABLE",
      `GitHub API unreachable: ${(e as Error).message}`,
      "No se pudo contactar con GitHub. Revisa la conexión y vuelve a intentarlo.",
    );
  }
  if (res.status === 404) {
    throw new ApiError(
      404,
      "SOURCE_NOT_FOUND",
      `GitHub resource not found: ${pathname}`,
      "No se encontró la fuente en GitHub (repo, release, tag o commit).",
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw new ApiError(
      429,
      "GITHUB_RATE_LIMITED",
      `GitHub rate limited (HTTP ${res.status})`,
      "GitHub limitó las peticiones (rate limit). Espera unos minutos o configura GITHUB_TOKEN.",
    );
  }
  if (res.status === 401) {
    throw new ApiError(
      502,
      "GITHUB_UNREACHABLE",
      "GitHub rejected the configured credentials (HTTP 401)",
      "GitHub rechazó el token configurado. Revisa GITHUB_TOKEN o albra-data/keys/github.token.",
    );
  }
  if (!res.ok) {
    throw new ApiError(502, "GITHUB_UNREACHABLE", `GitHub API HTTP ${res.status}`, "GitHub devolvió un error inesperado.");
  }
  return res.json();
}

const SHA_RE = /^[0-9a-f]{40}$/i;

/** Resuelve el SHA de commit de un tag (desreferencia tags anotados). */
async function resolveTagCommitSha(repo: string, tag: string): Promise<string | null> {
  try {
    const ref = (await ghFetchJson(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`)) as {
      object?: { sha?: string; type?: string };
    };
    const sha = ref?.object?.sha;
    if (!sha) return null;
    if (ref.object?.type === "tag") {
      // Tag anotado → desreferenciar al commit real
      const deref = (await ghFetchJson(`/repos/${repo}/git/tags/${sha}`)) as { object?: { sha?: string; type?: string } };
      if (deref?.object?.sha && deref.object.type === "commit") return deref.object.sha;
      return null;
    }
    return sha;
  } catch {
    return null; // el caller decide el fallback
  }
}

// ───────────────────────── resolve ─────────────────────────

/**
 * Resuelve una fuente GitHub a una versión FIJADA (dry-run, sin descargar).
 * Errores: SOURCE_NOT_FOUND, GITHUB_RATE_LIMITED, GITHUB_UNREACHABLE, BRANCH_REF_REJECTED.
 */
export async function resolveGithubSource(input: GithubSourceRequest): Promise<ResolvedGithubSource> {
  assertRepoFormat(input.repo);
  assertPinnableRef(input.ref, input.refType);

  let resolved: ResolvedGithubSource;

  if (input.refType === "release") {
    const rel = (await ghFetchJson(`/repos/${input.repo}/releases/tags/${encodeURIComponent(input.ref)}`)) as {
      tag_name?: string;
      target_commitish?: string;
      body?: string;
      assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>;
    };
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const wanted = input.assetName
      ? assets.find(a => a.name === input.assetName)
      : assets.find(a => typeof a.name === "string" && a.name.endsWith(".albra"));
    if (!wanted?.browser_download_url || !wanted.name) {
      throw new ApiError(
        404,
        "SOURCE_NOT_FOUND",
        `No .albra asset ${input.assetName ? `'${input.assetName}' ` : ""}in release '${input.ref}' of ${input.repo}`,
        input.assetName
          ? `El release '${input.ref}' no incluye el asset '${input.assetName}'.`
          : `El release '${input.ref}' no incluye ningún asset .albra.`,
      );
    }
    const tag = rel.tag_name ?? input.ref;
    // SHA fijado: el del tag del release (verdad de la versión); fallback: target_commitish si es SHA.
    const commitSha = (await resolveTagCommitSha(input.repo, tag))
      ?? (rel.target_commitish && SHA_RE.test(rel.target_commitish) ? rel.target_commitish : null);
    resolved = {
      repo: input.repo,
      refType: "release",
      ref: input.ref,
      tag,
      commitSha,
      asset: { name: wanted.name, url: wanted.browser_download_url, size: wanted.size ?? 0 },
      releaseBody: rel.body ?? undefined,
    };
  } else if (input.refType === "tag") {
    const ref = (await ghFetchJson(`/repos/${input.repo}/git/ref/tags/${encodeURIComponent(input.ref)}`)) as {
      object?: { sha?: string; type?: string };
    };
    const sha = ref?.object?.sha;
    if (!sha) throw new ApiError(404, "SOURCE_NOT_FOUND", `Tag '${input.ref}' not found in ${input.repo}`, "No se encontró el tag en GitHub.");
    let commitSha: string | null = sha;
    if (ref.object?.type === "tag") {
      const deref = (await ghFetchJson(`/repos/${input.repo}/git/tags/${sha}`)) as { object?: { sha?: string; type?: string } };
      commitSha = deref?.object?.sha ?? null;
    }
    resolved = { repo: input.repo, refType: "tag", ref: input.ref, tag: input.ref, commitSha };
  } else {
    // commit
    if (!SHA_RE.test(input.ref)) {
      throw new ApiError(400, "VALIDATION_ERROR", `ref '${input.ref}' is not a 40-hex commit sha`, "Para refType 'commit' la ref debe ser un SHA de 40 caracteres hexadecimales.");
    }
    const commit = (await ghFetchJson(`/repos/${input.repo}/commits/${input.ref}`)) as { sha?: string };
    if (!commit?.sha) throw new ApiError(404, "SOURCE_NOT_FOUND", `Commit '${input.ref}' not found in ${input.repo}`, "No se encontró el commit en GitHub.");
    resolved = { repo: input.repo, refType: "commit", ref: input.ref, commitSha: commit.sha };
  }

  await log({
    channel: "SYSTEM",
    message: `Fuente GitHub resuelta: ${resolved.repo}@${resolved.refType}:${resolved.ref} → commit ${resolved.commitSha?.slice(0, 12) ?? "?"}${resolved.asset ? ` (asset ${resolved.asset.name}, ${resolved.asset.size} bytes)` : " (sin asset)"}`,
    data: { repo: resolved.repo, refType: resolved.refType, ref: resolved.ref, commitSha: resolved.commitSha, asset: resolved.asset?.name ?? null },
  });
  return resolved;
}

// ───────────────────────── download ─────────────────────────

/**
 * Descarga en streaming del asset a destPath (binario: stream + rename atómico).
 * Límite de tamaño ESTRICTO (maxBytes), timeout 60 s, sha256 en vuelo.
 */
export async function downloadGithubAsset(
  assetUrl: string,
  destPath: string,
  maxBytes: number = MAX_ASSET_BYTES,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const token = getGithubToken();
  let res: Response;
  try {
    res = await fetch(assetUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiError(502, "GITHUB_UNREACHABLE", `Asset download failed: ${(e as Error).message}`, "Falló la descarga del asset desde GitHub (red o timeout).");
  }
  if (res.status === 404 || res.status === 422) {
    throw new ApiError(404, "SOURCE_NOT_FOUND", `Asset not found (HTTP ${res.status}): ${assetUrl}`, "El asset solicitado no existe en el release.");
  }
  if (res.status === 403 || res.status === 429) {
    throw new ApiError(429, "GITHUB_RATE_LIMITED", `Asset download rate limited (HTTP ${res.status})`, "GitHub limitó la descarga (rate limit). Espera unos minutos.");
  }
  if (!res.ok || !res.body) {
    throw new ApiError(502, "GITHUB_UNREACHABLE", `Asset download HTTP ${res.status}`, "GitHub devolvió un error al descargar el asset.");
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream),
      async function* (source) {
        for await (const chunk of source) {
          const buf = chunk as Buffer;
          bytes += buf.length;
          if (bytes > maxBytes) {
            throw new ApiError(
              413,
              "ASSET_TOO_LARGE",
              `Asset exceeds ${maxBytes} bytes`,
              `El asset supera el límite de descarga (${Math.round(maxBytes / (1024 * 1024))} MB).`,
            );
          }
          hash.update(buf);
          yield buf;
        }
      },
      fs.createWriteStream(tmp),
    );
    fs.renameSync(tmp, destPath);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw e;
  }
  return { path: destPath, sha256: hash.digest("hex"), bytes };
}

// ───────────────────────── import → bóveda ─────────────────────────

/** packageHash de identidad del paquete en la bóveda (null si ilegible). */
function vaultPackageHash(fp: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as AlbraPackage;
    return parsed?.integrity?.packageHash ?? null;
  } catch {
    return null;
  }
}

function extractOriginManifest(body: string | undefined): { sha256?: string; package?: string } {
  if (!body) return {};
  const sha = body.match(/^albra-sha256:\s*([0-9a-f]{64})$/im)?.[1];
  const pkg = body.match(/^albra-package:\s*(\S+)$/im)?.[1];
  return { ...(sha ? { sha256: sha } : {}), ...(pkg ? { package: pkg } : {}) };
}

async function rejectDownload(fileName: string, reason: string, detail: unknown): Promise<never> {
  try { fs.rmSync(path.join(PATHS.downloads, fileName), { force: true }); } catch { /* best effort */ }
  await audit({ type: "PACKAGE_REJECTED", severity: "ERROR", detail });
  throw new ApiError(422, "PACKAGE_REJECTED", `PACKAGE_REJECTED — ${reason}`, "El paquete descargado no pasó la verificación de integridad/firma y fue eliminado.");
}

/**
 * Flujo completo GitHub → bóveda:
 * resolve → download → checksum del originador → verifyPackage →
 * parseProductContract → registro en bóveda + PackageArtifact (origin github).
 */
export async function importPackageFromGithub(input: GithubSourceRequest): Promise<ImportedPackageResult> {
  ensureDirs();
  assertRepoFormat(input.repo);
  assertPinnableRef(input.ref, input.refType);

  // 1) Resolver origen fijado
  const resolved = await resolveGithubSource(input);
  await audit({
    type: "SOURCE_RESOLVED",
    detail: {
      repo: resolved.repo, refType: resolved.refType, ref: resolved.ref,
      commitSha: resolved.commitSha, tag: resolved.tag ?? null, asset: resolved.asset?.name ?? null,
    },
  });

  if (!resolved.asset) {
    throw new ApiError(
      404,
      "SOURCE_NOT_FOUND",
      `Source ${resolved.repo}@${resolved.refType}:${resolved.ref} has no downloadable .albra asset (use refType 'release')`,
      "La fuente no incluye un asset .albra descargable. Usa refType 'release' con el asset del paquete.",
    );
  }

  // 2) Descargar a downloads/
  const downloadName = path.basename(resolved.asset.name).replace(/[^A-Za-z0-9._-]/g, "_");
  const destPath = path.join(PATHS.downloads, downloadName);
  const dl = await downloadGithubAsset(resolved.asset.url, destPath);
  await log({ channel: "SYSTEM", message: `Asset descargado: ${downloadName} (${(dl.bytes / 1024).toFixed(1)} KB, sha256 ${dl.sha256.slice(0, 12)}…)` });

  // 3) Checksum declarado por el originador en el body del release
  const originManifest = extractOriginManifest(resolved.releaseBody);
  if (originManifest.sha256 && originManifest.sha256 !== dl.sha256) {
    try { fs.rmSync(destPath, { force: true }); } catch { /* best effort */ }
    await audit({
      type: "PACKAGE_REJECTED", severity: "ERROR",
      detail: { reason: "ORIGIN_CHECKSUM_MISMATCH", repo: resolved.repo, ref: resolved.ref, expected: originManifest.sha256, actual: dl.sha256 },
    });
    throw new ApiError(
      422,
      "ORIGIN_CHECKSUM_MISMATCH",
      `ORIGIN_CHECKSUM_MISMATCH — release body declares ${originManifest.sha256}, downloaded ${dl.sha256}`,
      "El checksum del archivo descargado no coincide con el declarado por el originador en el release. El archivo fue eliminado.",
    );
  }

  // 4) Verificación del paquete .albra (estructura → hashes → firma)
  let rawPkg: unknown = null;
  try {
    rawPkg = JSON.parse(fs.readFileSync(destPath, "utf-8"));
  } catch {
    rawPkg = null;
  }
  if (!rawPkg || typeof rawPkg !== "object") {
    return await rejectDownload(downloadName, "PACKAGE_PARSE_ERROR", { reason: "PACKAGE_PARSE_ERROR", fileName: downloadName });
  }
  const pkg = rawPkg as AlbraPackage;
  const verdict = verifyPackage(pkg);
  if (!verdict.valid) {
    return await rejectDownload(downloadName, verdict.reason, { reason: verdict.reason, fileName: downloadName, packageId: verdict.packageId ?? null });
  }
  const contractParsed = parseProductContract(pkg.contract);
  if (!contractParsed.ok) {
    return await rejectDownload(downloadName, `CONTRACT_INVALID — ${contractParsed.errors.join("; ")}`, { reason: "CONTRACT_INVALID", fileName: downloadName, errors: contractParsed.errors });
  }

  const { packageId, version } = pkg.manifest;
  const vaultName = `${packageId}-${version}.albra`;
  const vaultPath = packageFilePath(vaultName);

  // 5) Bóveda: conflicto si existe el mismo packageId+version con packageHash
  // distinto (identidad de contenido del paquete). Mismo packageHash con bytes
  // diferentes (re-firmado/createdAt) = el MISMO paquete → idempotente.
  let alreadyInVault = false;
  if (fs.existsSync(vaultPath)) {
    const existingHash = vaultPackageHash(vaultPath);
    if (existingHash !== pkg.integrity.packageHash) {
      try { fs.rmSync(destPath, { force: true }); } catch { /* best effort */ }
      await audit({
        type: "PACKAGE_REJECTED", severity: "ERROR",
        detail: { reason: "PACKAGE_CONFLICT", packageId, version, vaultPackageHash: existingHash, downloadedPackageHash: pkg.integrity.packageHash, downloadedSha256: dl.sha256 },
      });
      throw new ApiError(
        409,
        "PACKAGE_CONFLICT",
        `PACKAGE_CONFLICT — ${vaultName} already exists with different packageHash`,
        `Ya existe en la bóveda ${packageId} v${version} con contenido distinto. Si confías en el nuevo contenido, elimina primero ${vaultName} de la bóveda.`,
      );
    }
    alreadyInVault = true;
    try { fs.rmSync(destPath, { force: true }); } catch { /* best effort */ }
  } else {
    fs.renameSync(destPath, vaultPath); // misma partición (ALBRA_ROOT): rename atómico
  }

  // 6) Registro en PackageArtifact con la cadena de origen
  const sig = pkg.signature;
  const signerKeyId = "keyId" in sig && sig.keyId ? sig.keyId : SIGNATURE_KEY_ID;
  const signatureAlg = "alg" in sig ? sig.alg : sig.algorithm;
  const originData = {
    originType: "github",
    originRepo: resolved.repo,
    originRef: resolved.ref,
    originCommit: resolved.commitSha,
  };
  await db.packageArtifact.upsert({
    where: { packageId_version: { packageId, version } },
    create: {
      packageId, version, channel: pkg.manifest.channel || "stable",
      fileName: vaultName, sha256: pkg.integrity.packageHash, signature: sig.value,
      verified: true, manifest: pkg.manifest as object,
      signerKeyId, signatureAlg, trustLevel: verdict.trustLevel,
      ...originData,
    },
    update: {
      fileName: vaultName, sha256: pkg.integrity.packageHash, signature: sig.value,
      verified: true, signerKeyId, signatureAlg, trustLevel: verdict.trustLevel,
      ...originData,
    },
  });

  await audit({
    type: "PACKAGE_IMPORTED",
    detail: {
      packageId, version, fileName: vaultName, sha256: dl.sha256, bytes: dl.bytes,
      repo: resolved.repo, refType: resolved.refType, ref: resolved.ref, commitSha: resolved.commitSha,
      alreadyInVault, originManifest,
    },
  });
  await log({
    channel: "SYSTEM",
    message: `Paquete importado desde GitHub: ${packageId} v${version} (${vaultName}, sha256 ${dl.sha256.slice(0, 12)}…, origen ${resolved.repo}@${resolved.refType}:${resolved.ref})`,
    data: { packageId, version, fileName: vaultName, sha256: dl.sha256, repo: resolved.repo, ref: resolved.ref },
  });

  return {
    packageId, version, fileName: vaultName, sha256: dl.sha256,
    packageHash: pkg.integrity.packageHash,
    origin: { repo: resolved.repo, refType: resolved.refType, ref: resolved.ref, commitSha: resolved.commitSha },
    alreadyInVault,
  };
}

// ───────────────────────── Confianza de scripts ─────────────────────────

export interface ScriptsTrustState {
  fileName: string;
  policy: "APPROVED" | "BLOCKED" | "UNSET";
  approvedBy?: string;
  approvedAt?: string;
  note?: string;
}

export function scriptsTrustKey(fileName: string): string {
  return `trust:scripts:${path.basename(fileName)}`;
}

/**
 * Estado de aprobación de scripts de un paquete (PlatformState, clave
 * `trust:scripts:<fileName>`). Fuente de autoridad para el instalador:
 * NO se depende de campos mutables dentro del paquete.
 */
export async function readScriptsTrustState(fileName: string): Promise<ScriptsTrustState> {
  const row = await db.platformState.findUnique({ where: { key: scriptsTrustKey(fileName) } });
  if (!row) return { fileName: path.basename(fileName), policy: "UNSET" };
  const v = (row.value ?? {}) as { policy?: string; approvedBy?: string; approvedAt?: string; note?: string };
  return {
    fileName: path.basename(fileName),
    policy: v.policy === "APPROVED" ? "APPROVED" : "BLOCKED",
    ...(v.approvedBy ? { approvedBy: v.approvedBy } : {}),
    ...(v.approvedAt ? { approvedAt: v.approvedAt } : {}),
    ...(v.note ? { note: v.note } : {}),
  };
}

export type { GithubRefType };
