/**
 * ALBRA — EEC Ops Engine (ejecutor del contrato de operaciones).
 *
 * La EEC NO vive aquí: este módulo solo VALIDA solicitudes del contrato
 * (contracts/eec.ts), las AUTENTICA (bearer + expiración + nonce) y las
 * DESPACHA a los motores reales del INSTALADOR. Cada solicitud queda
 * auditada (OPS_EXECUTED / OPS_REJECTED). Nunca se registran ni devuelven
 * resultados inventados: las operaciones asíncronas responden {runId} y el
 * estado final se consulta con STATUS (evidencia real del SO).
 */
import crypto from "crypto";
import { z } from "zod";
import { getSecret, putSecret } from "@/lib/albra/core/secrets";
import { audit } from "@/lib/albra/core/audit";
import { getInstalled } from "@/lib/albra/core/registry";
import {
  startProduct, stopProduct, restartProduct, getRuntimeEvidence,
} from "@/lib/albra/core/runtime";
import { runHealthChecks, latestHealth } from "@/lib/albra/core/health";
import { runInstall } from "@/lib/albra/core/installer";
import { runUpdate, rollbackLastUpdate } from "@/lib/albra/core/updater";
import { runUninstall } from "@/lib/albra/core/uninstaller";
import { createBackup, restoreBackup } from "@/lib/albra/core/backup";
import { collectDiagnostics } from "@/lib/albra/core/diagnostics";
import { getLatestVersion } from "@/lib/albra/products/catalog";
import type { DataMode } from "@/lib/albra/contracts";
import {
  EEC_OPS_CONTRACT_VERSION,
  EecOperation,
  EecOpsRequestSchema,
  EEC_OPS_ERROR_CODES,
  OPERATIONS_CONTRACT,
  type EecOpsErrorCode,
  type EecOpsResponse,
  type EecOpsResult,
} from "@/lib/albra/contracts/eec";

// ───────────────────────── Token de operaciones ─────────────────────────

export const OPS_TOKEN_KEY = "eec.ops.token";
/** productId del SecretRecord para secretos de plataforma (no de un producto). */
const OPS_TOKEN_SCOPE = "platform";

/**
 * Devuelve el token de operaciones, generándolo y persistiéndolo cifrado
 * (AES-256-GCM en SecretRecord) si aún no existe. NUNCA loguear el valor.
 * Se usa productId="platform" (y no null) para que putSecret/getSecret
 * compartan la MISMA clave única (key, productId).
 */
export async function getOpsToken(): Promise<string> {
  const existing = await getSecret(OPS_TOKEN_KEY, OPS_TOKEN_SCOPE);
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString("hex");
  await putSecret(OPS_TOKEN_KEY, token, OPS_TOKEN_SCOPE, "Token Bearer del contrato de operaciones EEC");
  return token;
}

/** ¿Existe ya el token? (solo lectura: NO lo genera). */
export async function hasOpsToken(): Promise<boolean> {
  return (await getSecret(OPS_TOKEN_KEY, OPS_TOKEN_SCOPE)) !== null;
}

/** Rota el token (regenera + guarda) y lo devuelve UNA vez. Operación admin auditada. */
export async function rotateOpsToken(): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await putSecret(OPS_TOKEN_KEY, token, OPS_TOKEN_SCOPE, "Token Bearer del contrato de operaciones EEC");
  return token;
}

/** Comparación en tiempo constante (digests sha256 → misma longitud). */
export function verifyOpsToken(provided: string, expected: string): boolean {
  if (provided.length === 0 || expected.length === 0) return false;
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// ───────────────────────── Nonce replay guard ─────────────────────────

/** nonce → expiresAt (ms). En memoria por instancia del INSTALADOR. */
const nonceRegistry = new Map<string, number>();

function sweepNonces(now: number): void {
  for (const [nonce, expiresAt] of nonceRegistry) {
    if (expiresAt <= now) nonceRegistry.delete(nonce);
  }
}

// ───────────────────────── Mapeo de errores → contrato ─────────────────────────

const CONTRACT_ERROR_MAP: Record<string, EecOpsErrorCode> = {
  PRODUCT_NOT_INSTALLED: "PRODUCT_NOT_INSTALLED",
  PRODUCT_BUSY: "PRODUCT_BUSY",
  REQUEST_EXPIRED: "REQUEST_EXPIRED",
  NONCE_REPLAYED: "NONCE_REPLAYED",
  INVALID_CONTRACT_VERSION: "INVALID_CONTRACT_VERSION",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
};

function toContractError(e: unknown): { code: EecOpsErrorCode; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  const direct = CONTRACT_ERROR_MAP[message];
  if (direct) return { code: direct, message };
  return { code: "OPERATION_FAILED", message };
}

// ───────────────────────── Schemas de params por operación ─────────────────────────

const UpdateParams = z.object({
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "targetVersion debe ser semver (x.y.z)").optional(),
});
const UninstallParams = z.object({
  dataMode: z.enum(["KEEP", "EXPORT", "DELETE"]).default("KEEP"),
});
const BackupParams = z.object({
  kind: z.enum(["PRE_UPDATE", "MANUAL", "PRE_UNINSTALL"]).default("MANUAL"),
  note: z.string().max(500).optional(),
});
const RestoreParams = z.object({ backupId: z.string().min(1) });

// ───────────────────────── executeOps ─────────────────────────

interface Rejection {
  contractVersion: typeof EEC_OPS_CONTRACT_VERSION;
  requestId: string;
  accepted: false;
  operation: string;
  productId: string;
  error: { code: EecOpsErrorCode; message: string };
}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue?.message ?? "solicitud inválida"}`;
}

/**
 * Ejecuta una solicitud del contrato EEC. El resultado SIEMPRE respeta
 * EecOpsResponseSchema (excepto `operation` en rechazos previos al parseo,
 * donde se repite textualmente la operación solicitada para auditabilidad).
 */
export async function executeOps(raw: unknown, actor = "EEC"): Promise<EecOpsResponse | Rejection> {
  const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const reqId = typeof rec.requestId === "string" && rec.requestId.length > 0 ? rec.requestId : "unknown";
  const opText = typeof rec.operation === "string" ? rec.operation : "unknown";
  const productId = typeof rec.productId === "string" && rec.productId.length > 0 ? rec.productId : "unknown";
  const auditProductId = productId === "unknown" ? undefined : productId;

  const reject = async (code: EecOpsErrorCode, message: string): Promise<Rejection> => {
    await audit({
      type: "OPS_REJECTED",
      actor,
      productId: auditProductId,
      severity: "WARNING",
      detail: { operation: opText, requestId: reqId, code },
    });
    return { contractVersion: EEC_OPS_CONTRACT_VERSION, requestId: reqId, accepted: false, operation: opText, productId, error: { code, message } };
  };

  // 1) Versión del contrato (código específico antes del parseo general)
  if (rec.contractVersion !== undefined && rec.contractVersion !== EEC_OPS_CONTRACT_VERSION) {
    return reject("INVALID_CONTRACT_VERSION", `contractVersion soportada: ${EEC_OPS_CONTRACT_VERSION}; recibida: ${String(rec.contractVersion)}`);
  }

  // 2) Operación soportada
  if (typeof rec.operation === "string" && !(EecOperation.options as readonly string[]).includes(rec.operation)) {
    return reject("UNSUPPORTED_OPERATION", `Operación no soportada: ${rec.operation}`);
  }

  // 3) Schema del contrato
  const parsed = EecOpsRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return reject("VALIDATION_ERROR", firstIssueMessage(parsed.error));
  }
  const request = parsed.data;

  // 4) Expiración (ventana ≤ 5 min ya garantizada por el schema)
  const now = Date.now();
  if (Date.parse(request.expiresAt) < now) {
    return reject("REQUEST_EXPIRED", `Solicitud ${request.requestId} expiró en ${request.expiresAt}`);
  }

  // 5) Nonce anti-replay
  sweepNonces(now);
  if (nonceRegistry.has(request.nonce)) {
    return reject("NONCE_REPLAYED", `Nonce ya utilizado (requestId ${request.requestId})`);
  }
  nonceRegistry.set(request.nonce, Date.parse(request.expiresAt));

  // 6) Despacho a los motores REALES del INSTALADOR
  const ok = (result: EecOpsResult): EecOpsResponse => ({
    contractVersion: EEC_OPS_CONTRACT_VERSION,
    requestId: request.requestId,
    accepted: true,
    operation: request.operation,
    productId: request.productId,
    ...(Object.keys(result).length > 0 ? { result } : {}),
  });

  try {
    let result: EecOpsResult;
    switch (request.operation) {
      case "INSTALL": {
        // Asíncrono: responde runId; el estado final se consulta con STATUS.
        const { runId } = await runInstall(request.productId);
        result = { runId };
        break;
      }
      case "START": {
        const res = await startProduct(request.productId);
        if (!res.ok) throw new Error(res.error ?? "START_FAILED");
        result = { state: { state: "RUNNING", pid: res.pid ?? null, port: res.port ?? null }, detail: res.detail };
        break;
      }
      case "STOP": {
        const res = await stopProduct(request.productId);
        if (!res.ok) throw new Error(res.error ?? "STOP_FAILED");
        result = { state: { state: "STOPPED" }, detail: res.detail };
        break;
      }
      case "RESTART": {
        const res = await restartProduct(request.productId);
        if (!res.ok) throw new Error(res.error ?? "RESTART_FAILED");
        result = { state: { state: "RUNNING", pid: res.pid ?? null, port: res.port ?? null }, detail: res.detail };
        break;
      }
      case "HEALTH": {
        const health = await runHealthChecks(request.productId);
        result = { health };
        break;
      }
      case "UPDATE": {
        const params = UpdateParams.safeParse(request.params ?? {});
        if (!params.success) return reject("VALIDATION_ERROR", firstIssueMessage(params.error));
        const targetVersion = params.data.targetVersion ?? getLatestVersion(request.productId);
        if (!targetVersion) {
          return reject("OPERATION_FAILED", `No hay versión destino disponible para ${request.productId}; indica params.targetVersion`);
        }
        const { runId } = await runUpdate(request.productId, targetVersion);
        result = { runId, detail: { targetVersion } };
        break;
      }
      case "ROLLBACK": {
        const { runId } = await rollbackLastUpdate(request.productId);
        result = { runId };
        break;
      }
      case "BACKUP": {
        const params = BackupParams.safeParse(request.params ?? {});
        if (!params.success) return reject("VALIDATION_ERROR", firstIssueMessage(params.error));
        const { id } = await createBackup(request.productId, params.data.kind, params.data.note);
        result = { detail: { backupId: id, kind: params.data.kind } };
        break;
      }
      case "RESTORE": {
        const params = RestoreParams.safeParse(request.params ?? {});
        if (!params.success) return reject("VALIDATION_ERROR", firstIssueMessage(params.error));
        const res = await restoreBackup(params.data.backupId);
        if (!res.ok) throw new Error(res.error ?? "RESTORE_FAILED");
        result = { detail: { backupId: params.data.backupId, restored: true } };
        break;
      }
      case "UNINSTALL": {
        const params = UninstallParams.safeParse(request.params ?? {});
        if (!params.success) return reject("VALIDATION_ERROR", firstIssueMessage(params.error));
        const res = await runUninstall(request.productId, params.data.dataMode as DataMode);
        result = { runId: res.runId, ...(res.exportPath ? { detail: { exportPath: res.exportPath } } : {}) };
        break;
      }
      case "DIAGNOSTICS": {
        const bundle = await collectDiagnostics(request.productId);
        result = { detail: bundle };
        break;
      }
      case "STATUS": {
        const installed = await getInstalled(request.productId);
        if (!installed) throw new Error("PRODUCT_NOT_INSTALLED");
        const evidence = await getRuntimeEvidence(request.productId);
        const snapshot = await latestHealth(request.productId);
        result = {
          state: {
            productId: installed.productId,
            displayName: installed.displayName,
            version: installed.version,
            state: installed.state,
            health: installed.health,
            pid: installed.pid,
            port: installed.port,
            osState: evidence.osState,
            evidence: {
              pid: evidence.pid ?? null,
              port: evidence.port ?? null,
              startedAt: evidence.startedAt ?? null,
              uptimeS: evidence.uptimeS ?? null,
              identityVerified: evidence.identityVerified ?? null,
              portServing: evidence.portServing ?? null,
              healthProbe: evidence.healthProbe ?? null,
              lastHeartbeatAt: evidence.lastHeartbeatAt ?? null,
            },
            lastExitEvidence: installed.lastExitEvidence,
            lastHealthAt: installed.lastHealthAt ? installed.lastHealthAt.toISOString() : null,
            lastHealthSnapshot: snapshot
              ? { overall: snapshot.overall, at: snapshot.createdAt.toISOString() }
              : null,
          },
        };
        break;
      }
    }

    await audit({
      type: "OPS_EXECUTED",
      actor,
      productId: request.productId,
      detail: { operation: request.operation, requestId: request.requestId, ...(result.runId ? { runId: result.runId } : {}) },
    });
    return ok(result);
  } catch (e) {
    const mapped = toContractError(e);
    await audit({
      type: "OPS_REJECTED",
      actor,
      productId: request.productId,
      severity: "ERROR",
      detail: { operation: request.operation, requestId: request.requestId, code: mapped.code, reason: mapped.message },
    });
    return {
      contractVersion: EEC_OPS_CONTRACT_VERSION,
      requestId: request.requestId,
      accepted: false,
      operation: request.operation,
      productId: request.productId,
      error: mapped,
    };
  }
}

// ───────────────────────── describeContract ─────────────────────────

export function describeContract() {
  return {
    contractVersion: EEC_OPS_CONTRACT_VERSION,
    name: "ALBRA INSTALADOR · EEC Ops Contract",
    description:
      "Contrato autenticado y versionado para que la EEC SOLICITE operaciones de ciclo de vida al INSTALADOR. " +
      "El INSTALADOR ejecuta y verifica (evidencia real del SO); no absorbe ni aloja código de agentes de la EEC.",
    operations: Object.values(OPERATIONS_CONTRACT),
    errors: EEC_OPS_ERROR_CODES,
    auth: {
      scheme: "Bearer",
      header: "Authorization: Bearer <ops-token>",
      tokenSource:
        "SecretStore del INSTALADOR: SecretRecord key='eec.ops.token' (productId='platform', cifrado AES-256-GCM). " +
        "El admin lo obtiene/rota con POST /api/ops/token {confirm:true} — se devuelve UNA sola vez y no hay GET.",
      requestWindow: "expiresAt ≤ issuedAt + 5 min; fuera de ventana → REQUEST_EXPIRED",
      antiReplay: "nonce único (mín 16 caracteres) por solicitud; repetido → NONCE_REPLAYED",
      rejections: "HTTP 200 con accepted:false y error.code del contrato (los fallos de autenticación responden 401 OPS_UNAUTHORIZED)",
      future: "DELIMITADO: HMAC de petición firmada por la EEC y mTLS llegarán en una versión futura del contrato",
    },
  };
}
