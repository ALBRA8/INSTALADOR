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

  return runDocker([...base, ...actionArgs[opts.action]], paths.root);
}
