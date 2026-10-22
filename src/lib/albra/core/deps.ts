/**
 * ALBRA — V2 WAVE C: PREPARACIÓN DE DEPENDENCIAS (aislada por producto).
 *
 * Para cada runtime declarado por el paquete (SourceContractPatch.runtimes):
 *   1. DETECCIÓN real en el equipo (node/bun/python3 --version, timeout 5 s).
 *   2. Falta + required → RUNTIME_MISSING (fallo claro, nunca silencioso).
 *   3. Dependencias JS (package.json en el appDir) → instalación AISLADA en el
 *      appDir del producto: preferir `bun install --production`; fallback
 *      `npm install --omit=dev --prefix <appDir>` (env limpio, timeout 120 s).
 *   4. Python (requirements.txt) → venv `.albra-venv` + pip install
 *      (BEST_EFFORT: el fallo no aborta, queda registrado).
 *
 * Transparencia: RUNTIME_SUPPORT_MATRIX declara el nivel de verificación de
 * cada runtime para UI/docs. Tecnología sin adaptador → UNSUPPORTED_RUNTIME.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { log as coreLog } from "@/lib/albra/core/logger";

// ───────────────────────── Matriz de soporte ─────────────────────────

export const RUNTIME_SUPPORT_MATRIX = {
  node: "VERIFIED_LOCAL",
  bun: "VERIFIED_LOCAL",
  python: "BEST_EFFORT_UNTESTED",
} as const;

export type RuntimeId = keyof typeof RUNTIME_SUPPORT_MATRIX;

export interface RuntimeDetection {
  id: string;
  available: boolean;
  version?: string;
  path?: string;
  support: string;
}

export interface DependencyPreparation {
  detections: RuntimeDetection[];
  installs: Array<{ tool: string; ok: boolean; detail: string; tail: string[] }>;
  bestEffort: string[];
  summary: string;
}

export interface RuntimeRequirementInput {
  id: string;
  semver: string;
  required?: boolean;
}

/** Error con código estable + userMessage en español para el run/API. */
export class AlbraDepsError extends Error {
  readonly code: string;
  readonly userMessage: string;
  constructor(code: string, message: string, userMessage: string) {
    super(message);
    this.name = "AlbraDepsError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

// ───────────────────────── Utilidades ─────────────────────────

const execFileP = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeout ?? 5_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: opts.env ?? cleanEnv() },
      (err, stdout, stderr) => {
        if (err) {
          (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout = stdout;
          (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        }
      },
    );
  });

/** Env limpio (allowlist): sin heredar variables potencialmente hostiles. */
function cleanEnv(): NodeJS.ProcessEnv {
  const allow = [
    "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
    "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "SYSTEMROOT", "COMSPEC", "PROGRAMFILES", "PROGRAMFILES(X86)", "APPDATA", "LOCALAPPDATA",
  ];
  const out: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const k of allow) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

function firstVersionIn(text: string): string | undefined {
  const m = text.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m?.[1];
}

function tailLines(text: string, max = 100): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)
    .slice(-max);
}

/** Satisface `version` el rango declarado (soporta >=, >, <=, <, ^, ~, =, exacto, mayor simple). */
export function satisfiesRange(version: string, range: string): boolean {
  const v = version.trim().replace(/^v/i, "");
  const r = range.trim().replace(/^v/i, "");
  if (!r || r === "*" || r === "latest" || r.toLowerCase() === "x") return true;
  const tuple = (s: string): number[] => s.split(".").map(n => Number.parseInt(n, 10) || 0);
  const base = r.replace(/^[<>=^~!\s]+/, "");
  if (!/^\d+(\.\d+){0,2}$/.test(base)) {
    return true; // rango no parseable: no bloquear, pero quedar registrado en el log
  }
  const [rv0, rv1 = 0, rv2 = 0] = tuple(base);
  const [vv0, vv1 = 0, vv2 = 0] = tuple(v);
  if (r.startsWith(">=")) return vv0 > rv0 || (vv0 === rv0 && (vv1 > rv1 || (vv1 === rv1 && vv2 >= rv2)));
  if (r.startsWith(">")) return vv0 > rv0 || (vv0 === rv0 && (vv1 > rv1 || (vv1 === rv1 && vv2 > rv2)));
  if (r.startsWith("<=")) return vv0 < rv0 || (vv0 === rv0 && (vv1 < rv1 || (vv1 === rv1 && vv2 <= rv2)));
  if (r.startsWith("<")) return vv0 < rv0 || (vv0 === rv0 && (vv1 < rv1 || (vv1 === rv1 && vv2 < rv2)));
  if (r.startsWith("^")) return vv0 === rv0 && (vv1 > rv1 || (vv1 === rv1 && vv2 >= rv2));
  if (r.startsWith("~")) return vv0 === rv0 && vv1 === rv1 && vv2 >= rv2;
  // Exacto (comparación parcial: solo los componentes declarados)
  const parts = base.split(".").length;
  if (parts === 1) return vv0 === rv0;
  if (parts === 2) return vv0 === rv0 && vv1 === rv1;
  return vv0 === rv0 && vv1 === rv1 && vv2 === rv2;
}

// ───────────────────────── Detección de runtimes ─────────────────────────

const RUNTIME_BINS: Record<string, { cmd: string; args: string[] }> = {
  node: { cmd: "node", args: ["--version"] },
  bun: { cmd: "bun", args: ["--version"] },
  python: { cmd: "python3", args: ["--version"] },
};

/**
 * Detección real de un runtime en el equipo (timeout 5 s).
 * Devuelve { id, available, version?, path? } — nunca lanza por ausencia.
 */
export async function detectRuntime(id: string): Promise<RuntimeDetection> {
  const support = (RUNTIME_SUPPORT_MATRIX as Record<string, string>)[id] ?? "UNSUPPORTED";
  const bin = RUNTIME_BINS[id];
  if (!bin) {
    return { id, available: false, support };
  }
  const probe = async (): Promise<RuntimeDetection> => {
    const { stdout, stderr } = await execFileP(bin.cmd, bin.args, { timeout: 5_000 });
    return { id, available: true, version: firstVersionIn(`${stdout}\n${stderr}`), support };
  };
  try {
    return await probe();
  } catch {
    return { id, available: false, support };
  }
}

async function whichPath(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP(process.platform === "win32" ? "where" : "which", [cmd], { timeout: 2_000 });
    return stdout.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0);
  } catch {
    return undefined;
  }
}

// ───────────────────────── Preparación de dependencias ─────────────────────────

export interface PrepareDependenciesOptions {
  /** Directorio de la aplicación (staging durante la instalación; app tras el commit). */
  appDir: string;
  runtimes: RuntimeRequirementInput[];
  /** Callback de logging (p. ej. al step del run). Default: log() de plataforma. */
  log?: (message: string, data?: unknown) => void | Promise<void>;
}

/**
 * Prepara las dependencias del paquete en `appDir`:
 *  - verifica runtimes requeridos (RUNTIME_MISSING / versión insuficiente),
 *  - instala deps JS aisladas en appDir (bun preferente, si no npm),
 *  - prepara venv de Python si hay requirements.txt (BEST_EFFORT).
 */
export async function prepareDependencies(opts: PrepareDependenciesOptions): Promise<DependencyPreparation> {
  const say = async (message: string, data?: unknown): Promise<void> => {
    if (opts.log) await opts.log(message, data);
    else await coreLog({ channel: "SYSTEM", message, data });
  };
  const detections: RuntimeDetection[] = [];
  const installs: DependencyPreparation["installs"] = [];
  const bestEffort: string[] = [];
  const detectionCache = new Map<string, RuntimeDetection>();

  const detect = async (id: string): Promise<RuntimeDetection> => {
    const cached = detectionCache.get(id);
    if (cached) return cached;
    const det = await detectRuntime(id);
    det.path = det.available ? await whichPath(RUNTIME_BINS[id]?.cmd ?? id) : undefined;
    detectionCache.set(id, det);
    detections.push(det);
    await say(`Runtime detectado: ${id} → ${det.available ? `disponible v${det.version ?? "?"}${det.path ? ` (${det.path})` : ""}` : "NO disponible"} [${det.support}]`, det);
    return det;
  };

  // 1) Runtimes declarados: tecnología sin adaptador → UNSUPPORTED_RUNTIME (explícito)
  for (const rt of opts.runtimes ?? []) {
    if (!(rt.id in RUNTIME_SUPPORT_MATRIX)) {
      throw new AlbraDepsError(
        "UNSUPPORTED_RUNTIME",
        `UNSUPPORTED_RUNTIME — '${rt.id}' no tiene adaptador de dependencias implementado`,
        `El paquete requiere el runtime '${rt.id}', para el que ALBRA aún no tiene adaptador de dependencias. Instalación abortada.`,
      );
    }
    const det = await detect(rt.id);
    if (!det.available) {
      if (rt.required !== false) {
        throw new AlbraDepsError(
          "RUNTIME_MISSING",
          `RUNTIME_MISSING — runtime requerido '${rt.id}' (${rt.semver}) no está disponible en este equipo`,
          `El runtime '${rt.id}' (${rt.semver}), requerido por este paquete, no está disponible en este equipo. Instálalo y vuelve a intentarlo.`,
        );
      }
      await say(`Runtime opcional '${rt.id}' no disponible: se continúa sin él`, { id: rt.id });
      continue;
    }
    if (det.version && !satisfiesRange(det.version, rt.semver)) {
      if (rt.required !== false) {
        throw new AlbraDepsError(
          "RUNTIME_MISSING",
          `RUNTIME_MISSING — '${rt.id}' v${det.version} no cumple el rango requerido ${rt.semver}`,
          `El runtime '${rt.id}' detectado (v${det.version}) no cumple el rango requerido por el paquete (${rt.semver}).`,
        );
      }
      await say(`Runtime opcional '${rt.id}' v${det.version} fuera de rango ${rt.semver}: se continúa`, { id: rt.id });
    }
  }

  // 2) Dependencias JS (package.json) — instalación AISLADA en appDir
  const pkgJson = path.join(opts.appDir, "package.json");
  if (fs.existsSync(pkgJson)) {
    const bun = detectionCache.get("bun") ?? await detect("bun");
    const node = detectionCache.get("node") ?? await detect("node");
    if (bun.available) {
      await say(`Instalando dependencias JS aisladas en ${opts.appDir} con bun (producción)…`);
      try {
        const { stdout, stderr } = await execFileP("bun", ["install", "--production"], { cwd: opts.appDir, timeout: 120_000 });
        const tail = tailLines(`${stdout}\n${stderr}`);
        installs.push({ tool: "bun install --production", ok: true, detail: tail[tail.length - 1] ?? "ok", tail });
        await say(`Dependencias JS instaladas con bun en ${path.basename(opts.appDir)}`, { tool: "bun", tail: tail.slice(-3) });
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string; killed?: boolean };
        const tail = tailLines(`${err.stdout ?? ""}\n${err.stderr ?? ""}`);
        installs.push({ tool: "bun install --production", ok: false, detail: err.message, tail });
        await say(`bun install falló: ${err.message}`, { tail: tail.slice(-3) });
        throw new AlbraDepsError(
          "DEPENDENCIES_INSTALL_FAILED",
          `DEPENDENCIES_INSTALL_FAILED — bun install falló: ${err.message}`,
          `No se pudieron instalar las dependencias del paquete (bun install). Revisa los logs del run.`,
        );
      }
    } else if (node.available) {
      await say(`bun no disponible → instalando dependencias JS aisladas con npm (omit=dev)…`);
      try {
        const { stdout, stderr } = await execFileP("npm", ["install", "--omit=dev", "--prefix", opts.appDir, "--no-audit", "--no-fund", "--loglevel=error"], { cwd: opts.appDir, timeout: 120_000 });
        const tail = tailLines(`${stdout}\n${stderr}`);
        installs.push({ tool: "npm install --omit=dev", ok: true, detail: tail[tail.length - 1] ?? "ok", tail });
        await say(`Dependencias JS instaladas con npm en ${path.basename(opts.appDir)}`, { tool: "npm", tail: tail.slice(-3) });
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string };
        const tail = tailLines(`${err.stdout ?? ""}\n${err.stderr ?? ""}`);
        installs.push({ tool: "npm install --omit=dev", ok: false, detail: err.message, tail });
        await say(`npm install falló: ${err.message}`, { tail: tail.slice(-3) });
        throw new AlbraDepsError(
          "DEPENDENCIES_INSTALL_FAILED",
          `DEPENDENCIES_INSTALL_FAILED — npm install falló: ${err.message}`,
          `No se pudieron instalar las dependencias del paquete (npm install). Revisa los logs del run.`,
        );
      }
    } else {
      installs.push({ tool: "npm/bun", ok: false, detail: "package.json presente pero no hay runtime node/bun disponible para instalar dependencias", tail: [] });
      await say("package.json presente pero sin node/bun disponible: dependencias NO instaladas", { level: "warn" });
    }
  }

  // 3) Python (requirements.txt) — BEST_EFFORT, nunca aborta la instalación
  const reqTxt = path.join(opts.appDir, "requirements.txt");
  if (fs.existsSync(reqTxt)) {
    const py = detectionCache.get("python") ?? await detect("python");
    if (py.available) {
      const venvDir = path.join(opts.appDir, ".albra-venv");
      try {
        await say(`Creando venv de Python (.albra-venv) para ${path.basename(opts.appDir)}… [BEST_EFFORT]`);
        await execFileP("python3", ["-m", "venv", venvDir], { cwd: opts.appDir, timeout: 60_000 });
        const venvPython = path.join(venvDir, process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
        const { stdout, stderr } = await execFileP(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: opts.appDir, timeout: 180_000 });
        const tail = tailLines(`${stdout}\n${stderr}`);
        installs.push({ tool: "python venv + pip install -r requirements.txt", ok: true, detail: tail[tail.length - 1] ?? "ok", tail });
        bestEffort.push("python: dependencias instaladas en .albra-venv (BEST_EFFORT_UNTESTED)");
        await say("Dependencias de Python instaladas en .albra-venv (BEST_EFFORT)", { tail: tail.slice(-3) });
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string };
        const tail = tailLines(`${err.stdout ?? ""}\n${err.stderr ?? ""}`);
        installs.push({ tool: "python venv + pip install -r requirements.txt", ok: false, detail: err.message, tail });
        bestEffort.push("python: preparación de dependencias falló (BEST_EFFORT — no aborta)");
        await say(`Preparación de dependencias Python falló (BEST_EFFORT, no aborta): ${err.message}`, { tail: tail.slice(-3) });
      }
    } else {
      bestEffort.push("python: requirements.txt presente pero python3 no disponible (BEST_EFFORT — omitido)");
      await say("requirements.txt presente pero python3 no disponible: BEST_EFFORT omitido");
    }
  }

  const summaryParts: string[] = [];
  if (detections.length > 0) {
    summaryParts.push(detections.map(d => `${d.id}${d.available ? ` v${d.version ?? "?"}` : " (ausente)"}`).join(", "));
  }
  for (const i of installs) summaryParts.push(`${i.tool}: ${i.ok ? "OK" : "FALLO"}`);
  for (const b of bestEffort) summaryParts.push(b);
  if (summaryParts.length === 0) summaryParts.push("sin dependencias declaradas");

  return { detections, installs, bestEffort, summary: summaryParts.join(" · ") };
}
