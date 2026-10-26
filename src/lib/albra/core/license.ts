/**
 * ALBRA — Cliente de la API EXTERNA de licencias (clave única de acceso).
 *
 * REGLA OBLIGATORIA: antes de descargar/leer CUALQUIER paquete, el instalador
 * valida la clave única de acceso del proyecto contra esta API externa vía
 * HTTP real. NO existe camino "offline" que la salte: si la API no responde,
 * la instalación se bloquea con LICENSE_API_UNREACHABLE.
 *
 * La URL base es configurable (producción apunta a la API real):
 *   1. env ALBRA_LICENSE_API_URL
 *   2. PlatformState key "license:apiUrl"  →  { base: "https://…" }
 *   3. http://127.0.0.1:3020  (API local de licencias, mini-services/license-api)
 *
 * Evidencia: cada intento se persiste en LicenseValidation (hash + últimos 4,
 * NUNCA la clave en claro) y se registra en la auditoría.
 */
import crypto from "crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/albra/core/audit";

// Clave de uso INTERNO de la plataforma (certificación, cleanroom, ops EEC).
// Se valida contra la API externa igual que cualquier clave de usuario:
// la validación sigue siendo obligatoria en todos los caminos.
export const PLATFORM_ACCESS_KEY = "ALBR-PLATFORM-0000-FFFF";

const DEFAULT_LICENSE_API_BASE = "http://127.0.0.1:3020";
const TIMEOUT_MS = 4000;
const ATTEMPTS = 2;

// ─────────────── Contrato de respuesta de la API externa ───────────────

const LicenseApiValidSchema = z.object({
  valid: z.literal(true),
  keyId: z.string().min(1),
  licensee: z.string().min(1),
  plan: z.string().min(1),
  products: z.array(z.string()).optional(),
  entitlements: z.array(z.string()).optional(),
  expiresAt: z.string().nullable().optional(),
  internal: z.boolean().optional(),
  checkedAt: z.string().optional(),
});

const LicenseApiInvalidSchema = z.object({
  valid: z.literal(false),
  reason: z.string().min(1),
  message: z.string().optional(),
});

const LicenseApiResponseSchema = z.union([LicenseApiValidSchema, LicenseApiInvalidSchema]);

export type LicenseFailureCode =
  | "LICENSE_KEY_REQUIRED"
  | "LICENSE_API_UNREACHABLE"
  | "LICENSE_API_ERROR"
  | "LICENSE_API_MALFORMED"
  | "KEY_NOT_FOUND"
  | "KEY_EXPIRED"
  | "KEY_DISABLED"
  | "PRODUCT_NOT_AUTHORIZED";

export type LicenseVerdict =
  | {
      ok: true;
      keyId: string;
      licensee: string;
      plan: string;
      entitlements: string[];
      expiresAt: string | null;
      internal: boolean;
    }
  | { ok: false; code: LicenseFailureCode; userMessage: string };

const USER_MESSAGES: Record<string, string> = {
  KEY_NOT_FOUND: "La clave de acceso no existe o fue revocada (verificación contra la API externa de licencias).",
  KEY_EXPIRED: "La clave de acceso está vencida. Renueva tu licencia para continuar.",
  KEY_DISABLED: "La clave de acceso está deshabilitada. Contacta al soporte de ALBRA.",
  PRODUCT_NOT_AUTHORIZED: "La clave de acceso no autoriza este producto. Verifica el plan de tu licencia.",
  LICENSE_API_UNREACHABLE:
    "No se pudo contactar la API externa de licencias. La validación de la clave es OBLIGATORIA antes de descargar cualquier paquete; revisa la conectividad e inténtalo de nuevo.",
  LICENSE_API_ERROR: "La API externa de licencias respondió con un error. Inténtalo de nuevo en unos segundos.",
  LICENSE_API_MALFORMED: "La API externa de licencias devolvió una respuesta inesperada. Inténtalo de nuevo.",
  LICENSE_KEY_REQUIRED: "Ingresa la clave única de acceso del proyecto para continuar.",
};

// ─────────────── Configuración del endpoint ───────────────

export async function resolveLicenseApiBase(): Promise<string> {
  const env = process.env.ALBRA_LICENSE_API_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  try {
    const row = await db.platformState.findUnique({ where: { key: "license:apiUrl" } });
    const base = (row?.value as { base?: unknown } | null)?.base;
    if (typeof base === "string" && base.trim()) return base.trim().replace(/\/+$/, "");
  } catch {
    /* tabla no disponible aún */
  }
  return DEFAULT_LICENSE_API_BASE;
}

export function keyFingerprint(accessKey: string): { keyHash: string; keyLast4: string } {
  return {
    keyHash: crypto.createHash("sha256").update(accessKey, "utf-8").digest("hex"),
    keyLast4: accessKey.slice(-4),
  };
}

// ─────────────── Validación (única puerta de entrada) ───────────────

export interface ValidateAccessKeyInput {
  accessKey: string;
  productId: string;
  runId?: string;
}

export async function validateAccessKey(input: ValidateAccessKeyInput): Promise<LicenseVerdict> {
  const started = Date.now();
  const apiBase = await resolveLicenseApiBase();
  const endpoint = `${apiBase}/v1/keys/validate`;

  // Clave ausente → rechazo inmediato con evidencia (no se contacta la API).
  if (!input.accessKey || input.accessKey.trim().length === 0) {
    await persistEvidence({
      input, endpoint, outcome: "REJECTED", reasonCode: "LICENSE_KEY_REQUIRED",
      durationMs: Date.now() - started,
    });
    await audit({ type: "LICENSE_REJECTED", productId: input.productId, severity: "WARN", detail: { reason: "LICENSE_KEY_REQUIRED" } });
    return { ok: false, code: "LICENSE_KEY_REQUIRED", userMessage: USER_MESSAGES.LICENSE_KEY_REQUIRED };
  }

  const accessKey = input.accessKey.trim();
  let lastNetworkError = "";

  // HTTP real contra la API externa, con reintentos acotados.
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey, productId: input.productId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status !== 200) {
        await persistEvidence({
          input, endpoint, outcome: "API_ERROR",
          reasonCode: `HTTP_${res.status}`, durationMs: Date.now() - started,
          detail: { status: res.status },
        });
        await audit({ type: "LICENSE_API_ERROR", productId: input.productId, severity: "ERROR", detail: { status: res.status } });
        return { ok: false, code: "LICENSE_API_ERROR", userMessage: USER_MESSAGES.LICENSE_API_ERROR };
      }

      const raw: unknown = await res.json();
      const parsed = LicenseApiResponseSchema.safeParse(raw);
      if (!parsed.success) {
        await persistEvidence({
          input, endpoint, outcome: "API_MALFORMED", reasonCode: "SCHEMA_MISMATCH",
          durationMs: Date.now() - started, detail: { issues: parsed.error.issues.slice(0, 3) },
        });
        await audit({ type: "LICENSE_API_MALFORMED", productId: input.productId, severity: "ERROR" });
        return { ok: false, code: "LICENSE_API_MALFORMED", userMessage: USER_MESSAGES.LICENSE_API_MALFORMED };
      }

      if (parsed.data.valid === false) {
        const reasonCode = parsed.data.reason as LicenseFailureCode;
        await persistEvidence({
          input, endpoint, outcome: "REJECTED", reasonCode,
          durationMs: Date.now() - started, detail: { apiMessage: parsed.data.message ?? null },
        });
        await audit({ type: "LICENSE_REJECTED", productId: input.productId, severity: "WARN", detail: { reason: reasonCode } });
        return { ok: false, code: reasonCode, userMessage: USER_MESSAGES[reasonCode] ?? parsed.data.message ?? "Clave de acceso rechazada." };
      }

      // ✔ Clave válida autorizada por la API externa
      const data = parsed.data;
      await persistEvidence({
        input, endpoint, outcome: "VALID", reasonCode: null,
        licensee: data.licensee, plan: data.plan,
        durationMs: Date.now() - started,
        detail: { keyId: data.keyId, internal: data.internal === true, expiresAt: data.expiresAt ?? null },
      });
      await audit({
        type: "LICENSE_VALIDATED", productId: input.productId,
        detail: { keyId: data.keyId, plan: data.plan, licensee: data.licensee, apiBase },
      });
      return {
        ok: true,
        keyId: data.keyId,
        licensee: data.licensee,
        plan: data.plan,
        entitlements: data.entitlements ?? [],
        expiresAt: data.expiresAt ?? null,
        internal: data.internal === true,
      };
    } catch (e) {
      lastNetworkError = (e as Error).message ?? "network error";
      if (attempt < ATTEMPTS) {
        await new Promise(r => setTimeout(r, 250));
      }
    }
  }

  // La API externa no respondió — BLOQUEO (validación obligatoria, sin bypass).
  await persistEvidence({
    input, endpoint, outcome: "API_UNREACHABLE", reasonCode: "FETCH_FAILED",
    durationMs: Date.now() - started, detail: { error: lastNetworkError, attempts: ATTEMPTS },
  });
  await audit({ type: "LICENSE_API_UNREACHABLE", productId: input.productId, severity: "ERROR", detail: { error: lastNetworkError } });
  return { ok: false, code: "LICENSE_API_UNREACHABLE", userMessage: USER_MESSAGES.LICENSE_API_UNREACHABLE };
}

// ─────────────── Error tipado para el motor de instalación ───────────────

export class LicenseError extends Error {
  code: LicenseFailureCode;
  userMessage: string;
  constructor(code: LicenseFailureCode, userMessage?: string) {
    super(code);
    this.name = "LicenseError";
    this.code = code;
    this.userMessage = userMessage ?? USER_MESSAGES[code] ?? code;
  }
}

/** Afirma que la clave es válida; lanza LicenseError si no. Usado por el instalador. */
export async function assertAccessKeyValid(input: ValidateAccessKeyInput): Promise<LicenseVerdict & { ok: true }> {
  const verdict = await validateAccessKey(input);
  if (!verdict.ok) throw new LicenseError(verdict.code, verdict.userMessage);
  return verdict;
}

// ─────────────── Persistencia de evidencia ───────────────

type EvidenceOutcome = "VALID" | "REJECTED" | "API_UNREACHABLE" | "API_ERROR" | "API_MALFORMED";

async function persistEvidence(args: {
  input: ValidateAccessKeyInput;
  endpoint: string;
  outcome: EvidenceOutcome;
  reasonCode: string | null;
  durationMs: number;
  licensee?: string;
  plan?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { keyHash, keyLast4 } = keyFingerprint(args.input.accessKey ?? "");
  try {
    await db.licenseValidation.create({
      data: {
        runId: args.input.runId ?? null,
        packageId: args.input.productId,
        keyHash,
        keyLast4,
        outcome: args.outcome,
        reasonCode: args.reasonCode,
        licensee: args.licensee ?? null,
        plan: args.plan ?? null,
        apiEndpoint: args.endpoint,
        durationMs: args.durationMs,
        detail: (args.detail ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch {
    /* evidencia best-effort: nunca bloquea el veredicto */
  }
}

/** Historial de validaciones para la UI/auditoría (sin datos sensibles). */
export async function listLicenseValidations(packageId?: string, limit = 20) {
  return db.licenseValidation.findMany({
    where: packageId ? { packageId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, runId: true, packageId: true, keyLast4: true, outcome: true,
      reasonCode: true, licensee: true, plan: true, apiEndpoint: true,
      durationMs: true, createdAt: true,
    },
  });
}
