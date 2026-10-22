/**
 * ALBRA — SecretStore abstraction (Security Contract).
 * AES-256-GCM. Master key generada y persistida con permisos restringidos.
 * Redaction obligatoria en logs, UI, diagnósticos y bundles.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "@/lib/db";
import { PATHS, ensureDirs } from "@/lib/albra/env";

const REDACTED = "••••••••";

let masterKeyCache: Buffer | null = null;

function loadMasterKey(): Buffer {
  if (masterKeyCache) return masterKeyCache;
  ensureDirs();
  const keyFile = path.join(PATHS.keys, "master.key");
  if (fs.existsSync(keyFile)) {
    masterKeyCache = Buffer.from(fs.readFileSync(keyFile, "utf-8").trim(), "hex");
  } else {
    masterKeyCache = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, masterKeyCache.toString("hex"), { mode: 0o600 });
  }
  return masterKeyCache;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadMasterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(cipherText: string): string | null {
  try {
    const [v, ivB, tagB, dataB] = cipherText.split(".");
    if (v !== "v1") return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", loadMasterKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf-8");
  } catch {
    return null;
  }
}

export async function putSecret(key: string, plain: string, productId?: string, hint?: string): Promise<void> {
  await db.secretRecord.upsert({
    where: { key_productId: { key, productId: productId ?? "" } },
    create: { key, productId: productId ?? null, cipher: encryptSecret(plain), hint },
    update: { cipher: encryptSecret(plain), hint },
  });
}

export async function getSecret(key: string, productId?: string): Promise<string | null> {
  const rec = await db.secretRecord.findUnique({
    where: { key_productId: { key, productId: productId ?? "" } },
  });
  if (!rec) return null;
  return decryptSecret(rec.cipher);
}

/** Nunca devuelve el valor real: solo metadata segura. */
export async function listSecrets(productId?: string) {
  const rows = await db.secretRecord.findMany({
    where: productId ? { productId } : {},
    select: { key: true, hint: true, updatedAt: true },
  });
  return rows.map(r => ({ key: r.key, hint: r.hint, value: REDACTED, updatedAt: r.updatedAt }));
}

export async function deleteSecretsFor(productId: string): Promise<number> {
  const res = await db.secretRecord.deleteMany({ where: { productId } });
  return res.count;
}

/** Redacción defensiva para cualquier estructura que pueda contener secretos. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 0 && /(secret|password|token|api[-_]?key|credential)/i.test(value)) return REDACTED;
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /(secret|password|token|api[-_]?key|credential|cipher)/i.test(k) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

export const REDACTION_PLACEHOLDER = REDACTED;
