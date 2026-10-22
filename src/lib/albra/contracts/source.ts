/**
 * ALBRA — V2 WAVE C: EXTENSIONES DE CONTRATO PARA FUENTES EXTERNAS (GitHub).
 *
 * Este módulo NO reemplaza a contracts/index.ts: define el parche aditivo que
 * un paquete puede declarar en `manifest.metadata` para expresar:
 *   - source:   origen GitHub con versión FIJADA (nunca rama),
 *   - runtimes: requisitos de runtime para la preparación de dependencias,
 *   - install:  política de scripts de instalación (BLOCKED por defecto).
 *
 * Reglas de seguridad:
 *   - refType "branch" se RECHAZA en el esquema (una rama no es una versión).
 *   - refs "main"/"master"/"develop" y cabezas de rama (refs/heads/*) se
 *     rechazan con error claro BRANCH_REF_REJECTED.
 */
import { z } from "zod";

// ───────────────────────── GitHub Source ─────────────────────────

const GITHUB_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;

/** Ramas por defecto que NUNCA se aceptan como ref de instalación. */
const DEFAULT_BRANCHES = new Set(["main", "master", "develop"]);

export type GithubRefType = "release" | "tag" | "commit";

/**
 * Devuelve el mensaje de rechazo si la ref apunta a la cabeza de una rama
 * (móvil, no reproducible); null si la ref es fijable.
 */
export function branchRefProblem(ref: string): string | null {
  const r = ref.trim();
  if (/^refs\/heads\//i.test(r) || /^heads\//i.test(r)) {
    return `BRANCH_REF_REJECTED — '${r}' es la cabeza de una rama (móvil). Fija una versión: release, tag o commit.`;
  }
  if (DEFAULT_BRANCHES.has(r.toLowerCase())) {
    return `BRANCH_REF_REJECTED — '${r}' es una rama móvil por defecto. ALBRA solo instala versiones fijadas: release, tag o commit.`;
  }
  return null;
}

/**
 * Validación de refs: rechaza "main"/"master"/"develop" y cabezas de rama.
 * Uso: `const v = validateSourceRef(ref); if (!v.ok) throw ...`
 */
export function validateSourceRef(
  ref: string,
  refType?: string,
): { ok: true } | { ok: false; code: "BRANCH_REF_REJECTED"; message: string } {
  if (refType === "branch") {
    return {
      ok: false,
      code: "BRANCH_REF_REJECTED",
      message: "BRANCH_REF_REJECTED — refType 'branch' no permitido: una rama no es una versión fijada. Usa release | tag | commit.",
    };
  }
  const problem = branchRefProblem(ref);
  if (problem) return { ok: false, code: "BRANCH_REF_REJECTED", message: problem };
  return { ok: true };
}

/**
 * Esquema de origen GitHub. refType "branch" queda RECHAZADO en el esquema:
 * se acepta como string para poder emitir un error claro BRANCH_REF_REJECTED
 * (en lugar del genérico de un enum) y se normaliza al tipo estrecho después.
 */
export const GithubSourceSchema = z
  .object({
    repo: z.string().regex(GITHUB_REPO_RE, "repo debe tener formato 'owner/name'"),
    refType: z.string().min(1, "refType requerido (release | tag | commit)"),
    ref: z.string().min(1, "ref requerido (tag de release, tag de git o sha de commit)"),
    assetName: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.refType === "branch") {
      ctx.addIssue({
        code: "custom",
        path: ["refType"],
        message: "BRANCH_REF_REJECTED — refType 'branch' no permitido: una rama no es una versión fijada. Usa release | tag | commit.",
      });
      return;
    }
    if (v.refType !== "release" && v.refType !== "tag" && v.refType !== "commit") {
      ctx.addIssue({ code: "custom", path: ["refType"], message: "refType debe ser release | tag | commit" });
    }
    const problem = branchRefProblem(v.ref);
    if (problem) ctx.addIssue({ code: "custom", path: ["ref"], message: problem });
  })
  .transform((v) => ({ ...v, refType: v.refType as GithubRefType }));

export type GithubSource = z.infer<typeof GithubSourceSchema>;

// ───────────────────────── Runtime requirements ─────────────────────────

export const RuntimeRequirementSchema = z.object({
  id: z.enum(["node", "bun", "python"]),
  /** Rango semver declarado por el editor: ">=20", "20.x", "3.11.8"... */
  semver: z.string().min(1, "semver requerido (p. ej. '>=20')"),
  required: z.boolean().default(true),
});
export type RuntimeRequirement = z.infer<typeof RuntimeRequirementSchema>;

// ───────────────────────── Install scripts policy ─────────────────────────

export const InstallScriptsPolicySchema = z.object({
  scripts: z
    .array(
      z.object({
        path: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
  /** El paquete DECLARA su política; la aprobación efectiva vive en PlatformState. */
  policy: z.enum(["BLOCKED", "APPROVED"]).default("BLOCKED"),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
});
export type InstallScriptsPolicy = z.infer<typeof InstallScriptsPolicySchema>;

// ───────────────────────── Patch compuesto ─────────────────────────

/** Extensiones opcionales del contrato: source + runtimes + install. */
export const SourceContractPatchSchema = z.object({
  source: GithubSourceSchema.optional(),
  runtimes: z.array(RuntimeRequirementSchema).optional(),
  install: InstallScriptsPolicySchema.optional(),
});
export type SourceContractPatch = z.infer<typeof SourceContractPatchSchema>;

/** Parseo defensivo del parche (por ejemplo, desde manifest.metadata). */
export function parseSourceContract(raw: unknown): { ok: boolean; patch?: SourceContractPatch; errors: string[] } {
  const parsed = SourceContractPatchSchema.safeParse(raw);
  if (parsed.success) return { ok: true, patch: parsed.data, errors: [] };
  return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
}
