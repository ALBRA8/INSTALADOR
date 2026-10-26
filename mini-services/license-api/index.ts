/**
 * ALBRA LICENSE API — servicio EXTERNO de validación de claves únicas de acceso.
 *
 * Este servicio simula la API externa de licencias de ALBRA en el entorno local,
 * con el MISMO contrato HTTP que usaría la API real de producción:
 *
 *   POST /v1/keys/validate   { accessKey, productId? } → 200 { valid, … }
 *   GET  /health             → 200 { ok, service, keys }
 *   GET  /v1/keys            → listado enmascarado (demo/diagnóstico)
 *
 * El INSTALADOR (plataforma) la consume vía HTTP real con timeout y reintentos
 * (src/lib/albra/core/license.ts) y la URL es configurable con la variable de
 * entorno ALBRA_LICENSE_API_URL — apuntándola a la API de licencias real en
 * producción NO hay que tocar el código del instalador.
 *
 * Reglas de validación (igual que la API real):
 *   KEY_NOT_FOUND · KEY_DISABLED · KEY_EXPIRED · PRODUCT_NOT_AUTHORIZED
 *
 * Seguridad: la clave nunca se registra en claro en logs (solo hash + últimos 4).
 *
 * Puerto fijo: 3020 (servicio independiente, NO usa la variable PORT).
 */

import fs from "node:fs";

const PORT = 3020;
const SERVICE = "albra-license-api";
const VERSION = "1.0.0";

// ─────────────────── Registro de claves (persistido) ───────────────────

interface LicenseKeyRecord {
  accessKey: string;
  keyId: string;
  licensee: string;
  plan: string;
  /** Productos autorizados; "*" = todos. */
  products: string[];
  expiresAt: string | null; // ISO
  disabled: boolean;
  internal?: boolean; // clave de uso interno de la plataforma
  note?: string;
  validCount: number;
  rejectedCount: number;
  lastValidatedAt: string | null;
}

const DEMO_KEYS: LicenseKeyRecord[] = [
  {
    accessKey: "ALBR-CRM-8F3K-92QD",
    keyId: "key_crm_pro_001",
    licensee: "Acme Corp S.A.S.",
    plan: "PRO",
    products: ["crm"],
    expiresAt: "2026-12-31T23:59:59.000Z",
    disabled: false,
    note: "Clave demo para el producto CRM",
    validCount: 0,
    rejectedCount: 0,
    lastValidatedAt: null,
  },
  {
    accessKey: "ALBR-LEADS-5M9X-TZ24",
    keyId: "key_leads_starter_001",
    licensee: "Comercial Andina Ltda.",
    plan: "STARTER",
    products: ["leads"],
    expiresAt: "2027-06-30T23:59:59.000Z",
    disabled: false,
    note: "Clave demo para el producto LEADS",
    validCount: 0,
    rejectedCount: 0,
    lastValidatedAt: null,
  },
  {
    accessKey: "ALBR-ALL-7H2P-4RTX",
    keyId: "key_enterprise_universal_001",
    licensee: "ALBRA Demo — acceso universal",
    plan: "ENTERPRISE",
    products: ["*"],
    expiresAt: "2027-12-31T23:59:59.000Z",
    disabled: false,
    note: "Clave demo válida para cualquier producto",
    validCount: 0,
    rejectedCount: 0,
    lastValidatedAt: null,
  },
  {
    accessKey: "ALBR-PLATFORM-0000-FFFF",
    keyId: "key_platform_internal_001",
    licensee: "ALBRA Platform (interno)",
    plan: "PLATFORM",
    products: ["*"],
    expiresAt: null,
    disabled: false,
    internal: true,
    note: "Clave de uso interno de la plataforma (certificación, cleanroom, ops)",
    validCount: 0,
    rejectedCount: 0,
    lastValidatedAt: null,
  },
  {
    accessKey: "ALBR-EXPIRED-0000-0000",
    keyId: "key_expired_demo_001",
    licensee: "Licencia Vencida (demo)",
    plan: "PRO",
    products: ["*"],
    expiresAt: "2024-01-01T00:00:00.000Z",
    disabled: false,
    note: "Clave demo vencida — prueba del camino de fallo KEY_EXPIRED",
    validCount: 0,
    rejectedCount: 0,
    lastValidatedAt: null,
  },
  {
    accessKey: "ALBR-DISABLED-0000-0000",
    keyId: "key_disabled_demo_001",
    licensee: "Licencia Deshabilitada (demo)",
    plan: "PRO",
    products: ["*"],
    expiresAt: null,
    disabled: true,
    note: "Clave demo deshabilitada — prueba del camino de fallo KEY_DISABLED",
    validCount: 0,
    rejectedCount: 0,
    lastValidatedAt: null,
  },
];

const DATA_FILE = new URL("./keys.json", import.meta.url).pathname;
const LOG_FILE = new URL("./validations.jsonl", import.meta.url).pathname;

function loadKeys(): LicenseKeyRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as { keys: LicenseKeyRecord[] };
    if (Array.isArray(raw.keys) && raw.keys.length > 0) return raw.keys;
  } catch {
    /* primera ejecución → sembrar */
  }
  persistKeys(DEMO_KEYS);
  return DEMO_KEYS;
}

function persistKeys(keys: LicenseKeyRecord[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), keys }, null, 2));
}

let KEYS = loadKeys();

function maskKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 9) return clean.slice(0, 2) + "••••";
  return `${clean.slice(0, 9)}••••-${clean.slice(-4)}`;
}

function appendValidationLog(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    /* evidencia best-effort */
  }
}

// ─────────────────── Lógica de validación ───────────────────

interface ValidateBody {
  accessKey?: unknown;
  productId?: unknown;
}

function validate(body: ValidateBody): { status: number; payload: Record<string, unknown> } {
  const accessKey = typeof body.accessKey === "string" ? body.accessKey.trim().toUpperCase() : "";
  const productId = typeof body.productId === "string" ? body.productId.trim().toLowerCase() : null;

  if (!accessKey) {
    return {
      status: 400,
      payload: { valid: false, reason: "MALFORMED_REQUEST", message: "El campo accessKey es obligatorio." },
    };
  }

  const rec = KEYS.find(k => k.accessKey.toUpperCase() === accessKey);
  const now = new Date();

  if (!rec) {
    appendValidationLog({ at: now.toISOString(), keyMasked: maskKey(accessKey), productId, valid: false, reason: "KEY_NOT_FOUND" });
    return {
      status: 200,
      payload: { valid: false, reason: "KEY_NOT_FOUND", message: "La clave de acceso no existe o fue revocada." },
    };
  }

  let reason: string | null = null;
  let message = "";

  if (rec.disabled) {
    reason = "KEY_DISABLED";
    message = "La clave de acceso está deshabilitada. Contacta al soporte de ALBRA.";
  } else if (rec.expiresAt && new Date(rec.expiresAt) < now) {
    reason = "KEY_EXPIRED";
    message = `La clave de acceso venció el ${rec.expiresAt.slice(0, 10)}.`;
  } else if (productId && !rec.products.includes("*") && !rec.products.includes(productId)) {
    reason = "PRODUCT_NOT_AUTHORIZED";
    message = `La clave no autoriza el producto "${productId}" (autorizados: ${rec.products.join(", ")}).`;
  }

  if (reason) {
    rec.rejectedCount++;
    rec.lastValidatedAt = now.toISOString();
    persistKeys(KEYS);
    appendValidationLog({ at: now.toISOString(), keyMasked: maskKey(accessKey), keyId: rec.keyId, productId, valid: false, reason });
    return {
      status: 200,
      payload: { valid: false, reason, message, keyId: rec.keyId },
    };
  }

  rec.validCount++;
  rec.lastValidatedAt = now.toISOString();
  persistKeys(KEYS);
  appendValidationLog({ at: now.toISOString(), keyMasked: maskKey(accessKey), keyId: rec.keyId, productId, valid: true });
  return {
    status: 200,
    payload: {
      valid: true,
      keyId: rec.keyId,
      licensee: rec.licensee,
      plan: rec.plan,
      productId,
      products: rec.products,
      entitlements: rec.products.includes("*") ? ["*"] : rec.products.map(p => `entitlement.${p}`),
      expiresAt: rec.expiresAt,
      internal: rec.internal === true,
      checkedAt: now.toISOString(),
    },
  };
}

// ─────────────────── Servidor HTTP ───────────────────

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readBody(req: Request): Promise<ValidateBody> {
  try {
    const text = await req.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as ValidateBody) : {};
  } catch {
    return {};
  }
}

Bun.serve({
  port: PORT,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && path === "/health") {
      return json(200, {
        ok: true,
        service: SERVICE,
        version: VERSION,
        keys: KEYS.length,
        at: new Date().toISOString(),
      });
    }

    if (req.method === "GET" && path === "/v1/keys") {
      return json(200, {
        service: SERVICE,
        keys: KEYS.map(k => ({
          keyMasked: maskKey(k.accessKey),
          keyId: k.keyId,
          licensee: k.licensee,
          plan: k.plan,
          products: k.products,
          expiresAt: k.expiresAt,
          disabled: k.disabled,
          internal: k.internal === true,
          validCount: k.validCount,
          rejectedCount: k.rejectedCount,
          lastValidatedAt: k.lastValidatedAt,
        })),
      });
    }

    if (req.method === "POST" && path === "/v1/keys/validate") {
      const body = await readBody(req);
      const started = Date.now();
      const result = validate(body);
      appendValidationLog({ at: new Date().toISOString(), durationMs: Date.now() - started, endpoint: "/v1/keys/validate" });
      return json(result.status, result.payload);
    }

    return json(404, { ok: false, error: "NOT_FOUND", service: SERVICE });
  },
});

console.log(`[${SERVICE}] escuchando en http://127.0.0.1:${PORT} — ${KEYS.length} claves registradas`);
