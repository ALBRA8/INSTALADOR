/**
 * ALBRA — Docker Compose deployment driver (initial host adapter).
 *
 * Security boundaries:
 * - Never invokes a shell; all arguments are passed as an argv array.
 * - The compose file must resolve inside the managed product directory.
 * - Project names are validated before being passed to Docker.
 * - This module does not download images, generate secrets, or delete volumes.
 *   Those actions belong to the signed-package installer and explicit lifecycle
 *   workflows, not to an implicit "up" command.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export type DockerComposeAction = "up" | "stop" | "start" | "restart" | "ps" | "pull";

export interface DockerCommandResult {
  ok: boolean;
  code: "OK" | "DOCKER_NOT_FOUND" | "DOCKER_COMMAND_FAILED" | "COMPOSE_FILE_INVALID" | "PROJECT_NAME_INVALID";
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

function resolveComposeFile(productDir: string, composeFile: string): string | null {
  const root = path.resolve(productDir);
  const candidate = path.resolve(root, composeFile);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!/\.(yml|yaml)$/i.test(candidate)) return null;
  return candidate;
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
    const numericCode = typeof e.code === "number" ? e.code : null;
    return {
      ok: false,
      code: notFound ? "DOCKER_NOT_FOUND" : "DOCKER_COMMAND_FAILED",
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message,
      exitCode: numericCode,
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
  return {
    ok: true,
    dockerVersion: docker.stdout.trim(),
    composeVersion: compose.stdout.trim(),
    issues,
  };
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
}): Promise<DockerCommandResult> {
  if (!validateProjectName(opts.projectName)) {
    return { ok: false, code: "PROJECT_NAME_INVALID", stdout: "", stderr: "Invalid Compose project name.", exitCode: null };
  }

  const composePath = resolveComposeFile(opts.productDir, opts.composeFile ?? "compose.yaml");
  if (!composePath) {
    return { ok: false, code: "COMPOSE_FILE_INVALID", stdout: "", stderr: "Compose file must be a .yml/.yaml file inside the managed product directory.", exitCode: null };
  }

  const base = ["compose", "--project-name", opts.projectName, "--file", composePath];
  const actionArgs: Record<DockerComposeAction, string[]> = {
    up: ["up", "--detach", "--remove-orphans"],
    stop: ["stop"],
    start: ["start"],
    restart: ["restart"],
    ps: ["ps", "--all", "--format", "json"],
    pull: ["pull"],
  };

  return runDocker([...base, ...actionArgs[opts.action]], opts.productDir);
}
