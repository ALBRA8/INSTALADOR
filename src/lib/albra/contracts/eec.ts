/**
 * ALBRA — EEC Ops Contract (contrato de operaciones INSTALADOR ↔ EEC).
 *
 * LÍMITE ARQUITECTÓNICO (sección 2 del prompt maestro V2):
 * - El INSTALADOR NO se convierte en la EEC ni absorbe código de agentes.
 * - La EEC (orquestador futuro) SOLICITA operaciones al INSTALADOR mediante
 *   este contrato AUTENTICADO Y VERSIONADO; el INSTALADOR sigue siendo el
 *   ejecutor-verificador del ciclo de vida.
 * - Autenticación V1: Bearer token del SecretStore + nonce anti-replay +
 *   ventana de expiración de 5 minutos. HMAC de petición firmada por la EEC
 *   y mTLS quedan DELIMITADOS para una versión futura del contrato.
 */
import { z } from "zod";

export const EEC_OPS_CONTRACT_VERSION = "1.0.0" as const;

/** Operaciones que la EEC puede solicitar al INSTALADOR. */
export const EecOperation = z.enum([
  "INSTALL", "START", "STOP", "RESTART", "HEALTH", "UPDATE", "ROLLBACK",
  "BACKUP", "RESTORE", "UNINSTALL", "DIAGNOSTICS", "STATUS",
]);
export type EecOperation = z.infer<typeof EecOperation>;

/** UUID v4 o identificador cuid-like (alfanumérico con -/_, mínimo 8). */
const RequestId = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "requestId debe ser un UUID o identificador alfanumérico (mínimo 8 caracteres)");

const MAX_REQUEST_WINDOW_MS = 5 * 60 * 1000;

export const EecOpsRequestSchema = z
  .object({
    contractVersion: z.literal("1.0.0"),
    requestId: RequestId,
    operation: EecOperation,
    productId: z.string().min(1).max(64),
    params: z.record(z.string(), z.unknown()).optional(),
    issuedAt: z.iso.datetime({ message: "issuedAt debe ser fecha ISO 8601" }),
    expiresAt: z.iso.datetime({ message: "expiresAt debe ser fecha ISO 8601" }),
    nonce: z.string().min(16).max(128),
  })
  .refine(
    (r) => {
      const issued = Date.parse(r.issuedAt);
      const expires = Date.parse(r.expiresAt);
      return (
        Number.isFinite(issued) &&
        Number.isFinite(expires) &&
        expires > issued &&
        expires - issued <= MAX_REQUEST_WINDOW_MS
      );
    },
    {
      message: `expiresAt debe estar entre issuedAt y issuedAt + ${MAX_REQUEST_WINDOW_MS / 1000}s`,
      path: ["expiresAt"],
    },
  );

export type EecOpsRequest = z.infer<typeof EecOpsRequestSchema>;

export const EecOpsResultSchema = z.object({
  runId: z.string().optional(),
  state: z.unknown().optional(),
  health: z.unknown().optional(),
  detail: z.unknown().optional(),
});
export type EecOpsResult = z.infer<typeof EecOpsResultSchema>;

export const EecOpsResponseSchema = z.object({
  contractVersion: z.literal("1.0.0"),
  requestId: z.string(),
  accepted: z.boolean(),
  operation: EecOperation,
  productId: z.string(),
  result: EecOpsResultSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type EecOpsResponse = z.infer<typeof EecOpsResponseSchema>;

/** Códigos de error del contrato (estables para la EEC). */
export const EEC_OPS_ERROR_CODES = [
  "PRODUCT_NOT_INSTALLED",
  "PRODUCT_BUSY",
  "REQUEST_EXPIRED",
  "NONCE_REPLAYED",
  "INVALID_CONTRACT_VERSION",
  "UNSUPPORTED_OPERATION",
  "OPERATION_FAILED",
  "VALIDATION_ERROR",
] as const;
export type EecOpsErrorCode = (typeof EEC_OPS_ERROR_CODES)[number];

/** Descripción máquina-legible de una operación del contrato. */
export interface EecOpsContractEntry {
  operation: EecOperation;
  method: "POST";
  /** Resumen del schema de `params` aceptados (vacío = sin parámetros). */
  params: Record<string, { type: string; required: boolean; description: string }>;
  /** true → responde {runId} y el estado final se consulta con STATUS. */
  async: boolean;
  timeoutHintS: number;
}

/**
 * OPERATIONS_CONTRACT: descripción máquina-readable de cada operación.
 * INSTALL/UPDATE/ROLLBACK/UNINSTALL son asíncronos (devuelven runId);
 * el resto son síncronos y responden el resultado directamente.
 */
export const OPERATIONS_CONTRACT: Record<EecOperation, EecOpsContractEntry> = {
  INSTALL: {
    operation: "INSTALL",
    method: "POST",
    params: {},
    async: true,
    timeoutHintS: 900,
  },
  START: {
    operation: "START",
    method: "POST",
    params: {},
    async: false,
    timeoutHintS: 120,
  },
  STOP: {
    operation: "STOP",
    method: "POST",
    params: {},
    async: false,
    timeoutHintS: 60,
  },
  RESTART: {
    operation: "RESTART",
    method: "POST",
    params: {},
    async: false,
    timeoutHintS: 120,
  },
  HEALTH: {
    operation: "HEALTH",
    method: "POST",
    params: {},
    async: false,
    timeoutHintS: 60,
  },
  UPDATE: {
    operation: "UPDATE",
    method: "POST",
    params: {
      targetVersion: {
        type: "string (semver x.y.z)",
        required: false,
        description: "Versión destino; si se omite se usa la última disponible en la bóveda",
      },
    },
    async: true,
    timeoutHintS: 600,
  },
  ROLLBACK: {
    operation: "ROLLBACK",
    method: "POST",
    params: {},
    async: true,
    timeoutHintS: 600,
  },
  BACKUP: {
    operation: "BACKUP",
    method: "POST",
    params: {
      kind: {
        type: '"MANUAL" | "PRE_UPDATE" | "PRE_UNINSTALL"',
        required: false,
        description: "Tipo de backup (default MANUAL)",
      },
      note: { type: "string", required: false, description: "Nota descriptiva (máx 500)" },
    },
    async: false,
    timeoutHintS: 120,
  },
  RESTORE: {
    operation: "RESTORE",
    method: "POST",
    params: {
      backupId: { type: "string", required: true, description: "Id del backup a restaurar" },
    },
    async: false,
    timeoutHintS: 300,
  },
  UNINSTALL: {
    operation: "UNINSTALL",
    method: "POST",
    params: {
      dataMode: {
        type: '"KEEP" | "EXPORT" | "DELETE"',
        required: false,
        description: "Modo de datos tras desinstalar (default KEEP)",
      },
    },
    async: true,
    timeoutHintS: 600,
  },
  DIAGNOSTICS: {
    operation: "DIAGNOSTICS",
    method: "POST",
    params: {},
    async: false,
    timeoutHintS: 120,
  },
  STATUS: {
    operation: "STATUS",
    method: "POST",
    params: {},
    async: false,
    timeoutHintS: 30,
  },
};
