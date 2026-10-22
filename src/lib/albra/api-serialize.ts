/**
 * ALBRA — Helpers de serialización y errores para la capa API (Task 6-b).
 * Única capa que convierte filas Prisma → DTOs (api-types.ts) y errores →
 * respuestas JSON estructuradas { error: { code, message, userMessage? } }.
 * userMessage SIEMPRE en español (mensaje para el usuario final).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { LifecycleRun } from "@prisma/client";
import type {
  LifecycleRunDTO,
  RunStepDTO,
  ConfigFieldDTO,
  ProductDetail,
  CrmContactDTO,
  CrmDealDTO,
  LeadDTO,
} from "@/lib/albra/api-types";
import type { ConfigField, ProductContract } from "@/lib/albra/contracts";
import { parseProductContract } from "@/lib/albra/contracts";
import { readPackageFile } from "@/lib/albra/package/format";
import { getContractFor } from "@/lib/albra/products/catalog";

// ───────────── Errores de API ─────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage?: string;

  constructor(status: number, code: string, message?: string, userMessage?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.userMessage = userMessage;
  }
}

/** Mapeo de códigos que el núcleo lanza como Error("CODE") plano. */
const CORE_ERROR_MAP: Record<string, { status: number; userMessage: string }> = {
  PRODUCT_NOT_INSTALLED: { status: 404, userMessage: "Este producto no está instalado." },
  PRODUCT_BUSY: { status: 409, userMessage: "Hay una operación en curso para este producto." },
  NO_PORT_AVAILABLE: { status: 400, userMessage: "No hay puertos libres disponibles." },
  PACKAGE_NOT_FOUND: { status: 404, userMessage: "El paquete solicitado no existe en la bóveda." },
};

/** Convierte cualquier error lanzado en un handler a la respuesta canónica. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: e.code,
          message: e.message,
          ...(e.userMessage ? { userMessage: e.userMessage } : {}),
        },
      },
      { status: e.status },
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  const mapped = CORE_ERROR_MAP[message];
  if (mapped) {
    return NextResponse.json(
      { error: { code: message, message, userMessage: mapped.userMessage } },
      { status: mapped.status },
    );
  }
  console.error("[albra-api] unhandled error:", e);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message, userMessage: "Error interno del servidor." } },
    { status: 500 },
  );
}

/** Lee el body JSON de forma defensiva (null si es inválido). */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ───────────── Serialización básica ─────────────

/** Date | string → ISO string; null/undefined → null. */
export function iso(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

/** Comparación semver estricta: true solo si a > b. */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map(n => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Cast defensivo de columnas Json (steps/checks/findings) a arrays tipados. */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Parseo de query params ?limit= con clamp. */
export function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// ───────────── DTOs de runs ─────────────

export function toRunDTO(row: LifecycleRun): LifecycleRunDTO {
  return {
    id: row.id,
    productId: row.productId,
    operation: row.operation,
    status: row.status as LifecycleRunDTO["status"],
    steps: asArray<RunStepDTO>(row.steps).map(s => ({
      ...s,
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
      ...(s.at !== undefined ? { at: s.at } : {}),
      ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}),
    })),
    error: row.error ?? null,
    startedAt: iso(row.startedAt) ?? new Date(0).toISOString(),
    finishedAt: iso(row.finishedAt),
  };
}

// ───────────── Guards de ciclo de vida ─────────────

/**
 * Garantiza que el producto esté instalado y en RUNNING.
 * Lanza 404 PRODUCT_NOT_INSTALLED o 503 SERVICE_STOPPED.
 */
export async function assertRunning(productId: string): Promise<void> {
  const product = await db.installedProduct.findUnique({ where: { productId } });
  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_INSTALLED", "PRODUCT_NOT_INSTALLED", "Este producto no está instalado.");
  }
  if (product.state !== "RUNNING") {
    throw new ApiError(
      503,
      "SERVICE_STOPPED",
      `Product ${productId} is not RUNNING (state=${product.state})`,
      `${product.displayName} está detenido. Inícialo para usarlo.`,
    );
  }
}

// ───────────── Contratos y configuración ─────────────

/**
 * Carga el ProductContract real del paquete firmado en la bóveda
 * (con fallback al build del catálogo si el paquete no se puede leer).
 */
export function loadContract(productId: string, version: string): ProductContract | null {
  const pkg = readPackageFile(`${productId}-${version}.albra`);
  const parsed = parseProductContract(pkg?.contract);
  if (parsed.ok && parsed.contract) return parsed.contract;
  return getContractFor(productId, version);
}

export type ProductConfigValues = ProductDetail["configValues"] & {
  secrets: Record<string, boolean>;
};

export interface ProductConfigBlock {
  configFields: ConfigFieldDTO[];
  configValues: ProductConfigValues;
}

function toFieldDTO(f: ConfigField): ConfigFieldDTO {
  return {
    key: f.key,
    label: f.label,
    scope: f.scope,
    type: f.type,
    required: f.required,
    ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
    ...(f.options ? { options: f.options } : {}),
    ...(f.description ? { description: f.description } : {}),
    systemManaged: f.systemManaged,
  };
}

/**
 * Bloque de configuración del detalle de producto: 3 scopes de ConfigRecord,
 * campos "secret" SIN valor + mapa `secrets` (fieldKey → existe en SecretStore).
 */
export async function buildProductConfig(productId: string, fields: ConfigField[]): Promise<ProductConfigBlock> {
  const scopes = await db.configRecord.findMany({ where: { productId } });
  const byScope = (scope: string): Record<string, unknown> => {
    const row = scopes.find(r => r.scope === scope);
    return { ...((row?.values ?? {}) as Record<string, unknown>) };
  };

  const configValues: ProductConfigValues = {
    USER: byScope("USER"),
    SYSTEM: byScope("SYSTEM"),
    PRODUCT: byScope("PRODUCT"),
    secrets: {},
  };

  // Campos secreto: jamás devolver valor; reportar existencia y purgar fugas.
  for (const field of fields.filter(f => f.type === "secret")) {
    const rec = await db.secretRecord.findFirst({ where: { key: field.key, productId } });
    configValues.secrets[field.key] = Boolean(rec);
    delete configValues.USER[field.key];
    delete configValues.SYSTEM[field.key];
    delete configValues.PRODUCT[field.key];
  }

  return { configFields: fields.map(toFieldDTO), configValues };
}

// ───────────── DTOs de datos de productos piloto ─────────────

export function toContactDTO(c: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  tags: string | null;
  createdAt: Date;
}): CrmContactDTO {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    tags: c.tags,
    createdAt: iso(c.createdAt) ?? "",
  };
}

const DEAL_STAGES: CrmDealDTO["stage"][] = ["NUEVO", "CONTACTADO", "PROPUESTA", "GANADO", "PERDIDO"];

export function isDealStage(stage: unknown): stage is CrmDealDTO["stage"] {
  return typeof stage === "string" && DEAL_STAGES.includes(stage as CrmDealDTO["stage"]);
}

export function toDealDTO(d: {
  id: string;
  title: string;
  contactId: string | null;
  value: number;
  stage: string;
  createdAt: Date;
}): CrmDealDTO {
  return {
    id: d.id,
    title: d.title,
    contactId: d.contactId,
    value: d.value,
    stage: (DEAL_STAGES as string[]).includes(d.stage) ? (d.stage as CrmDealDTO["stage"]) : "NUEVO",
    createdAt: iso(d.createdAt) ?? "",
  };
}

const LEAD_STATUSES: LeadDTO["status"][] = ["NUEVO", "CALIFICADO", "CONTACTADO", "DESCARTADO"];

export function isLeadStatus(status: unknown): status is LeadDTO["status"] {
  return typeof status === "string" && LEAD_STATUSES.includes(status as LeadDTO["status"]);
}

export function toLeadDTO(l: {
  id: string;
  name: string;
  company: string | null;
  source: string;
  status: string;
  score: number;
  createdAt: Date;
}): LeadDTO {
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    source: l.source,
    status: (LEAD_STATUSES as string[]).includes(l.status) ? (l.status as LeadDTO["status"]) : "NUEVO",
    score: l.score,
    createdAt: iso(l.createdAt) ?? "",
  };
}
