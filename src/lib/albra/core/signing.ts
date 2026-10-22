/**
 * ALBRA — V2 TRUST CHAIN: firma asimétrica Ed25519 (AUTENTICIDAD).
 *
 * Separa INTEGRIDAD (sha256, en package/format.ts) de AUTENTICIDAD
 * (¿QUIÉN produjo el paquete?): un hash no demuestra quién produjo un
 * paquete; una firma Ed25519 sobre ese hash, verificada contra una clave
 * pública registrada en el almacén de confianza, sí.
 *
 * Diseño (prompt maestro V2 §5):
 *  - Clave privada NUNCA se incluye en paquetes, repositorios ni registros:
 *     solo vive en PATHS.keys/signing/private.pem con permiso 0600.
 *  - keyId = "albra-signer-" + primeros 12 hex de sha256(SPKI DER de la
 *     pública) → identificador estable, derivable de la clave pública sola.
 *  - Almacén de confianza con rotación/revocación: trusted.json
 *     {keys:[{keyId,name,addedAt,trust}], revoked:[{keyId,revokedAt,reason}]}.
 *  - HMAC-SHA256 (core/package-keys.ts) queda como modo DEV explícito:
 *     una clave local compartida NO es prueba universal de procedencia.
 *  - Sin autoridad central de firma (PENDING): el modo de desarrollo local
 *     es seguro y declarado, pero NO valida una cadena de producción.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import { getMasterKeyHex } from "@/lib/albra/core/package-keys";

/** Lanzada cuando se exige firma Ed25519 y no existe clave privada local. */
export const SIGNING_KEY_UNAVAILABLE = "SIGNING_KEY_UNAVAILABLE";
export const KEY_NOT_FOUND = "KEY_NOT_FOUND";

export type TrustLevel = "FULL" | "DEV";

export interface TrustedKeyEntry {
  keyId: string;
  name: string;
  addedAt: string;
  trust: TrustLevel;
}

export interface RevokedKeyEntry {
  keyId: string;
  revokedAt: string;
  reason: string;
}

export interface TrustStore {
  keys: TrustedKeyEntry[];
  revoked: RevokedKeyEntry[];
}

// ───────────── Rutas y permisos ─────────────

/** Directorio de identidad de firma (creación perezosa, idempotente). */
function signingDir(): string {
  ensureDirs();
  const dir = path.join(PATHS.keys, "signing");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** keyId de una clave pública Ed25519: derivable solo del material público. */
export function keyIdFromPublicKey(publicKey: crypto.KeyObject | string): string {
  const key = typeof publicKey === "string" ? crypto.createPublicKey(publicKey) : publicKey;
  const der = key.export({ type: "spki", format: "der" }) as Buffer;
  return "albra-signer-" + crypto.createHash("sha256").update(der).digest("hex").slice(0, 12);
}

/** keyId de la clave privada local (sin exponer material privado). */
function keyIdFromPrivateFile(privPath: string): string | null {
  try {
    const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf-8"));
    return keyIdFromPublicKey(crypto.createPublicKey(priv));
  } catch {
    return null;
  }
}

/**
 * Genera el par Ed25519 y lo persiste. IDEMPOTENTE: si ya existe
 * private.pem NO sobrescribe — retorna la identidad existente.
 * private.pem → 0600 (chmod explícito); <keyId>.pub → 0600.
 */
export function generateSigningKeypair(): { keyId: string; created: boolean } {
  const dir = signingDir();
  const privPath = path.join(dir, "private.pem");

  if (fs.existsSync(privPath)) {
    const keyId = keyIdFromPrivateFile(privPath);
    if (!keyId) throw new Error("SIGNING_KEY_CORRUPT");
    // Auto-reparación: la pública debe estar disponible para verificar.
    const pubPath = path.join(dir, `${keyId}.pub`);
    if (!fs.existsSync(pubPath)) {
      const pub = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(privPath, "utf-8")));
      writeKeyFile(pubPath, pub.export({ type: "spki", format: "pem" }).toString());
    }
    return { keyId, created: false };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = keyIdFromPublicKey(publicKey);

  writeKeyFile(privPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  writeKeyFile(path.join(dir, `${keyId}.pub`), publicKey.export({ type: "spki", format: "pem" }).toString());

  return { keyId, created: true };
}

/** Escritura de archivo de clave con permiso 0600 explícito. */
function writeKeyFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600); // chmod explícito aunque el umask lo relaje
  } catch {
    /* en plataformas sin POSIX chmod, la mode del write ya fue el intento */
  }
}

/** Identidad activa: {keyId, hasPrivate}. keyId null si no hay privada utilizable. */
export function getActiveSigner(): { keyId: string | null; hasPrivate: boolean } {
  const privPath = path.join(signingDir(), "private.pem");
  if (!fs.existsSync(privPath)) return { keyId: null, hasPrivate: false };
  const keyId = keyIdFromPrivateFile(privPath);
  if (!keyId) return { keyId: null, hasPrivate: false };
  return { keyId, hasPrivate: true };
}

// ───────────── Firma / verificación Ed25519 ─────────────

/** Firma Ed25519 del hash hex del paquete → base64. Exige clave privada local. */
export function signPackageHash(packageHash: string): string {
  const privPath = path.join(signingDir(), "private.pem");
  if (!fs.existsSync(privPath)) throw new Error(SIGNING_KEY_UNAVAILABLE);
  let priv: crypto.KeyObject;
  try {
    priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf-8"));
  } catch {
    throw new Error(SIGNING_KEY_UNAVAILABLE);
  }
  const sig = crypto.sign(null, Buffer.from(packageHash, "utf-8"), priv);
  return sig.toString("base64");
}

/** keyId saneado: evita path-traversal vía keyId provisto por paquetes. */
function safeKeyId(keyId: string): string | null {
  if (!keyId || typeof keyId !== "string") return null;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) return null;
  if (keyId.includes("..")) return null;
  return keyId;
}

/** Verifica firma Ed25519 (base64) sobre el hash hex, con la pública <keyId>.pub. */
export function verifyPackageHash(packageHash: string, keyId: string, sigB64: string): boolean {
  const id = safeKeyId(keyId);
  if (!id) return false;
  const pubPath = path.join(signingDir(), `${id}.pub`);
  if (!fs.existsSync(pubPath)) return false; // clave no encontrada → no confiable
  try {
    const pubPem = fs.readFileSync(pubPath, "utf-8");
    return crypto.verify(
      null,
      Buffer.from(packageHash, "utf-8"),
      crypto.createPublicKey(pubPem),
      Buffer.from(sigB64, "base64"),
    );
  } catch {
    return false;
  }
}

// ───────────── Almacén de claves confiables (rotación/revocación) ─────────────

function trustedKeysPath(): string {
  return path.join(signingDir(), "trusted.json");
}

function readTrustStore(): TrustStore {
  const fp = trustedKeysPath();
  if (!fs.existsSync(fp)) return { keys: [], revoked: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as Partial<TrustStore>;
    return { keys: Array.isArray(raw.keys) ? raw.keys : [], revoked: Array.isArray(raw.revoked) ? raw.revoked : [] };
  } catch {
    return { keys: [], revoked: [] };
  }
}

function writeTrustStore(store: TrustStore): void {
  writeKeyFile(trustedKeysPath(), JSON.stringify(store, null, 2));
}

/** Registra (o actualiza) una clave confiable. Idempotente por keyId. */
export function addTrustedKey(keyId: string, name: string, trust: TrustLevel): TrustedKeyEntry {
  const store = readTrustStore();
  if (store.revoked.some(r => r.keyId === keyId)) {
    throw new Error("KEY_REVOKED_CANNOT_TRUST");
  }
  const existing = store.keys.find(k => k.keyId === keyId);
  if (existing) {
    existing.name = name || existing.name;
    existing.trust = trust;
    writeTrustStore(store);
    return { ...existing };
  }
  const entry: TrustedKeyEntry = {
    keyId,
    name: name || "clave sin nombre",
    addedAt: new Date().toISOString(),
    trust,
  };
  store.keys.push(entry);
  writeTrustStore(store);
  return { ...entry };
}

/** Revoca una clave: se mueve de keys a revoked (rotación/compromiso). */
export function revokeKey(keyId: string, reason: string): RevokedKeyEntry {
  const store = readTrustStore();
  const idx = store.keys.findIndex(k => k.keyId === keyId);
  if (idx === -1) throw new Error(KEY_NOT_FOUND);
  store.keys.splice(idx, 1);
  const prev = store.revoked.find(r => r.keyId === keyId);
  const entry: RevokedKeyEntry = {
    keyId,
    revokedAt: new Date().toISOString(),
    reason: reason || "sin motivo declarado",
  };
  if (prev) {
    Object.assign(prev, entry);
  } else {
    store.revoked.push(entry);
  }
  writeTrustStore(store);
  return { ...entry };
}

/** Estado completo del almacén de confianza. */
export function listKeys(): TrustStore {
  const store = readTrustStore();
  return { keys: store.keys.map(k => ({ ...k })), revoked: store.revoked.map(r => ({ ...r })) };
}

/**
 * ROTACIÓN: revoca la clave activa (si no lo estaba), destruye su material
 * privado local y genera una identidad nueva registrada como DEV.
 * La clave nueva NUNCA hereda FULL automáticamente: elevarla es una decisión
 * explícita de política (POST trust). Los .pub antiguos se conservan para
 * poder verificar/invalidar paquetes firmados por claves pasadas.
 */
export function rotateSigningKey(reason?: string): { oldKeyId: string | null; oldWasRevoked: boolean; newKeyId: string; trust: TrustLevel } {
  const dir = signingDir();
  const privPath = path.join(dir, "private.pem");
  const active = getActiveSigner();

  let oldKeyId: string | null = null;
  let oldWasRevoked = false;
  if (active.hasPrivate && active.keyId) {
    oldKeyId = active.keyId;
    if (!isKeyRevoked(oldKeyId)) {
      revokeKey(oldKeyId, reason || "rotación de clave de firma");
      oldWasRevoked = true;
    }
  }
  if (fs.existsSync(privPath)) fs.rmSync(privPath, { force: true });

  const gen = generateSigningKeypair();
  addTrustedKey(gen.keyId, "Firmante local ALBRA (rotación)", "DEV");
  return { oldKeyId, oldWasRevoked, newKeyId: gen.keyId, trust: "DEV" };
}

export function getTrustEntry(keyId: string): TrustedKeyEntry | null {
  return readTrustStore().keys.find(k => k.keyId === keyId) ?? null;
}

export function isKeyRevoked(keyId: string): boolean {
  return readTrustStore().revoked.some(r => r.keyId === keyId);
}

/** Confiable = registrada en keys Y no revocada. */
export function isKeyTrusted(keyId: string): boolean {
  const store = readTrustStore();
  return store.keys.some(k => k.keyId === keyId) && !store.revoked.some(r => r.keyId === keyId);
}

// ───────────── Modo DEV explícito (HMAC local) ─────────────

/**
 * Modo DEV: HMAC-SHA256 con la clave maestra local. INTEGRIDAD sí,
 * AUTENTICIDAD no: cualquier proceso local con la clave puede firmar.
 * Solo válido en desarrollo local; nunca declara procedencia de producción.
 */
export function signPackageHashHmacDev(packageHash: string): string {
  return crypto.createHmac("sha256", Buffer.from(getMasterKeyHex(), "hex")).update(packageHash).digest("hex");
}

export function verifyPackageHashHmacDev(packageHash: string, sigHex: string): boolean {
  try {
    const expected = signPackageHashHmacDev(packageHash);
    const a = Buffer.from(sigHex);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ───────────── Bootstrap de identidad (idempotente) ─────────────

export interface SigningIdentity {
  keyId: string;
  created: boolean;
  trust: TrustLevel | null;
  revoked: boolean;
}

/**
 * Garantiza que exista identidad de firma local Ed25519 registrada.
 * Idempotente: si ya hay private.pem reutiliza esa clave (nunca rota
 * silenciosamente). La primera clave local se auto-registra con trust DEV
 * (desarrollo local) — elevar a FULL es una decisión explícita de política
 * (POST /api/trust/keys {action:"trust", trust:"FULL"}).
 * Nunca re-confía una clave revocada.
 */
export function ensureSigningIdentity(): SigningIdentity {
  const active = getActiveSigner();

  if (!active.hasPrivate || !active.keyId) {
    const gen = generateSigningKeypair();
    const entry = getTrustEntry(gen.keyId);
    if (!entry && !isKeyRevoked(gen.keyId)) {
      addTrustedKey(gen.keyId, "Firmante local ALBRA (desarrollo)", "DEV");
      return { keyId: gen.keyId, created: gen.created, trust: "DEV", revoked: false };
    }
    return { keyId: gen.keyId, created: gen.created, trust: entry?.trust ?? null, revoked: isKeyRevoked(gen.keyId) };
  }

  const keyId = active.keyId;
  const entry = getTrustEntry(keyId);
  if (!entry && !isKeyRevoked(keyId)) {
    // Identidad existente sin registro (p.ej. trusted.json perdido): re-registrar DEV.
    addTrustedKey(keyId, "Firmante local ALBRA (desarrollo)", "DEV");
    return { keyId, created: false, trust: "DEV", revoked: false };
  }
  // Auto-reparación de la pública si falta (necesaria para verificar).
  const pubPath = path.join(signingDir(), `${keyId}.pub`);
  if (!fs.existsSync(pubPath)) {
    const priv = crypto.createPrivateKey(fs.readFileSync(path.join(signingDir(), "private.pem"), "utf-8"));
    writeKeyFile(pubPath, crypto.createPublicKey(priv).export({ type: "spki", format: "pem" }).toString());
  }
  return { keyId, created: false, trust: entry?.trust ?? null, revoked: isKeyRevoked(keyId) };
}
