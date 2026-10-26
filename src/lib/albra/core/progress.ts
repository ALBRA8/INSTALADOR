/**
 * ALBRA — Progreso de instalación POR MÓDULO (barras independientes).
 *
 * Cada instalación registra una fila por elemento que participa en ella:
 *   · PROJECT    — el paquete/proyecto principal (avanza con la máquina de 16 pasos)
 *   · DEPENDENCY — dependencias declaradas en el contrato (albra-runtime, albra-database…)
 *   · RUNTIME    — runtimes requeridos por el paquete (node, python…) descubiertos en DOWNLOAD
 *   · SOURCE     — origen GitHub (cuando la instalación proviene de una fuente remota)
 *
 * El progreso se PERSISTE en InstallModuleProgress para que la GUI muestre una
 * barra independiente por módulo con % , estado y detalle del avance.
 */
import { db } from "@/lib/db";
import type { StepStatus } from "@/lib/albra/core/runs";

export type ModuleType = "PROJECT" | "DEPENDENCY" | "RUNTIME" | "SOURCE";
export type ModuleStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export interface ModuleSpec {
  moduleKey: string;
  moduleType: ModuleType;
  label: string;
  initial?: { status?: ModuleStatus; percent?: number; detail?: string };
}

// ─────────────── Mapa de avance del proyecto principal ───────────────
// % del proyecto al completarse cada paso de la máquina de estados.
const PROJECT_STEP_PERCENT: Record<string, number> = {
  DISCOVER: 4,
  PREFLIGHT: 10,
  PLAN: 14,
  CONFIRM: 18,
  LICENSE: 24, // clave de acceso validada vía API externa
  DOWNLOAD: 34,
  VERIFY: 42,
  PREPARE: 52,
  INSTALL: 64,
  CONFIGURE: 72,
  INITIALIZE: 80,
  MIGRATE: 84,
  REGISTER: 90,
  START: 95,
  HEALTH: 98,
  COMPLETE: 100,
};

// ─────────────── Reglas de avance por tipo de módulo ───────────────
interface StepRule {
  percent: number;
  detail: string;
}

const DEP_STEP_RULES: Record<string, Record<string, StepRule>> = {
  "albra-runtime": {
    PREFLIGHT: { percent: 30, detail: "Provista por ALBRA Platform" },
    INSTALL: { percent: 70, detail: "Preparada en staging" },
    START: { percent: 100, detail: "Activa en el sistema" },
  },
  "albra-database": {
    PREFLIGHT: { percent: 20, detail: "Verificada" },
    INITIALIZE: { percent: 60, detail: "Datos iniciales listos" },
    HEALTH: { percent: 100, detail: "Verificada en la comprobación de salud" },
  },
};

const DEP_DEFAULT_RULES: Record<string, StepRule> = {
  PREFLIGHT: { percent: 40, detail: "Verificada" },
  INSTALL: { percent: 80, detail: "Instalada en staging" },
  START: { percent: 100, detail: "Activa en el sistema" },
};

const RUNTIME_STEP_RULES: Record<string, StepRule> = {
  PREPARE: { percent: 50, detail: "Verificación temprana correcta" },
  INSTALL: { percent: 100, detail: "Preparado en staging" },
};

const SOURCE_STEP_RULES: Record<string, StepRule> = {
  DOWNLOAD: { percent: 100, detail: "Descargado y verificado en la bóveda" },
};

interface Row {
  moduleKey: string;
  moduleType: ModuleType;
  label: string;
  status: ModuleStatus;
  percent: number;
  detail?: string;
  order: number;
}

export class ModuleProgressTracker {
  private rows = new Map<string, Row>();

  private constructor(public readonly runId: string) {}

  /** Crea las filas iniciales en DB e hidrata el tracker. */
  static async create(runId: string, specs: ModuleSpec[]): Promise<ModuleProgressTracker> {
    const t = new ModuleProgressTracker(runId);
    if (specs.length === 0) return t;
    specs.forEach((s, i) => {
      if (!t.rows.has(s.moduleKey)) {
        t.rows.set(s.moduleKey, {
          moduleKey: s.moduleKey,
          moduleType: s.moduleType,
          label: s.label,
          status: s.initial?.status ?? "PENDING",
          percent: s.initial?.percent ?? 0,
          detail: s.initial?.detail,
          order: i,
        });
      }
    });
    try {
      await db.installModuleProgress.createMany({
        data: [...t.rows.values()].map(r => ({
          runId,
          moduleKey: r.moduleKey,
          moduleType: r.moduleType,
          label: r.label,
          status: r.status,
          percent: r.percent,
          detail: r.detail ?? null,
          order: r.order,
        })),
      });
    } catch {
      /* best-effort: el progreso no debe bloquear la instalación */
    }
    return t;
  }

  /** Registra módulos descubiertos a mitad de instalación (p.ej. runtimes del manifest). */
  async addModules(specs: ModuleSpec[]): Promise<void> {
    let nextOrder = this.rows.size;
    const fresh: Row[] = [];
    for (const s of specs) {
      if (this.rows.has(s.moduleKey)) continue;
      const row: Row = {
        moduleKey: s.moduleKey,
        moduleType: s.moduleType,
        label: s.label,
        status: s.initial?.status ?? "PENDING",
        percent: s.initial?.percent ?? 0,
        detail: s.initial?.detail,
        order: nextOrder++,
      };
      this.rows.set(s.moduleKey, row);
      fresh.push(row);
    }
    if (fresh.length === 0) return;
    try {
      await db.installModuleProgress.createMany({
        data: fresh.map(r => ({ runId: this.runId, ...r, detail: r.detail ?? null })),
      });
    } catch {
      /* best-effort */
    }
  }

  /** Se llama justo después de completar cada paso del instalador. */
  async afterStep(step: string, status: StepStatus, detail?: string): Promise<void> {
    if (status === "FAILURE") return; // el fallo se maneja con fail()
    for (const row of this.rows.values()) {
      let rule: StepRule | undefined;
      switch (row.moduleType) {
        case "PROJECT":
          rule = PROJECT_STEP_PERCENT[step] !== undefined
            ? { percent: PROJECT_STEP_PERCENT[step], detail: detail ?? row.detail ?? "" }
            : undefined;
          break;
        case "DEPENDENCY":
          rule = (DEP_STEP_RULES[row.moduleKey] ?? DEP_DEFAULT_RULES)[step];
          break;
        case "RUNTIME":
          rule = RUNTIME_STEP_RULES[step];
          break;
        case "SOURCE":
          rule = SOURCE_STEP_RULES[step];
          break;
      }
      if (!rule) continue;
      // Nunca retroceder el porcentaje ya alcanzado.
      if (rule.percent <= row.percent && row.status !== "PENDING") continue;
      row.percent = Math.max(row.percent, rule.percent);
      row.status = row.percent >= 100 ? "SUCCESS" : "RUNNING";
      if (row.status === "RUNNING" && rule.detail) row.detail = rule.detail;
      if (row.status === "SUCCESS") row.detail = rule.detail ?? detail ?? row.detail;
      await this.persist(row);
    }
  }

  /** Marca el estado final de todos los módulos ante un fallo de la instalación. */
  async fail(message: string): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.status === "SUCCESS") continue;
      const wasTouched = row.percent > 0 || row.status === "RUNNING";
      row.status = wasTouched ? "FAILED" : "SKIPPED";
      row.detail = wasTouched ? `Interrumpido: ${message}` : "No alcanzado (instalación interrumpida)";
      row.percent = wasTouched ? Math.min(row.percent, 99) : 0;
      await this.persist(row, true);
    }
  }

  /** Marca el estado final exitoso (módulos restantes → completados). */
  async complete(): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.status === "FAILED" || row.status === "SKIPPED") continue;
      if (row.percent < 100) {
        row.percent = 100;
        row.status = "SUCCESS";
        row.detail = row.detail ?? "Completado";
      }
      await this.persist(row, true);
    }
  }

  private async persist(row: Row, finished = false): Promise<void> {
    try {
      await db.installModuleProgress.updateMany({
        where: { runId: this.runId, moduleKey: row.moduleKey },
        data: {
          status: row.status,
          percent: row.percent,
          detail: row.detail ?? null,
          ...(finished ? { finishedAt: new Date() } : {}),
        },
      });
    } catch {
      /* best-effort */
    }
  }
}

/** Filas de progreso de un run, ordenadas para la UI. */
export async function listInstallModules(runId: string) {
  return db.installModuleProgress.findMany({
    where: { runId },
    orderBy: [{ order: "asc" }],
  });
}
