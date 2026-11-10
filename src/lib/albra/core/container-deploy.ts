/**
 * ALBRA — ORDEN MAESTRA F2: MOTOR DE DESPLIEGUE DOCKER COMPOSE.
 *
 * Integra en el flujo principal los componentes existentes:
 *   - adapters/docker-compose.ts  (driver argv-only, sin shell)
 *   - contracts/docker-compose.ts (descriptor estricto por digest)
 *   - contracts/source.ts         (ContainerDeploymentSource: refs → pin)
 *   - core/docker-env.ts          (generación de secretos 0600, O_EXCL)
 *   - core/registry.ts            (ContainerDeployment persistido en Prisma)
 *   - core/container-lifecycle.ts (START/STOP/RESTART/STATUS/HEALTH)
 *
 * Propiedades:
 *   - FAIL-CLOSED: sin Docker/Compose v2, sin digest fijable o sin salud → error.
 *   - NUNCA borra volúmenes como mecanismo normal: uninstall distingue
 *     retirar servicios (down sin -v) de eliminar datos (purgeData explícito).
 *   - Imágenes SIEMPRE fijadas por digest SHA-256 antes del `up`.
 *   - Sin shell: sustitución de imágenes por texto acotado a la línea `image:`.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  dockerComposePreflight,
  ensureAlbraAgentNetwork,
  parseDockerComposePs,
  runDockerCompose,
} from "@/lib/albra/adapters/docker-compose";
import { parseDockerComposeDeployment, type DockerComposeDeployment } from "@/lib/albra/contracts/docker-compose";
import type { ContainerDeploymentSource } from "@/lib/albra/contracts/source";
import { createGeneratedDockerEnvFile } from "@/lib/albra/core/docker-env";
import { registerContainerDeployment, updateContainerDeploymentState } from "@/lib/albra/core/registry";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";
import { PATHS } from "@/lib/albra/env";

const execFileP = promisify(execFile);
const DIGEST_RE = /^([A-Za-z0-9][A-Za-z0-9_./-]*)@sha256:([a-f0-9]{64})$/;

/** Inyección de dependencias para pruebas (sin Docker real en CI). */
export interface DockerRunner {
  exec(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

const realRunner: DockerRunner = {
  async exec(args: string[]) {
    try {
      const r = await execFileP("docker", args, {
        timeout: 600_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, DOCKER_CLI_HINTS: "false" },
      });
      return { ok: true, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: err.stdout ?? "", stderr: (err.stderr ?? err.message ?? "docker failed").slice(0, 4000) };
    }
  },
};

export class ContainerDeployError extends Error {
  code: string;
  userMessage?: string;
  constructor(code: string, message: string, userMessage?: string) {
    super(message);
    this.code = code;
    this.userMessage = userMessage;
  }
}

/** Directorio gestionado del producto (mismo layout que el instalador local). */
export function containerProductDir(productId: string): string {
  return path.join(PATHS.products, productId, "app");
}

// Alias semántico para el flujo de instalación del motor.
export { dockerComposePreflight as dockerComposePreflightForInstall } from "@/lib/albra/adapters/docker-compose";

// ───────────────────────── Fijado de imágenes por digest ─────────────────────────

/**
 * Fija el digest REAL de una referencia OCI: docker pull + inspect RepoDigests.
 * FALLA si la referencia no puede fijarse (nunca despliega tags móviles).
 */
export async function pinImageDigest(runner: DockerRunner, ref: string): Promise<string> {
  if (DIGEST_RE.test(ref)) return ref; // ya fijada
  const pull = await runner.exec(["pull", ref]);
  if (!pull.ok) {
    throw new ContainerDeployError(
      "IMAGE_PULL_FAILED",
      `No se pudo descargar la imagen '${ref}': ${pull.stderr.slice(0, 300)}`,
      `La imagen '${ref}' no pudo descargarse para fijar su digest.`,
    );
  }
  const inspect = await runner.exec(["image", "inspect", "--format", "{{index .RepoDigests 0}}", ref]);
  const digest = inspect.stdout.trim().split("\n")[0]?.trim() ?? "";
  if (!inspect.ok || !DIGEST_RE.test(digest)) {
    throw new ContainerDeployError(
      "IMAGE_DIGEST_UNRESOLVABLE",
      `No se pudo fijar el digest de '${ref}' (RepoDigests vacío). La imagen debe publicarse en un registro.`,
      `La imagen '${ref}' no tiene digest de registro: publica la imagen y reintenta.`,
    );
  }
  return digest;
}

/**
 * Sustituye la interpolación `image: ${VAR:?…}` de un compose por la imagen
 * fijada. Solo toca la línea `image:` de la variable declarada — nunca otra
 * parte del YAML.
 */
export function materializeComposeWithDigests(
  composeYaml: string,
  pinned: Array<{ imageVar: string; digest: string }>,
): string {
  let out = composeYaml;
  for (const { imageVar, digest } of pinned) {
    const re = new RegExp(`(image:\\s*)\\$\\{${imageVar}(?::[^}]*)?\\}`, "g");
    out = out.replace(re, `$1${digest}`);
  }
  // Fail-closed: si quedó CUALQUIER interpolación de imagen sin resolver → error.
  if (/image:\s*\$\{[A-Z][A-Z0-9_]*:/.test(out)) {
    throw new ContainerDeployError(
      "COMPOSE_UNRESOLVED_IMAGE",
      "El compose todavía contiene imágenes sin fijar tras el pinning",
      "Quedan imágenes sin digest en el descriptor de despliegue; instalación abortada.",
    );
  }
  return out;
}

/** Materializa y valida el descriptor ESTRICTO (contracts/docker-compose.ts). */
export function materializeDescriptor(
  source: ContainerDeploymentSource,
  pinnedDigests: Array<{ service: string; image: string }>,
): DockerComposeDeployment {
  const candidate = {
    schemaVersion: "1.0.0" as const,
    composeFile: source.composeFile,
    envFile: source.envFile,
    projectName: source.projectName,
    networkName: "albra-agents" as const,
    generatedSecretKeys: source.generatedSecretKeys,
    imageDigests: pinnedDigests.map(p => ({ service: p.service, image: p.image })),
    healthTimeoutSeconds: source.healthTimeoutSeconds,
    preserveVolumesOnStop: true as const,
  };
  const parsed = parseDockerComposeDeployment(candidate);
  if (!parsed.ok) {
    throw new ContainerDeployError(
      "DESCRIPTOR_INVALID",
      `Descriptor de despliegue inválido: ${parsed.errors.join("; ")}`,
      "El descriptor de despliegue Docker no pasó la validación del contrato.",
    );
  }
  return parsed.deployment;
}

// ───────────────────────── Espera de salud ─────────────────────────

export interface HealthWaitResult {
  ok: boolean;
  observedState: "RUNNING" | "DEGRADED" | "STOPPED" | "UNKNOWN";
  health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  services: ReturnType<typeof parseDockerComposePs>["services"];
}

/**
 * Sondea `compose ps` hasta salud consolidada o timeout. Usa summarize de
 * container-lifecycle (misma semántica que STATUS/HEALTH de ops).
 */
export async function waitForContainerHealth(
  runner: DockerRunner,
  opts: { productDir: string; projectName: string; composeFile: string; envFile: string; timeoutSeconds: number; intervalMs?: number },
): Promise<HealthWaitResult> {
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  const interval = opts.intervalMs ?? 3_000;
  let last: HealthWaitResult = { ok: false, observedState: "UNKNOWN", health: "UNKNOWN", services: [] };
  while (Date.now() < deadline) {
    const ps = await runDockerCompose({
      productDir: opts.productDir,
      projectName: opts.projectName,
      composeFile: opts.composeFile,
      envFile: opts.envFile,
      action: "ps",
      runner: (args) => runner.exec(args),
    });
    if (ps.ok) {
      const parsed = parseDockerComposePs(ps.stdout);
      if (parsed.ok) {
        const { observedState, health } = summarizeServices(parsed.services);
        last = { ok: health === "HEALTHY", observedState, health, services: parsed.services };
        if (health === "HEALTHY") return last;
        if (health === "FAILED") return last; // fail-fast: unhealthy explícito
      }
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return last;
}

/** Misma semántica que container-lifecycle.summarizeContainerServices (sin import cíclico). */
function summarizeServices(services: Array<{ state: string; health: string | null; exitCode: number | null }>): { observedState: "RUNNING" | "DEGRADED" | "STOPPED" | "UNKNOWN"; health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN" } {
  if (services.length === 0) return { observedState: "STOPPED", health: "UNKNOWN" };
  const allStopped = services.every(s => ["exited", "stopped", "created"].includes(s.state) && (s.exitCode === null || s.exitCode === 0));
  if (allStopped) return { observedState: "STOPPED", health: "UNKNOWN" };
  const failed = services.some(s => ["dead", "removing"].includes(s.state) || s.health === "unhealthy" || (s.exitCode !== null && s.exitCode !== 0 && s.state !== "running"));
  if (failed) return { observedState: "DEGRADED", health: "FAILED" };
  const allRunning = services.every(s => s.state === "running");
  if (!allRunning) return { observedState: "DEGRADED", health: "DEGRADED" };
  if (services.some(s => s.health === "starting")) return { observedState: "RUNNING", health: "DEGRADED" };
  return { observedState: "RUNNING", health: "HEALTHY" };
}

// ───────────────────────── Instalación (flujo principal) ─────────────────────────

export interface InstallContainerInput {
  productId: string;
  version: string;
  /** Compose ORIGINAL del paquete (con interpolaciones ${VAR:?…}). */
  composeYaml: string;
  deployment: ContainerDeploymentSource;
  runner?: DockerRunner;
  /** Callback de progreso (paso INSTALL del run). */
  onProgress?: (message: string) => Promise<void>;
}

export interface InstallContainerResult {
  projectName: string;
  installPath: string;
  pinnedDigests: Array<{ service: string; image: string }>;
  envKeys: string[];
  health: HealthWaitResult["health"];
  observedState: HealthWaitResult["observedState"];
}

/**
 * Despliegue real de un producto contenedorizado:
 * preflight → red → dir+compose+env(0600) → pin digests → descriptor estricto
 * → pull → up -d → espera de salud → registro Prisma → auditoría.
 */
export async function installContainerDeployment(input: InstallContainerInput): Promise<InstallContainerResult> {
  const runner = input.runner ?? realRunner;
  const dir = containerProductDir(input.productId);
  const composePath = path.join(dir, input.deployment.composeFile);
  const envRel = input.deployment.envFile;

  await input.onProgress?.("Preflight de Docker Engine + Compose v2");
  const pf = await dockerComposePreflight();
  if (!pf.ok) {
    throw new ContainerDeployError(
      "DOCKER_PREFLIGHT_FAILED",
      `Docker no disponible: ${pf.issues.filter(i => i.severity === "BLOCKER").map(i => i.message).join(" | ")}`,
      "Docker Engine / Compose v2 no está disponible en este equipo. Instala Docker (o solicita al instalador hacerlo) y reintenta.",
    );
  }

  await input.onProgress?.(`Creando red administrada '${input.deployment.networkName}'`);
  const net = await ensureAlbraAgentNetwork();
  if (!net.ok) {
    throw new ContainerDeployError("NETWORK_CREATE_FAILED", net.stderr || "No se pudo crear la red albra-agents", "No se pudo preparar la red interna de agentes ALBRA.");
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(composePath, input.composeYaml, "utf-8");

  await input.onProgress?.("Generando secretos criptográficos (.env 0600)");
  // Env NO secreto + secretos de la PLATAFORMA (p. ej. token ops para el PANEL).
  const plainValues: Record<string, string> = { ...(input.deployment.envStatic ?? {}) };
  for (const mapping of input.deployment.envFromPlatformSecret ?? []) {
    const { getSecret } = await import("@/lib/albra/core/secrets");
    const value = await getSecret(mapping.secretKey, "platform");
    if (value) plainValues[mapping.envVar] = value;
  }
  const envRes = await createGeneratedDockerEnvFile({
    productDir: dir,
    envFile: envRel,
    secretKeys: input.deployment.generatedSecretKeys,
    plainValues,
  });
  if (!envRes.ok && envRes.code !== "ENV_FILE_EXISTS") {
    throw new ContainerDeployError("ENV_GENERATION_FAILED", envRes.message, "No se pudieron generar los secretos del despliegue.");
  }
  // ENV_FILE_EXISTS → re-instalación: los secretos existentes se CONSERVAN (nunca se rotan en silencio).

  const pinned: Array<{ service: string; imageVar: string; image: string }> = [];
  for (const img of input.deployment.images) {
    await input.onProgress?.(`Fijando digest de imagen: ${img.service} (${img.ref})`);
    const digest = await pinImageDigest(runner, img.ref);
    pinned.push({ service: img.service, imageVar: img.imageVar, image: digest });
  }

  const materialized = materializeComposeWithDigests(input.composeYaml, pinned.map(p => ({ imageVar: p.imageVar, digest: p.image })));
  fs.writeFileSync(composePath, materialized, "utf-8");

  // Descriptor estricto validado (contrato) — fail-closed antes de tocar Docker.
  materializeDescriptor(input.deployment, pinned.map(p => ({ service: p.service, image: p.image })));

  await input.onProgress?.("Descargando imágenes fijadas por digest (compose pull)");
  const pull = await runDockerCompose({ productDir: dir, projectName: input.deployment.projectName, composeFile: input.deployment.composeFile, envFile: envRel, action: "pull" });
  if (!pull.ok) {
    throw new ContainerDeployError("COMPOSE_PULL_FAILED", pull.stderr || "compose pull falló", "No se pudieron descargar las imágenes fijadas por digest.");
  }

  await input.onProgress?.("Levantando servicios (docker compose up -d)");
  const up = await runDockerCompose({ productDir: dir, projectName: input.deployment.projectName, composeFile: input.deployment.composeFile, envFile: envRel, action: "up" });
  if (!up.ok) {
    throw new ContainerDeployError("COMPOSE_UP_FAILED", up.stderr || "compose up falló", "El despliegue de contenedores falló. Revisa los logs del instalador.");
  }

  await input.onProgress?.(`Esperando salud real de los servicios (timeout ${input.deployment.healthTimeoutSeconds}s)`);
  const health = await waitForContainerHealth(runner, {
    productDir: dir,
    projectName: input.deployment.projectName,
    composeFile: input.deployment.composeFile,
    envFile: envRel,
    timeoutSeconds: input.deployment.healthTimeoutSeconds,
  });

  await registerContainerDeployment({
    productId: input.productId,
    projectName: input.deployment.projectName,
    installPath: dir,
    composeFile: input.deployment.composeFile,
    envFile: envRel,
    networkName: input.deployment.networkName,
    imageDigests: pinned.map(p => ({ service: p.service, image: p.image })),
  });
  await updateContainerDeploymentState(input.productId, {
    desiredState: health.health === "HEALTHY" ? "RUNNING" : "STOPPED",
    observedState: health.observedState,
    health: health.health,
    lastError: health.ok ? null : "Servicios sin salud consolidada tras el timeout",
  });
  await audit({
    type: health.ok ? "OPS_EXECUTED" : "OPS_REJECTED",
    productId: input.productId,
    severity: health.ok ? undefined : "ERROR",
    detail: { op: "CONTAINER_INSTALL", version: input.version, digests: pinned.length, health: health.health },
  });
  await log({ channel: "SYSTEM", productId: input.productId, message: `Despliegue Docker completado: salud=${health.health}, servicios=${health.services.length}`, data: { projectName: input.deployment.projectName } });

  if (!health.ok) {
    throw new ContainerDeployError(
      "CONTAINER_HEALTH_TIMEOUT",
      `Servicios sin salud consolidada (${health.health}) tras ${input.deployment.healthTimeoutSeconds}s`,
      "Los contenedores arrancaron pero no alcanzaron estado saludable. NO se retiraron servicios ni datos: revisa diagnósticos.",
    );
  }

  return {
    projectName: input.deployment.projectName,
    installPath: dir,
    pinnedDigests: pinned.map(p => ({ service: p.service, image: p.image })),
    envKeys: envRes.ok ? envRes.keys : [],
    health: health.health,
    observedState: health.observedState,
  };
}

// ───────────────────────── Desinstalación (datos aparte) ─────────────────────────

/**
 * Retira SERVICIOS del producto contenedorizado. NUNCA borra volúmenes:
 * los datos (SQLite, reportes, backups) se conservan. `purgeData=true` SOLO
 * con confirmación explícita del llamador (ops UNINSTALL purgeData) borra
 * los volúmenes nombrados del proyecto.
 */
export async function uninstallContainerDeployment(input: {
  productId: string;
  purgeData: boolean;
  runner?: DockerRunner;
  onProgress?: (message: string) => Promise<void>;
}): Promise<{ ok: boolean; volumesRemoved: string[] }> {
  const runner = input.runner ?? realRunner;
  const { getContainerDeployment } = await import("@/lib/albra/core/registry");
  const dep = await getContainerDeployment(input.productId);
  if (!dep) throw new ContainerDeployError("CONTAINER_DEPLOYMENT_NOT_REGISTERED", "No hay despliegue de contenedores registrado para este producto");

  await input.onProgress?.("Retirando servicios (compose down — volúmenes conservados)");
  const down = await runner.exec([
    "compose", "--project-name", dep.projectName,
    "--env-file", path.join(dep.installPath, dep.envFile),
    "--file", path.join(dep.installPath, dep.composeFile),
    "down", "--remove-orphans",
  ]);
  if (!down.ok) {
    throw new ContainerDeployError("COMPOSE_DOWN_FAILED", down.stderr || "compose down falló", "No se pudieron retirar los servicios del producto.");
  }

  const volumesRemoved: string[] = [];
  if (input.purgeData) {
    // Lista EXPLÍCITA: volúmenes con nombre del proyecto Compose.
    const ls = await runner.exec(["volume", "ls", "--format", "{{.Name}}"]);
    const names = (ls.ok ? ls.stdout : "").split("\n").map(s => s.trim()).filter(n => n.startsWith(`${dep.projectName}_`));
    for (const v of names) {
      const rm = await runner.exec(["volume", "rm", v]);
      if (rm.ok) volumesRemoved.push(v);
    }
    await audit({ type: "OPS_EXECUTED", productId: input.productId, detail: { op: "CONTAINER_DATA_PURGED", volumes: volumesRemoved } });
  } else {
    await audit({ type: "OPS_EXECUTED", productId: input.productId, detail: { op: "CONTAINER_UNINSTALL", dataPreserved: true } });
  }
  await updateContainerDeploymentState(input.productId, { desiredState: "STOPPED", observedState: "STOPPED", health: "UNKNOWN", lastError: null });
  return { ok: true, volumesRemoved };
}
