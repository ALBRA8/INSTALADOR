/**
 * ALBRA — PUERTA DE ACCESO (ACCESS GATE): cliente de la API EXTERNA de
 * licenciamiento. Núcleo del requisito: NINGÚN paquete se descarga sin
 * validar antes la CLAVE ÚNICA DE ACCESO del proyecto.
 *
 * Propiedades de seguridad:
 *  - FAIL-CLOSED: si la API no responde, el contrato es inválido o hay
 *    timeout → la instalación se BLOQUEA (nunca se continúa sin veredicto).
 *  - El instalador NUNCA lee el registro de claves directamente: solo
 *    habla HTTP con la API externa (separación licenciante / instalador).
 *  - El endpoint se configura con ALBRA_ACCESS_API_URL; por defecto apunta
 *    al servicio de licenciamiento incluido en este despliegue
 *    (/api/access/verify) para que la puerta esté activa desde el primer
 *    arranque sin dependencias externas.
 *  - Toda veredicto (éxito o rechazo) queda AUDITADO.
 */
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import {
  AccessKeyVerifyRequestSchema,
  AccessKeyVerifyResponseSchema,
  ACCESS_KEY_PATTERN,
  type AccessKeyVerifyRequest,
  type AccessKeyVerifyResponse,
  type IssuedAccessKey,
  type IssuedAccessKeyStore,
} from "@/lib/albra/contracts/access";
import { audit } from "@/lib/albra/core/audit";

// ───────────────────────── Configuración del endpoint ─────────────────────────

const DEFAULT_LOCAL_PORT = process.env.PORT ?? "3000";

/** URL de la API externa de licenciamiento (sobrescribible por despliegue). */
export function accessApiUrl(): string {
  const fromEnv = process.env.ALBRA_ACCESS_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return `http://127.0.0.1:${DEFAULT_LOCAL_PORT}/api/access/verify`;
}

/** Origen legible del licenciante para mensajes de UI/audit. */
export function accessApiLabel(): string {
  if (process.env.ALBRA_ACCESS_API_URL?.trim()) return "API externa de licenciamiento (configurada)";
  return "Servicio de licenciamiento ALBRA (API incluida en este despliegue)";
}

// ───────────────────────── Registro de claves emitidas ─────────────────────────
// (Uso EXCLUSIVO del servicio de licenciamiento — routes /api/access/*.
//  El instalador nunca lo consulta: solo la API externa.)

function storePath(): string {
  return path.join(PATHS.access, "issued-keys.json");
}

export function readIssuedKeys(): IssuedAccessKeyStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf-8")) as IssuedAccessKeyStore;
    if (raw && Array.isArray(raw.keys)) return { keys: raw.keys };
  } catch {
    /* archivo ausente/corrupto → registro vacío */
  }
  return { keys: [] };
}

export function writeIssuedKeys(store: IssuedAccessKeyStore): void {
  ensureDirs();
  const tmp = `${storePath()}.tmp-${Date.now()}`;
  fs.mkdirSync(PATHS.access, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, storePath());
}

export function upsertIssuedKey(entry: IssuedAccessKey): void {
  const store = readIssuedKeys();
  const idx = store.keys.findIndex(k => k.key === entry.key);
  if (idx >= 0) store.keys[idx] = entry;
  else store.keys.push(entry);
  writeIssuedKeys(store);
}

/** Genera una clave con formato ALBRA-XXXX-XXXX-XXXX (sin ambigüedades). */
function generateKeyAlphabet(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const group = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `ALBRA-${group()}-${group()}-${group()}`;
}

/** Emite una clave DEMO vinculada a un producto (portal de licenciamiento demo). */
export function issueDemoKey(packageId: string, ttlMs = 24 * 60 * 60 * 1000): IssuedAccessKey {
  let key = generateKeyAlphabet();
  const existing = new Set(readIssuedKeys().keys.map(k => k.key));
  while (existing.has(key)) key = generateKeyAlphabet();
  const entry: IssuedAccessKey = {
    key,
    packageId,
    plan: "DEMO",
    licensee: "Operador local (clave de demostración)",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    revoked: false,
  };
  upsertIssuedKey(entry);
  return entry;
}

/**
 * Clave de SERVICIO (uso interno: certification, ops EEC). Se emite en el
 * bootstrap y se valida por la misma API externa — sin bypass de la puerta.
 */
export async function getOrCreateServiceKey(): Promise<string> {
  const row = await db.platformState.findUnique({ where: { key: "access:serviceKey" } });
  const existing = (row?.value as { key?: string } | null)?.key;
  if (existing && ACCESS_KEY_PATTERN.test(existing)) return existing;
  const key = "ALBRA-SVC-" + generateKeyAlphabet().slice(6);
  upsertIssuedKey({
    key,
    packageId: "*",
    plan: "SERVICE",
    licensee: "ALBRA Platform (operaciones internas certificadas)",
    issuedAt: new Date().toISOString(),
    expiresAt: null,
    revoked: false,
  });
  await db.platformState.upsert({
    where: { key: "access:serviceKey" },
    create: { key: "access:serviceKey", value: { key } },
    update: { value: { key } },
  });
  return key;
}

// ───────────────────────── Veredicto normalizado ─────────────────────────

export type AccessVerdict =
  | { ok: true; plan?: string; licensee?: string; expiresAt?: string | null; endpoint: string }
  | { ok: false; code: string; userMessage: string; endpoint: string };

const REJECT_MESSAGES: Record<string, string> = {
  FORMAT_INVALID:
    "La clave de acceso no tiene un formato válido (ALBRA-XXXX-XXXX-XXXX). Verifícala con el proveedor del proyecto.",
  ACCESS_KEY_UNKNOWN:
    "La clave de acceso no está registrada en el servicio de licenciamiento. Solicita una clave válida.",
  ACCESS_KEY_REVOKED: "La clave de acceso fue revocada por el licenciante.",
  ACCESS_KEY_EXPIRED: "La clave de acceso expiró. Solicita una nueva clave al licenciante.",
  ACCESS_KEY_PRODUCT_MISMATCH:
    "La clave de acceso no corresponde a este proyecto (la clave está vinculada a otro producto).",
  ACCESS_API_UNREACHABLE:
    "La API externa de licenciamiento no está disponible. Por seguridad (fail-closed) la descarga queda bloqueada hasta restablecer la conexión.",
  ACCESS_API_CONTRACT_INVALID:
    "La API externa de licenciamiento devolvió una respuesta fuera de contrato. Por seguridad, la descarga queda bloqueada.",
  ACCESS_KEY_REQUIRED: "Se requiere la clave única de acceso del proyecto para descargar e instalar paquetes.",
};

// ───────────────────────── Validación (llamada HTTP real) ─────────────────────────

export interface ValidateAccessKeyInput {
  packageId: string;
  accessKey: string;
  installationId?: string;
  /** Timeout de la llamada externa (ms). */
  timeoutMs?: number;
}

/**
 * Valida la clave única de acceso contra la API EXTERNA de licenciamiento.
 * Nunca lanza: devuelve veredicto normalizado. FAIL-CLOSED en cualquier duda.
 */
export async function validateProjectAccessKey(input: ValidateAccessKeyInput): Promise<AccessVerdict> {
  const endpoint = accessApiUrl();

  // 1) Pre-validación local de formato (ahorra la llamada si está mal formada)
  const keyNorm = input.accessKey.trim().toUpperCase();
  if (!ACCESS_KEY_PATTERN.test(keyNorm)) {
    const verdict: AccessVerdict = { ok: false, code: "FORMAT_INVALID", userMessage: REJECT_MESSAGES.FORMAT_INVALID, endpoint };
    await auditAccess(input.packageId, keyNorm, verdict);
    return verdict;
  }

  // 2) Solicitud según contrato
  const reqBody: AccessKeyVerifyRequest = {
    accessKey: keyNorm,
    packageId: input.packageId,
    ...(input.installationId ? { installationId: input.installationId } : {}),
  };
  const parsedReq = AccessKeyVerifyRequestSchema.safeParse(reqBody);
  if (!parsedReq.success) {
    const verdict: AccessVerdict = { ok: false, code: "FORMAT_INVALID", userMessage: REJECT_MESSAGES.FORMAT_INVALID, endpoint };
    await auditAccess(input.packageId, keyNorm, verdict);
    return verdict;
  }

  // 3) Llamada HTTP real a la API externa (timeout estricto, sin reintentos)
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedReq.data),
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs ?? 8_000),
    });
  } catch {
    const verdict: AccessVerdict = { ok: false, code: "ACCESS_API_UNREACHABLE", userMessage: REJECT_MESSAGES.ACCESS_API_UNREACHABLE, endpoint };
    await auditAccess(input.packageId, keyNorm, verdict);
    return verdict;
  }

  if (!res.ok) {
    const verdict: AccessVerdict = { ok: false, code: "ACCESS_API_UNREACHABLE", userMessage: REJECT_MESSAGES.ACCESS_API_UNREACHABLE, endpoint };
    await auditAccess(input.packageId, keyNorm, verdict);
    return verdict;
  }

  // 4) Contrato de respuesta (zod): fuera de contrato → bloqueo
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    const verdict: AccessVerdict = { ok: false, code: "ACCESS_API_CONTRACT_INVALID", userMessage: REJECT_MESSAGES.ACCESS_API_CONTRACT_INVALID, endpoint };
    await auditAccess(input.packageId, keyNorm, verdict);
    return verdict;
  }
  const parsed = AccessKeyVerifyResponseSchema.safeParse(json);
  if (!parsed.success) {
    const verdict: AccessVerdict = { ok: false, code: "ACCESS_API_CONTRACT_INVALID", userMessage: REJECT_MESSAGES.ACCESS_API_CONTRACT_INVALID, endpoint };
    await auditAccess(input.packageId, keyNorm, verdict);
    return verdict;
  }

  const body: AccessKeyVerifyResponse = parsed.data;
  const verdict: AccessVerdict = body.valid
    ? { ok: true, plan: body.plan, licensee: body.licensee, expiresAt: body.expiresAt ?? null, endpoint }
    : {
        ok: false,
        code: body.code ?? "ACCESS_KEY_UNKNOWN",
        userMessage: REJECT_MESSAGES[body.code ?? ""] ?? body.reason ?? REJECT_MESSAGES.ACCESS_KEY_UNKNOWN,
        endpoint,
      };
  await auditAccess(input.packageId, keyNorm, verdict);
  return verdict;
}

/** Auditoría de la puerta (éxitos y rechazos, con la clave enmascarada). */
async function auditAccess(packageId: string, key: string, verdict: AccessVerdict): Promise<void> {
  const masked = key.slice(0, 10) + "••••";
  if (verdict.ok) {
    await audit({
      type: "ACCESS_KEY_VALIDATED",
      productId: packageId,
      detail: { key: masked, plan: verdict.plan ?? null, licensee: verdict.licensee ?? null, endpoint: verdict.endpoint },
    });
  } else {
    await audit({
      type: "ACCESS_KEY_REJECTED",
      productId: packageId,
      severity: "ERROR",
      detail: { key: masked, code: verdict.code, endpoint: verdict.endpoint },
    });
  }
}

// ───────────────────────── Utilidades de UI/API ─────────────────────────

/** Mensaje de usuario para un código de rechazo conocido. */
export function accessRejectMessage(code: string): string {
  return REJECT_MESSAGES[code] ?? REJECT_MESSAGES.ACCESS_KEY_UNKNOWN;
}
