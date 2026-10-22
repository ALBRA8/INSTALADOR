/**
 * ALBRA — Audit trail (Security Contract).
 * Eventos mínimos obligatorios del estándar ALBRA.
 */
import { db } from "@/lib/db";
import { redactValue } from "@/lib/albra/core/secrets";
import { log } from "@/lib/albra/core/logger";

export type AuditType =
  | "INSTALL_STARTED" | "INSTALL_COMPLETED" | "INSTALL_FAILED"
  | "UPDATE_STARTED" | "UPDATE_COMPLETED" | "UPDATE_FAILED" | "UPDATE_ROLLED_BACK"
  | "START_COMPLETED" | "STOP_COMPLETED" | "START_FAILED" | "STOP_FAILED"
  | "REPAIR_STARTED" | "REPAIR_COMPLETED"
  | "UNINSTALL_STARTED" | "UNINSTALL_COMPLETED"
  | "BACKUP_CREATED" | "RESTORE_COMPLETED"
  | "CONFIG_CHANGED" | "PROVIDER_CHANGED" | "LICENSE_CHANGED"
  | "PACKAGE_VERIFIED" | "PACKAGE_REJECTED" | "PACKAGE_IMPORTED"
  | "SOURCE_RESOLVED"
  | "PROCESS_ADOPTED" | "PROCESS_CRASHED" | "PROCESS_LOST" | "PROCESS_IDENTITY_MISMATCH"
  | "CERTIFICATION_COMPLETED" | "CLEANROOM_RESET" | "DIAGNOSTICS_COLLECTED"
  | "OPS_EXECUTED" | "OPS_REJECTED"
  | "KEY_GENERATED" | "KEY_REVOKED" | "TRUST_POLICY_CHANGED";

export async function audit(opts: {
  type: AuditType;
  productId?: string;
  actor?: string;
  severity?: "INFO" | "WARN" | "ERROR" | "WARNING" | "CRITICAL";
  detail?: unknown;
}): Promise<void> {
  // Normalización de severidades extendidas (runtime real usa WARNING/CRITICAL)
  const sev = opts.severity === "WARNING" ? "WARN" : opts.severity === "CRITICAL" ? "ERROR" : (opts.severity ?? "INFO");
  const detail = opts.detail !== undefined ? (redactValue(opts.detail) as object) : undefined;
  await db.auditEvent.create({
    data: {
      type: opts.type,
      productId: opts.productId ?? null,
      actor: opts.actor ?? "platform",
      severity: sev,
      detail,
    },
  });
  await log({
    channel: "AUDIT",
    level: sev === "ERROR" ? "error" : "info",
    productId: opts.productId,
    message: `AUDIT ${opts.type}`,
    data: detail,
  });
}
