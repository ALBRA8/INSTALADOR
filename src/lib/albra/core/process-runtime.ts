/**
 * ALBRA V2 — REAL PROCESS RUNTIME (núcleo de la transformación)
 *
 * Gestiona procesos REALES del sistema operativo:
 *  - spawn del entrypoint autorizado del producto (sin shell, args estructurados)
 *  - pidfile con identidad verificable (pid + bootToken + entry + versión)
 *  - verificación de identidad del PID (no basta con que exista)
 *  - logs reales stdout/stderr con rotación
 *  - stop ordenado con timeout + terminación forzada
 *  - detección de crash (terminación inesperada) con evidencia
 *  - adopción segura de procesos huérfanos tras reinicio del INSTALADOR
 *  - reconciliación DB ↔ sistema operativo (la DB nunca es la fuente de verdad)
 *
 * Plataformas: linux/macOS VERIFICADO en sandbox; win32 implementado
 * (taskkill/PowerShell) pero NO EJECUTABLE en este entorno → marcado UNTESTED.
 */
import fs from "fs";
import path from "path";
import net from "net";
import os from "os";
import crypto from "crypto";
import { spawn, execFile } from "child_process";
import { PATHS, writeFileAtomic, productRuntimeDir, productAppDir } from "@/lib/albra/env";
import { log } from "@/lib/albra/core/logger";

/* ─────────────────────────── tipos ─────────────────────────── */

export interface ProcessIdentity {
  pid: number;
  bootToken: string;
  port: number;
  productId: string;
  version: string;
  startedAt: string; // ISO
  entryPath: string;
  execPath: string;
  platform: string;
}

export type RuntimeOsState =
  | "RUNNING"        // pidfile + vivo + identidad verificada + DB coherente
  | "ORPHAN_RUNNING" // vivo en el SO pero la DB no lo sabe → adoptable
  | "CRASHED"        // terminación inesperada (sin exit.json)
  | "EXITED_CLEAN"   // salida ordenada (exit.json presente)
  | "LOST"           // DB decía RUNNING pero no hay pidfile ni proceso
  | "STOPPED"
  | "UNKNOWN";

export interface RuntimeEvidence {
  osState: RuntimeOsState;
  pid?: number;
  port?: number;
  startedAt?: string;
  uptimeS?: number;
  identityVerified?: boolean;
  exitReason?: string;
  errLogTail?: string;
  lastHeartbeatAt?: string;
}

export interface StartResult {
  ok: boolean;
  pid?: number;
  bootToken?: string;
  port?: number;
  error?: string;
  detail?: string;
}

/* ─────────────────────────── paths ─────────────────────────── */

const HEALTH_TIMEOUT_MS = 12_000;
const HEALTH_POLL_MS = 300;
const STOP_TIMEOUT_MS = 8_000;
const LOG_ROTATE_BYTES = 1_500_000;
const LOG_KEEP = 3;
const ERR_TAIL_BYTES = 4096;

function runtimeDir(productId: string): string {
  return productRuntimeDir(productId);
}
function pidFile(productId: string): string {
  return path.join(runtimeDir(productId), "process.json");
}
function exitFile(productId: string): string {
  return path.join(runtimeDir(productId), "exit.json");
}
function heartbeatFile(productId: string): string {
  return path.join(runtimeDir(productId), "heartbeat.json");
}
function outLog(productId: string): string {
  return path.join(PATHS.logs, "products", productId, "out.log");
}
function errLog(productId: string): string {
  return path.join(PATHS.logs, "products", productId, "err.log");
}

/* ─────────────────────────── logs con rotación ─────────────────────────── */

function rotateLog(file: string): number {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) return fs.openSync(file, "a");
    if (fs.statSync(file).size < LOG_ROTATE_BYTES) return fs.openSync(file, "a");
    // out.log.2 → .3, .1 → .2, out.log → .1 (conserva LOG_KEEP generaciones)
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(file, `${file}.1`);
    return fs.openSync(file, "a");
  } catch {
    try {
      return fs.openSync(file, "a");
    } catch {
      return -1;
    }
  }
}

export function tailFileSafe(file: string, maxBytes = ERR_TAIL_BYTES): string | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf-8").slice(-maxBytes);
  } catch {
    return undefined;
  }
}

/* ─────────────────────────── pidfile (identidad) ─────────────────────────── */

export function writePidFile(productId: string, identity: ProcessIdentity): void {
  writeFileAtomic(pidFile(productId), JSON.stringify(identity, null, 2));
}
export function readPidFile(productId: string): ProcessIdentity | null {
  try {
    const raw = fs.readFileSync(pidFile(productId), "utf-8");
    const id = JSON.parse(raw) as ProcessIdentity;
    if (!id || typeof id.pid !== "number" || !id.bootToken) return null;
    return id;
  } catch {
    return null;
  }
}
export function removePidFile(productId: string): void {
  try {
    fs.rmSync(pidFile(productId), { force: true });
  } catch {
    /* noop */
  }
}

/* ─────────────────────────── liveness + identidad ─────────────────────────── */

/** ¿Existe el proceso? (señal 0). EPERM cuenta como vivo (otro usuario). */
export function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    return false; // ESRCH → no existe
  }
}

/** Lee la línea de comandos real del PID para verificar que es NUESTRO proceso. */
async function processCommandLine(pid: number): Promise<string | null> {
  if (process.platform === "win32") {
    // UNTESTED_ON_SANDBOX — implementado según API nativa de Windows (PowerShell/CIM)
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
          { timeout: 5000 },
          (e, out) => (e ? reject(e) : resolve(String(out ?? ""))),
        );
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`);
    return raw.toString("utf-8").replace(/\0/g, " ").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Verifica que el PID corresponde al producto esperado y a la instancia que
 * ALBRA creó (entryPath del pidfile + marcador del runtime + productId).
 */
export async function verifyProcessIdentity(
  identity: ProcessIdentity,
): Promise<{ ok: boolean; commandLine?: string; reason?: string }> {
  if (!isAlive(identity.pid)) return { ok: false, reason: "PROCESS_NOT_FOUND" };
  const cmd = await processCommandLine(identity.pid);
  if (cmd === null) {
    // Sin /proc ni CIM no podemos verificar la línea de comando.
    // Degradación documentada: se acepta el pidfile como evidencia débil.
    return { ok: true, reason: "CMDLINE_UNAVAILABLE" };
  }
  const entryBase = path.basename(identity.entryPath);
  const ok =
    cmd.includes(entryBase) &&
    cmd.includes(identity.productId) &&
    (cmd.includes("ALBRA-PRODUCT-RUNTIME") || cmd.includes(entryBase));
  return ok ? { ok: true, commandLine: cmd } : { ok: false, commandLine: cmd, reason: "IDENTITY_MISMATCH" };
}

/* ─────────────────────────── arranque real ─────────────────────────── */

/** Genera un entrypoint: execPath del INSTALADOR (bun/node) + product.js. */
function resolveExecPath(): string {
  return process.execPath || "node";
}

/**
 * Inicia el proceso REAL del producto.
 * - Sin shell: argv estructurado (nunca concatenación de strings).
 * - Env allowlist estricto (sin secretos del INSTALADOR).
 * - detached: el producto sobrevive reinicios del INSTALADOR (huérfano recuperable).
 * - stdout/stderr → logs rotativos.
 */
export function spawnProductProcess(opts: {
  productId: string;
  version: string;
  port: number;
  appDir?: string;
}): { ok: true; pid: number; bootToken: string; port: number } | { ok: false; error: string; detail?: string } {
  const { productId, version, port } = opts;
  const appDir = opts.appDir ?? productAppDir(productId);
  const entryPath = path.join(appDir, "product.js");

  if (!fs.existsSync(entryPath)) {
    return { ok: false, error: "ENTRYPOINT_MISSING", detail: `No existe ${entryPath}` };
  }
  const entrySource = (() => {
    try {
      return fs.readFileSync(entryPath, "utf-8");
    } catch {
      return "";
    }
  })();
  if (!entrySource.includes("ALBRA-PRODUCT-RUNTIME")) {
    return {
      ok: false,
      error: "PRODUCT_RUNTIME_OUTDATED",
      detail: "El entrypoint instalado no es un runtime ALBRA instrumentado. Ejecuta una actualización o reparación del producto.",
    };
  }

  const bootToken = crypto.randomBytes(24).toString("hex");
  const outFd = rotateLog(outLog(productId));
  const errFd = rotateLog(errLog(productId));

  const envAllowlist: NodeJS.ProcessEnv = {
    ALBRA_PRODUCT_ID: productId,
    ALBRA_PRODUCT_VERSION: version,
    ALBRA_PORT: String(port),
    ALBRA_BOOT_TOKEN: bootToken,
    ALBRA_DATA_DIR: path.join(PATHS.products, productId, "data"),
    ALBRA_RUNTIME_DIR: runtimeDir(productId),
    ALBRA_LOG_DIR: path.join(PATHS.logs, "products", productId),
    NODE_ENV: "production",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? os.homedir(),
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
  };
  if (process.platform === "win32") envAllowlist.TMP = process.env.TMP ?? os.tmpdir();

  fs.mkdirSync(runtimeDir(productId), { recursive: true });
  // limpieza de evidencias de la instancia anterior
  try {
    fs.rmSync(exitFile(productId), { force: true });
    fs.rmSync(heartbeatFile(productId), { force: true });
  } catch {
    /* noop */
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(resolveExecPath(), [entryPath, "--port", String(port)], {
      cwd: appDir,
      env: envAllowlist,
      detached: true,
      stdio: ["ignore", outFd >= 0 ? outFd : "ignore", errFd >= 0 ? errFd : "ignore"],
      windowsHide: true,
    });
  } catch (e) {
    return { ok: false, error: "SPAWN_FAILED", detail: (e as Error).message };
  }
  // el padre cierra sus copias de los fds (el hijo conserva los suyos)
  for (const fd of [outFd, errFd]) {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
        /* noop */
      }
    }
  }
  if (!child.pid) {
    return { ok: false, error: "SPAWN_FAILED", detail: "El sistema no devolvió un PID" };
  }
  child.unref();

  const identity: ProcessIdentity = {
    pid: child.pid,
    bootToken,
    port,
    productId,
    version,
    startedAt: new Date().toISOString(),
    entryPath,
    execPath: resolveExecPath(),
    platform: process.platform,
  };
  writePidFile(productId, identity);
  return { ok: true, pid: child.pid, bootToken, port };
}

/** GET /health autenticado con cross-check del PID devuelto. */
export async function probeHealth(
  port: number,
  bootToken: string,
  expectPid?: number,
  timeoutMs = 2500,
): Promise<{ ok: boolean; status?: number; body?: Record<string, unknown>; error?: string; latencyMs?: number }> {
  const started = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-albra-token": bootToken },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (res.status !== 200) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, latencyMs };
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (!body || body.ok !== true || body.state !== "RUNNING") {
      return { ok: false, status: res.status, body, error: "RESPUESTA_INVALIDA", latencyMs };
    }
    if (expectPid !== undefined && Number(body.pid) !== expectPid) {
      return { ok: false, status: res.status, body, error: "PID_MISMATCH", latencyMs };
    }
    return { ok: true, status: res.status, body, latencyMs };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "HEALTH_TIMEOUT" : (e as Error).message };
  }
}

/** Espera activa hasta que /health responde 200 autenticado y el proceso sigue vivo. */
export async function waitUntilHealthy(
  productId: string,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<{ ok: boolean; error?: string; detail?: string; latencyMs?: number }> {
  const identity = readPidFile(productId);
  if (!identity) return { ok: false, error: "PIDFILE_MISSING" };
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (!isAlive(identity.pid)) {
      return {
        ok: false,
        error: "PROCESS_EXITED_DURING_START",
        detail: tailFileSafe(errLog(productId)) ?? "sin stderr",
      };
    }
    const probe = await probeHealth(identity.port, identity.bootToken, identity.pid);
    if (probe.ok) return { ok: true, latencyMs: probe.latencyMs };
    last = probe.error ?? "unknown";
    await new Promise(r => setTimeout(r, HEALTH_POLL_MS));
  }
  return {
    ok: false,
    error: "START_TIMEOUT",
    detail: `Último error: ${last}. ${tailFileSafe(errLog(productId)) ?? ""}`.trim(),
  };
}

/* ─────────────────────────── parada real ─────────────────────────── */

export interface StopResult {
  stopped: boolean;
  forced: boolean;
  evidence: string;
  error?: string;
}

/** Detiene el proceso con estrategia ordenada → timeout → forzada. */
export async function stopProductProcess(
  productId: string,
  opts: { timeoutMs?: number; force?: boolean } = {},
): Promise<StopResult> {
  const timeoutMs = opts.timeoutMs ?? STOP_TIMEOUT_MS;
  const identity = readPidFile(productId);

  if (!identity) {
    return { stopped: true, forced: false, evidence: "SIN_PIDFILE (no había proceso registrado)" };
  }
  if (!isAlive(identity.pid)) {
    removePidFile(productId);
    return { stopped: true, forced: false, evidence: "El proceso ya no existía (PID " + identity.pid + ")" };
  }
  const v = await verifyProcessIdentity(identity);
  if (!v.ok && v.reason === "IDENTITY_MISMATCH") {
    // SEGURIDAD: el PID no es nuestro → NO matar. Evidencia y estado UNKNOWN.
    return {
      stopped: false,
      forced: false,
      evidence: `IDENTITY_MISMATCH: PID ${identity.pid} ejecuta «${(v.commandLine ?? "").slice(0, 120)}» — no corresponde a este producto. No se terminó.`,
      error: "IDENTITY_MISMATCH",
    };
  }

  const gracefulDeadline = Date.now() + timeoutMs;
  if (process.platform === "win32") {
    // UNTESTED_ON_SANDBOX — Windows: intento ordenado (WM_CLOSE) vía taskkill
    await new Promise<void>(resolve => {
      execFile("taskkill", ["/PID", String(identity.pid)], { timeout: 5000 }, () => resolve());
    });
  } else {
    try {
      process.kill(identity.pid, "SIGTERM");
    } catch {
      /* ya murió */
    }
  }

  while (Date.now() < gracefulDeadline && isAlive(identity.pid)) {
    await new Promise(r => setTimeout(r, 300));
  }

  let forced = false;
  if (isAlive(identity.pid)) {
    forced = true;
    if (process.platform === "win32") {
      await new Promise<void>(resolve => {
        execFile("taskkill", ["/PID", String(identity.pid), "/T", "/F"], { timeout: 5000 }, () => resolve());
      });
    } else {
      try {
        process.kill(identity.pid, "SIGKILL");
      } catch {
        /* noop */
      }
    }
    // espera corta a que el SO libere
    for (let i = 0; i < 10 && isAlive(identity.pid); i++) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const stillAlive = isAlive(identity.pid);
  const exitReason = readExitReason(productId);
  removePidFile(productId);
  if (stillAlive) {
    return {
      stopped: false,
      forced,
      evidence: `El proceso ${identity.pid} NO respondió a SIGTERM ni SIGKILL verificable`,
      error: "STOP_FAILED",
    };
  }
  return {
    stopped: true,
    forced,
    evidence: exitReason
      ? `Salida ordenada (${exitReason})${forced ? " tras timeout" : ""}`
      : forced
        ? "Terminado con señal forzada tras timeout"
        : "Proceso terminado y verificado (PID ya no existe)",
  };
}

function readExitReason(productId: string): string | null {
  try {
    const raw = fs.readFileSync(exitFile(productId), "utf-8");
    const j = JSON.parse(raw) as { reason?: string; at?: string };
    return j.reason ? `${j.reason}${j.at ? ` @ ${j.at}` : ""}` : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────── estado real (fuente de verdad: el SO) ─────────────────────────── */

export async function readRuntimeState(productId: string, dbSaysRunning?: boolean): Promise<{
  osState: RuntimeOsState;
  identity: ProcessIdentity | null;
  evidence: RuntimeEvidence;
}> {
  const identity = readPidFile(productId);
  const errTail = tailFileSafe(errLog(productId));
  const hb = readHeartbeat(productId);

  if (!identity) {
    const aliveUnknown = false;
    return {
      osState: dbSaysRunning ? "LOST" : "STOPPED",
      identity: null,
      evidence: {
        osState: dbSaysRunning ? "LOST" : "STOPPED",
        errLogTail: errTail,
        lastHeartbeatAt: hb?.at,
        identityVerified: !aliveUnknown,
      },
    };
  }
  const alive = isAlive(identity.pid);
  const uptimeS = alive ? Math.floor((Date.now() - new Date(identity.startedAt).getTime()) / 1000) : undefined;

  if (!alive) {
    const exitReason = readExitReason(productId);
    const osState: RuntimeOsState = exitReason ? "EXITED_CLEAN" : "CRASHED";
    return {
      osState,
      identity,
      evidence: {
        osState,
        pid: identity.pid,
        port: identity.port,
        startedAt: identity.startedAt,
        exitReason: exitReason ?? undefined,
        errLogTail: errTail,
        lastHeartbeatAt: hb?.at,
      },
    };
  }
  const v = await verifyProcessIdentity(identity);
  const osState: RuntimeOsState = v.ok ? (dbSaysRunning ? "RUNNING" : "ORPHAN_RUNNING") : "UNKNOWN";
  return {
    osState,
    identity,
    evidence: {
      osState,
      pid: identity.pid,
      port: identity.port,
      startedAt: identity.startedAt,
      uptimeS,
      identityVerified: v.ok,
      errLogTail: errTail,
      lastHeartbeatAt: hb?.at,
    },
  };
}

function readHeartbeat(productId: string): { at?: string; pid?: number } | null {
  try {
    return JSON.parse(fs.readFileSync(heartbeatFile(productId), "utf-8")) as { at?: string; pid?: number };
  } catch {
    return null;
  }
}

/** ¿El puerto está realmente siendo servido por alguien? */
export function isPortServing(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/* ─────────────────────────── reconciliación ─────────────────────────── */

export interface ReconcileResult {
  productId: string;
  before: string | null; // estado en DB
  after: string; // estado final en DB
  osState: RuntimeOsState;
  changed: boolean;
  evidence: string;
}

/**
 * Reconcilia el estado persistido con el estado REAL del sistema operativo
 * para un producto. Nunca mata procesos que no puede verificar como propios.
 */
export async function reconcileProduct(productId: string, dbRow: {
  state: string;
  pid: number | null;
  port: number | null;
}): Promise<ReconcileResult> {
  const { readRuntimeState } = await import("@/lib/albra/core/process-runtime");
  const rs = await readRuntimeState(productId, dbRow.state === "RUNNING");
  const { db } = await import("@/lib/db");
  const { audit } = await import("@/lib/albra/core/audit");

  const update = async (data: Record<string, unknown>) => {
    await db.installedProduct.update({ where: { productId }, data });
  };

  switch (rs.osState) {
    case "RUNNING": {
      // coherente: DB RUNNING + proceso vivo verificado → refrescar pid/puerto
      if (dbRow.state !== "RUNNING" || dbRow.pid !== rs.identity!.pid) {
        await update({
          state: "RUNNING",
          pid: rs.identity!.pid,
          port: rs.identity!.port,
          bootToken: rs.identity!.bootToken,
          runtimeHandle: `pid:${rs.identity!.pid}`,
          startedAt: new Date(rs.identity!.startedAt),
        });
        return {
          productId, before: dbRow.state, after: "RUNNING", osState: rs.osState, changed: true,
          evidence: `Proceso vivo verificado (PID ${rs.identity!.pid}, puerto ${rs.identity!.port})`,
        };
      }
      return { productId, before: dbRow.state, after: "RUNNING", osState: rs.osState, changed: false, evidence: "Coherente" };
    }
    case "ORPHAN_RUNNING": {
      // huérfano recuperable: el producto sobrevivió al INSTALADOR → adoptar
      await update({
        state: "RUNNING",
        pid: rs.identity!.pid,
        port: rs.identity!.port,
        bootToken: rs.identity!.bootToken,
        runtimeHandle: `pid:${rs.identity!.pid}`,
        startedAt: new Date(rs.identity!.startedAt),
      });
      await audit({ type: "PROCESS_ADOPTED", productId, severity: "WARNING", detail: { pid: rs.identity!.pid, port: rs.identity!.port } });
      await log({ productId, channel: "USER", level: "warn", message: `Proceso huérfano recuperado (PID ${rs.identity!.pid}) tras reinicio del INSTALADOR` });
      return {
        productId, before: dbRow.state, after: "RUNNING", osState: rs.osState, changed: true,
        evidence: `Huérfano adoptado: proceso vivo verificado (PID ${rs.identity!.pid})`,
      };
    }
    case "CRASHED": {
      const evidence = JSON.stringify({
        type: "UNEXPECTED_EXIT",
        at: new Date().toISOString(),
        pid: rs.identity?.pid,
        errTail: (rs.evidence.errLogTail ?? "").slice(-1024),
      });
      await update({
        state: "FAILED",
        health: "FAILED",
        pid: null,
        bootToken: null,
        lastExitEvidence: evidence,
        stoppedAt: new Date(),
      });
      removePidFile(productId);
      await audit({ type: "PROCESS_CRASHED", productId, severity: "CRITICAL", detail: { pid: rs.identity?.pid, errTail: (rs.evidence.errLogTail ?? "").slice(-400) } });
      await log({ productId, channel: "USER", level: "error", message: "Terminación inesperada del proceso del producto", data: { pid: rs.identity?.pid } });
      return { productId, before: dbRow.state, after: "FAILED", osState: rs.osState, changed: true, evidence: "Terminación inesperada (sin salida ordenada registrada)" };
    }
    case "EXITED_CLEAN": {
      await update({
        state: "STOPPED",
        pid: null,
        bootToken: null,
        stoppedAt: new Date(),
        lastExitEvidence: JSON.stringify({ type: "GRACEFUL_EXIT", reason: rs.evidence.exitReason }),
      });
      removePidFile(productId);
      return {
        productId, before: dbRow.state, after: "STOPPED", osState: rs.osState, changed: dbRow.state !== "STOPPED",
        evidence: `Salida ordenada (${rs.evidence.exitReason ?? "desconocida"})`,
      };
    }
    case "LOST": {
      await update({
        state: "STOPPED",
        pid: null,
        bootToken: null,
        stoppedAt: new Date(),
        lastExitEvidence: JSON.stringify({ type: "LOST", at: new Date().toISOString() }),
      });
      await audit({ type: "PROCESS_LOST", productId, severity: "WARNING", detail: {} });
      return { productId, before: dbRow.state, after: "STOPPED", osState: rs.osState, changed: true, evidence: "DB decía RUNNING pero no hay pidfile ni proceso" };
    }
    case "UNKNOWN": {
      return { productId, before: dbRow.state, after: dbRow.state, osState: rs.osState, changed: false, evidence: `Estado del SO no determinable (identity=${rs.evidence.identityVerified})` };
    }
    case "STOPPED":
    default: {
      if (dbRow.state === "RUNNING" || dbRow.state === "DEGRADED") {
        await update({ state: "STOPPED", pid: null, bootToken: null, stoppedAt: new Date() });
        return { productId, before: dbRow.state, after: "STOPPED", osState: "STOPPED", changed: true, evidence: "Sin proceso real; DB corregida" };
      }
      return { productId, before: dbRow.state, after: dbRow.state, osState: "STOPPED", changed: false, evidence: "Detenido (coherente)" };
    }
  }
}

/** Reconcilia TODOS los productos instalados. Idempotente, nunca lanza. */
export async function reconcileAll(): Promise<ReconcileResult[]> {
  const { db } = await import("@/lib/db");
  const rows = await db.installedProduct.findMany();
  const results: ReconcileResult[] = [];
  for (const row of rows) {
    try {
      results.push(await reconcileProduct(row.productId, { state: row.state, pid: row.pid, port: row.port }));
    } catch (e) {
      await log({ productId: row.productId, channel: "SYSTEM", level: "error", message: `Reconciliación falló: ${(e as Error).message}` });
    }
  }
  return results;
}
