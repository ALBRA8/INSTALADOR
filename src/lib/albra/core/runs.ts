/**
 * ALBRA — Run tracking: toda operación de ciclo de vida es OBSERVABLE.
 * Cada run registra pasos con estado y timestamps, persistidos en DB
 * para que la UI los muestre en vivo (polling).
 */
import { db } from "@/lib/db";
import { redactValue } from "@/lib/albra/core/secrets";

export type StepStatus = "PENDING" | "RUNNING" | "SUCCESS" | "WARNING" | "FAILURE" | "SKIPPED";

export interface RunStep {
  step: string;
  label: string;
  status: StepStatus;
  detail?: string;
  at?: string;
  durationMs?: number;
}

export class Run {
  id!: string;
  productId!: string | null;
  operation!: string;
  steps: RunStep[] = [];

  static async create(operation: string, productId: string | null, steps: Array<{ step: string; label: string }>): Promise<Run> {
    const run = new Run();
    run.productId = productId;
    run.operation = operation;
    run.steps = steps.map(s => ({ ...s, status: "PENDING" as StepStatus }));
    const row = await db.lifecycleRun.create({
      data: { operation, productId, steps: run.steps as unknown as object[] },
    });
    run.id = row.id;
    return run;
  }

  async begin(step: string): Promise<void> {
    const s = this.steps.find(x => x.step === step);
    if (!s) return;
    s.status = "RUNNING";
    s.at = new Date().toISOString();
    await this.persist();
  }

  async done(step: string, status: StepStatus, detail?: string): Promise<void> {
    const s = this.steps.find(x => x.step === step);
    if (!s) return;
    s.status = status;
    if (detail) s.detail = detail;
    if (s.at) s.durationMs = Date.now() - new Date(s.at).getTime();
    await this.persist();
  }

  async finish(status: "SUCCESS" | "WARNING" | "FAILURE" | "ROLLED_BACK", result?: unknown, error?: string): Promise<void> {
    await db.lifecycleRun.update({
      where: { id: this.id },
      data: {
        status,
        steps: redactValue(this.steps) as object[],
        result: result !== undefined ? (redactValue(result) as object) : undefined,
        error,
        finishedAt: new Date(),
      },
    });
  }

  private async persist(): Promise<void> {
    await db.lifecycleRun.update({
      where: { id: this.id },
      data: { steps: this.steps as unknown as object[] },
    });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Registro de promesas de runs para await server-side (certification). */
const runPromises = new Map<string, Promise<void>>();

export function registerRunPromise(id: string, p: Promise<void>): void {
  const safe = p.catch(() => undefined);
  runPromises.set(id, safe);
  safe.finally(() => runPromises.delete(id)).catch(() => undefined);
}

export async function awaitRun(id: string): Promise<void> {
  await (runPromises.get(id) ?? Promise.resolve());
}

export async function getRun(id: string) {
  return db.lifecycleRun.findUnique({ where: { id } });
}

export async function listRuns(productId?: string, limit = 20) {
  return db.lifecycleRun.findMany({
    where: productId ? { productId } : {},
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
