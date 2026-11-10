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

// ───────────────────────── Docker Compose deployment ─────────────────────────

/**
 * ORDEN MAESTRA F2 — Declaración de DESPLIEGUE DOCKER COMPOSE dentro del
 * parche de contrato de fuente. El paquete declara REFERENCIAS de imagen
 * (no digests): el INSTALADOR fija el digest real en tiempo de despliegue
 * (pull + inspect → RepoDigests) y materializa el descriptor estricto.
 */
export const ContainerDeploymentSourceSchema = z.object({
  kind: z.literal("docker-compose"),
  /** Compose del paquete (relativo al payload). Sin rutas absolutas ni traversal. */
  composeFile: z.string().refine(
    v => !v.startsWith("/") && !v.includes("\\") && v.split("/").every(s => s.length > 0 && s !== "." && s !== "..") && /\.ya?ml$/i.test(v),
    "composeFile debe ser una ruta relativa POSIX a un .yml/.yaml",
  ),
  /** .env generado por el instalador (modo 0600), relativo al directorio del producto. */
  envFile: z.string().refine(
    v => !v.startsWith("/") && !v.includes("\\") && v.split("/").every(s => s.length > 0 && s !== "." && s !== ".."),
    "envFile debe ser una ruta relativa POSIX",
  ),
  projectName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  networkName: z.literal("albra-agents").default("albra-agents"),
  /** Secretos que el INSTALADOR genera (random 32B) y custodia. Nunca del paquete. */
  generatedSecretKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)).min(1),
  /** Imágenes por servicio: referencia OCI que el instalador FIJARÁ por digest. */
  images: z.array(z.object({
    service: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
    /** Variable de interpolación del compose (p. ej. CHISMOSO_IMAGE). */
    imageVar: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    /** Referencia OCI base (repo:tag o repo@sha256:…). Sin espacios ni metacaracteres. */
    ref: z.string().min(1).refine(
      v => !/\s/.test(v) && !/[$;&|`<>\\'"]/.test(v),
      "ref debe ser una referencia OCI limpia (sin espacios ni metacaracteres de shell)",
    ),
  })).min(1),
  /** Timeout de espera de salud (segundos). */
  healthTimeoutSeconds: z.number().int().min(10).max(900).default(180),
  /** Env NO secreto que el instalador escribe en el .env generado. */
  envStatic: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/), z.string().max(500)).optional(),
  /** Secretos de la PLATAFORMA (SecretStore) inyectados en el .env del contenedor. */
  envFromPlatformSecret: z.array(z.object({
    envVar: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    /** Clave exacta en el SecretStore (p. ej. "eec.ops.token"). */
    secretKey: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/),
  })).optional(),
}).strict().superRefine((v, ctx) => {
  const seenSvc = new Set<string>(), seenVar = new Set<string>();
  for (const img of v.images) {
    if (seenSvc.has(img.service)) ctx.addIssue({ code: "custom", path: ["images"], message: `Servicio duplicado en images: ${img.service}` });
    seenSvc.add(img.service);
    if (seenVar.has(img.imageVar)) ctx.addIssue({ code: "custom", path: ["images"], message: `imageVar duplicada: ${img.imageVar}` });
    seenVar.add(img.imageVar);
  }
});
export type ContainerDeploymentSource = z.infer<typeof ContainerDeploymentSourceSchema>;

// ───────────────────────── Patch compuesto ─────────────────────────

/** Extensiones opcionales del contrato: source + runtimes + install + deployment. */
export const SourceContractPatchSchema = z.object({
  source: GithubSourceSchema.optional(),
  runtimes: z.array(RuntimeRequirementSchema).optional(),
  install: InstallScriptsPolicySchema.optional(),
  deployment: ContainerDeploymentSourceSchema.optional(),
});
export type SourceContractPatch = z.infer<typeof SourceContractPatchSchema>;

/** Parseo defensivo del parche (por ejemplo, desde manifest.metadata). */
export function parseSourceContract(raw: unknown): { ok: boolean; patch?: SourceContractPatch; errors: string[] } {
  const parsed = SourceContractPatchSchema.safeParse(raw);
  if (parsed.success) return { ok: true, patch: parsed.data, errors: [] };
  return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
}
