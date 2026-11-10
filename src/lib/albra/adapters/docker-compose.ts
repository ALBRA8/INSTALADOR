/**
 * ALBRA — Docker Compose deployment driver (initial host adapter).
 *
 * Security boundaries:
 * - Never invokes a shell; all arguments are passed as an argv array.
 * - The Compose file must exist inside the real managed product directory.
 * - Symlinks that escape the product directory are rejected.
 * - Project names are validated before being passed to Docker.
 * - This module does not generate secrets or delete volumes.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export type DockerComposeAction = "up" | "stop" | "start" | "restart" | "ps" | "pull";

export interface DockerCommandResult {
  ok: boolean;
  code: "OK" | "DOCKER_NOT_FOUND" | "DOCKER_COMMAND_FAILED" | "PRODUCT_DIR_INVALID" | "COMPOSE_FILE_INVALID" | "COMPOSE_FILE_NOT_FOUND" | "ENV_FILE_INVALID" | "ENV_FILE_NOT_FOUND" | "PROJECT_NAME_INVALID";
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface DockerPreflightResult {
  ok: boolean;
  dockerVersion?: string;
  composeVersion?: string;
  issues: Array<{ code: string; severity: "BLOCKER" | "WARNING" | "RESOLVED"; message: string }>;
}

function validateProjectName(projectName: string): boolean {
  return PROJECT_RE.test(projectName);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveManagedPaths(productDir: string, composeFile: string): Promise<
  | { ok: true; root: string; composePath: string }
  | { ok: false; code: "PRODUCT_DIR_INVALID" | "COMPOSE_FILE_INVALID" | "COMPOSE_FILE_NOT_FOUND"; message: string }
> {
  let root: string;
  try {
    const rootStat = await fs.stat(productDir);
    if (!rootStat.isDirectory()) throw new Error("not a directory");
    root = await fs.realpath(productDir);
  } catch {
    return { ok: false, code: "PRODUCT_DIR_INVALID", message: "Managed product directory does not exist or is not a directory." };
  }

  if (typeof composeFile !== "string" || composeFile.trim().length === 0 || !/\.(yml|yaml)$/i.test(composeFile)) {
    return { ok: false, code: "COMPOSE_FILE_INVALID", message: "Compose file must be a .yml/.yaml file inside the managed product directory." };
  }

  const unresolved = path.resolve(root, composeFile);
  if (!isInside(root, unresolved)) {
    return { ok: false, code: "COMPOSE_FILE_INVALID", message: "Compose file must remain inside the managed product directory." };
  }

  let composePath: string;
  try {
    const stat = await fs.stat(unresolved);
    if (!stat.isFile()) throw new Error("not a file");
    composePath = await fs.realpath(unresolved);
  } catch {
    return { ok: false, code: "COMPOSE_FILE_NOT_FOUND", message: "Compose file does not exist or cannot be read." };
  }

  if (!isInside(root, composePath)) {
    return { ok: false, code: "COMPOSE_FILE_INVALID", message: "Compose file symlinks may not escape the managed product directory." };
  }
  return { ok: true, root, composePath };
}

async function resolveManagedEnvPath(root: string, envFile?: string): Promise<
  | { ok: true; envPath?: string }
  | { ok: false; code: "ENV_FILE_INVALID" | "ENV_FILE_NOT_FOUND"; message: string }
> {
  if (envFile === undefined) return { ok: true };
  if (typeof envFile !== "string" || envFile.trim().length === 0 || path.isAbsolute(envFile)) {
    return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file must be a relative path inside the managed product directory." };
  }
  const unresolved = path.resolve(root, envFile);
  if (!isInside(root, unresolved)) {
    return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file must remain inside the managed product directory." };
  }
  try {
    const stat = await fs.stat(unresolved);
    if (!stat.isFile()) throw new Error("not a file");
    const envPath = await fs.realpath(unresolved);
    if (!isInside(root, envPath)) {
      return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file symlinks may not escape the managed product directory." };
    }
    // On POSIX, reject group/world-readable secret files. Windows ACLs are
    // managed by the host and are not represented reliably by mode bits.
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
      return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file permissions are too broad; use mode 0600." };
    }
    return { ok: true, envPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, code: "ENV_FILE_NOT_FOUND", message: "Environment file does not exist." };
    }
    return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file is not a readable regular file." };
  }
}

async function runDocker(args: string[], cwd: string): Promise<DockerCommandResult> {
  try {
    const result = await execFileAsync("docker", args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, DOCKER_CLI_HINTS: "false" },
    });
    return { ok: true, code: "OK", stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { code?: string | number; stdout?: string; stderr?: string };
    const notFound = e.code === "ENOENT";
    return {
      ok: false,
      code: notFound ? "DOCKER_NOT_FOUND" : "DOCKER_COMMAND_FAILED",
      stdout: e.stdout ?? "",
      // Avoid returning arbitrary process environment or command context here.
      stderr: (e.stderr ?? e.message ?? "Docker command failed").slice(0, 4000),
      exitCode: typeof e.code === "number" ? e.code : null,
    };
  }
}


/** Ensure the one ALBRA-managed shared bridge exists; never mutate other networks. */
export async function ensureAlbraAgentNetwork(): Promise<DockerCommandResult> {
  const name = "albra-agents";
  const inspected = await runDocker(["network", "inspect", name], process.cwd());
  if (inspected.ok) return inspected;
  const created = await runDocker(["network", "create", "--driver", "bridge", name], process.cwd());
  if (created.ok) return created;
  // A concurrent installer may have created it between inspect and create.
  const raced = await runDocker(["network", "inspect", name], process.cwd());
  return raced.ok ? raced : created;
}

/** Read-only checks; safe to run during product preflight. */
export async function dockerComposePreflight(): Promise<DockerPreflightResult> {
  const issues: DockerPreflightResult["issues"] = [];
  const docker = await runDocker(["version", "--format", "{{.Server.Version}}"], process.cwd());
  if (!docker.ok) {
    issues.push({
      code: docker.code,
      severity: "BLOCKER",
      message: docker.code === "DOCKER_NOT_FOUND"
        ? "Docker CLI no está instalado o no está en PATH."
        : "No se pudo consultar Docker Engine; verifica que el servicio esté iniciado y que el usuario tenga permisos.",
    });
    return { ok: false, issues };
  }

  const compose = await runDocker(["compose", "version", "--short"], process.cwd());
  if (!compose.ok) {
    issues.push({
      code: "DOCKER_COMPOSE_UNAVAILABLE",
      severity: "BLOCKER",
      message: "Docker Compose v2 no está disponible (se requiere docker compose).",
    });
    return { ok: false, dockerVersion: docker.stdout.trim(), issues };
  }

  issues.push({ code: "DOCKER_ENGINE_OK", severity: "RESOLVED", message: "Docker Engine responde." });
  issues.push({ code: "DOCKER_COMPOSE_OK", severity: "RESOLVED", message: "Docker Compose v2 está disponible." });
  return { ok: true, dockerVersion: docker.stdout.trim(), composeVersion: compose.stdout.trim(), issues };
}


export interface DockerComposeServiceState {
  service: string;
  name: string;
  state: string;
  health: string | null;
  exitCode: number | null;
}

export function parseDockerComposePs(stdout: string): {
  ok: boolean;
  services: DockerComposeServiceState[];
  error?: string;
} {
  try {
    const trimmed = stdout.trim();
    if (!trimmed) return { ok: true, services: [] };
    const decoded: unknown = trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : trimmed.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const rows = Array.isArray(decoded) ? decoded : [decoded];
    const services: DockerComposeServiceState[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return { ok: false, services: [], error: "Compose status contains a non-object row." };
      }
      const item = row as Record<string, unknown>;
      if (typeof item.Service !== "string" || typeof item.State !== "string") {
        return { ok: false, services: [], error: "Compose status row is missing Service or State." };
      }
      services.push({
        service: item.Service,
        name: typeof item.Name === "string" ? item.Name : "",
        state: item.State.toLowerCase(),
        health: typeof item.Health === "string" && item.Health.length > 0 ? item.Health.toLowerCase() : null,
        exitCode: typeof item.ExitCode === "number" ? item.ExitCode : null,
      });
    }
    return { ok: true, services };
  } catch {
    return { ok: false, services: [], error: "Compose returned invalid JSON status." };
  }
}

/**
 * Executes a narrowly-scoped Compose lifecycle command.
 * "down" and volume deletion are intentionally absent: uninstall must be a
 * separate, explicit, data-mode-aware operation.
 */
export async function runDockerCompose(opts: {
  productDir: string;
  composeFile?: string;
  projectName: string;
  action: DockerComposeAction;
  envFile?: string;
  /** Inyección para pruebas (mismo contrato que runDocker). */
  runner?: (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
}): Promise<DockerCommandResult> {
  if (!validateProjectName(opts.projectName)) {
    return { ok: false, code: "PROJECT_NAME_INVALID", stdout: "", stderr: "Invalid Compose project name.", exitCode: null };
  }

  const paths = await resolveManagedPaths(opts.productDir, opts.composeFile ?? "compose.yaml");
  if (!paths.ok) {
    return { ok: false, code: paths.code, stdout: "", stderr: paths.message, exitCode: null };
  }

  const env = await resolveManagedEnvPath(paths.root, opts.envFile);
  if (!env.ok) {
    return { ok: false, code: env.code, stdout: "", stderr: env.message, exitCode: null };
  }

  const base = ["compose", "--project-name", opts.projectName];
  if (env.envPath) base.push("--env-file", env.envPath);
  base.push("--file", paths.composePath);
  const actionArgs: Record<DockerComposeAction, string[]> = {
    // Do not remove orphan containers implicitly; only explicitly owned services are changed.
    up: ["up", "--detach"],
    stop: ["stop"],
    start: ["start"],
    restart: ["restart"],
    ps: ["ps", "--all", "--format", "json"],
    pull: ["pull"],
  };

  const exec = opts.runner
    ? async (args: string[]): Promise<DockerCommandResult> => {
        const r = await opts.runner!(args);
        return { ok: r.ok, code: r.ok ? "OK" : "DOCKER_COMMAND_FAILED", stdout: r.stdout, stderr: r.stderr, exitCode: r.ok ? 0 : 1 };
      }
    : runDocker;
  return exec([...base, ...actionArgs[opts.action]], paths.root);
}

// ───────────────────────── Instalación automatizada de Docker (F1) ─────────────────────────

export type DockerInstallPlan =
  | { os: "linux"; distro: string; method: "get.docker.com"; needsRoot: boolean; command: string[]; note: string }
  | { os: "windows"; method: "docker-desktop"; needsRoot: false; command: null; note: string }
  | { os: "unsupported"; method: "manual"; needsRoot: false; command: null; note: string };

/**
 * Plan de instalación de Docker según el sistema (métodos OFICIALES):
 *  - Linux: script oficial https://get.docker.com (requiere root/sudo).
 *  - Windows: Docker Desktop con WSL2 (instalación interactiva del operador).
 *  - Otros: manual.
 * NUNCA ejecuta nada destructivo ni ignora privilegios: si falta permiso,
 * devuelve el plan y el instalador pide elevación explicando el motivo.
 */
export async function planDockerInstall(): Promise<DockerInstallPlan> {
  if (process.platform === "linux") {
    let distro = "linux";
    try {
      const { readFile } = await import("node:fs/promises");
      const osRelease = await readFile("/etc/os-release", "utf-8");
      const id = /^ID=(.+)$/m.exec(osRelease)?.[1]?.replace(/"/g, "") ?? "linux";
      distro = id;
    } catch { /* sin /etc/os-release → genérico */ }
    return {
      os: "linux",
      distro,
      method: "get.docker.com",
      needsRoot: true,
      command: ["sh", "-c", "curl -fsSL https://get.docker.com | sh"],
      note: `Instalación oficial de Docker para ${distro} (get.docker.com). Requiere privilegios de root: el instalador pedirá elevación (sudo) y explicará el motivo antes de ejecutarla.`,
    };
  }
  if (process.platform === "win32") {
    return {
      os: "windows",
      method: "docker-desktop",
      needsRoot: false,
      command: null,
      note: "En Windows, instala Docker Desktop (con backend WSL2) desde https://www.docker.com/products/docker-desktop/ y asegúrate de que 'docker compose version' responda. ALBRA no puede instalarlo silenciosamente.",
    };
  }
  return {
    os: "unsupported",
    method: "manual",
    needsRoot: false,
    command: null,
    note: "Plataforma sin instalación automatizada de Docker. Instala Docker Engine + Compose v2 manualmente.",
  };
}

/**
 * Intenta instalar Docker cuando falta. SOLO Linux (script oficial).
 * Devuelve un resultado honesto: instalado=true SOLO si `docker version`
 * responde tras la instalación. En Windows/macOS devuelve el plan (sin ejecutar).
 */
export async function ensureDockerEngine(opts?: { execute?: boolean }): Promise<
  { installed: true; dockerVersion: string } | { installed: false; plan: DockerInstallPlan; reason: string }
> {
  const pf = await dockerComposePreflight();
  if (pf.ok) return { installed: true, dockerVersion: pf.dockerVersion ?? "ok" };
  const plan = await planDockerInstall();
  if (plan.os !== "linux" || !opts?.execute || !plan.command) {
    return { installed: false, plan, reason: plan.note };
  }
  // Linux: el script oficial necesita root. Sin sudo/root disponible → fail-closed honesto.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRoot) {
    const hasSudo = await new Promise<boolean>((resolve) => {
      const child = execFile("sudo", ["-n", "true"], { timeout: 5_000 }, (err) => resolve(!err));
      child.on("error", () => resolve(false));
    });
    if (!hasSudo) {
      return { installed: false, plan, reason: "Se requieren privilegios de administrador para instalar Docker (sudo sin contraseña no disponible). Ejecuta el plan indicado y reintenta." };
    }
    plan.command = ["sudo", ...plan.command];
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  try {
    await execFileP(plan.command[0], plan.command.slice(1), { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (e) {
    return { installed: false, plan, reason: `La instalación de Docker falló: ${(e as Error).message.slice(0, 300)}` };
  }
  const verify = await dockerComposePreflight();
  return verify.ok
    ? { installed: true, dockerVersion: verify.dockerVersion ?? "ok" }
    : { installed: false, plan, reason: "El script terminó pero Docker Engine no responde todavía (inicia el servicio docker y reintenta)." };
}
