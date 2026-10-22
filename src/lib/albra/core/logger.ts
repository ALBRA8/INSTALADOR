/**
 * ALBRA — Structured logging (USER / SYSTEM / DEBUG / AUDIT channels).
 * Los datos se redactan antes de persistir.
 */
import { db } from "@/lib/db";
import { redactValue } from "@/lib/albra/core/secrets";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogChannel = "USER" | "SYSTEM" | "DEBUG" | "AUDIT";

export async function log(opts: {
  level?: LogLevel;
  channel?: LogChannel;
  productId?: string;
  message: string;
  data?: unknown;
}): Promise<void> {
  try {
    await db.logEntry.create({
      data: {
        level: opts.level ?? "info",
        channel: opts.channel ?? "SYSTEM",
        productId: opts.productId ?? null,
        message: opts.message,
        data: opts.data !== undefined ? (redactValue(opts.data) as object) : undefined,
      },
    });
  } catch {
    // El logger nunca debe romper la operación principal.
  }
}

export async function logMany(entries: Array<Parameters<typeof log>[0]>): Promise<void> {
  await Promise.all(entries.map(e => log(e)));
}
