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
  | "START_COMPLETED" | "STOP_COMPLETED"
  | "REPAIR_STARTED" | "REPAIR_COMPLETED"
  | "UNINSTALL_STARTED" | "UNINSTALL_COMPLETED"
  | "BACKUP_CREATED" | "RESTORE_COMPLETED"
  | "CONFIG_CHANGED" | "PROVIDER_CHANGED" | "LICENSE_CHANGED"
  | "PACKAGE_VERIFIED" | "PACKAGE_REJECTED"
  | "CERTIFICATION_COMPLETED" | "CLEANROOM_RESET" | "DIAGNOSTICS_COLLECTED";

export async function audit(opts: {
  type: AuditType;
  productId?: string;
  actor?: string;
  severity?: "INFO" | "WARN" | "ERROR";
  detail?: unknown;
}): Promise<void> {
  const detail = opts.detail !== undefined ? (redactValue(opts.detail) as object) : undefined;
  await db.auditEvent.create({
    data: {
      type: opts.type,
      productId: opts.productId ?? null,
      actor: opts.actor ?? "platform",
      severity: opts.severity ?? "INFO",
      detail,
    },
  });
  await log({
    channel: "AUDIT",
    level: opts.severity === "ERROR" ? "error" : "info",
    productId: opts.productId,
    message: `AUDIT ${opts.type}`,
    data: detail,
  });
}
