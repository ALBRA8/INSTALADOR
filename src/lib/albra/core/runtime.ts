/**
 * ALBRA V2 — Runtime Manager REAL (START / STOP / RESTART / STATUS / EVIDENCIA)
 *
 * Diferencia clave vs V1: las operaciones crean y destruyen PROCESOS REALES
 * del sistema operativo. La DB registra evidencia, no es la fuente de verdad:
 * el estado real se verifica en el SO (pidfile + identidad + /health autenticado).
 */
import { db } from "@/lib/db";
import { log } from "@/lib/albra/core/logger";
import { audit } from "@/lib/albra/core/audit";
import { getDeploymentAdapter } from "@/lib/albra/adapters";
import { withLock } from "@/lib/albra/core/registry";
import {
  spawnProductProcess,
  stopProductProcess,
  readRuntimeState,
  reconcileProduct,
  removePidFile,
  waitUntilHealthy,
  probeHealth,
  isPortServing,
  type RuntimeEvidence,
} from "@/lib/albra/core/process-runtime";

const PORT_PREFERENCES: Record<string, number[]> = {
  crm: [4101, 4111, 4121],
  leads: [4102, 4112, 4122],
};

/** Núcleo sin lock — SOLO para motores que ya sostienen el lock del producto (re-entrada). */
export async function startProductCore(productId: string): Promise<{ ok: boolean; port?: number; pid?: number; error?: string; detail?: string }> {
  return startProductInner(productId);
}

/** Núcleo sin lock para stopProduct. */
export async function stopProductCore(productId: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
  return stopProductInner(productId);
}

export async function startProduct(productId: string): Promise<{ ok: boolean; port?: number; pid?: number; error?: string; detail?: string }> {
  return withLock(productId, () => startProductInner(productId));
}

async function startProductInner(productId: string): Promise<{ ok: boolean; port?: number; pid?: number; error?: string; detail?: string }> {
    const product = await db.installedProduct.findUnique({ where: { productId } });
    if (!product) return { ok: false, error: "PRODUCT_NOT_INSTALLED" };

    // 1) Estado REAL del SO (no confiar en la DB)
    const rs = await readRuntimeState(productId, product.state === "RUNNING");

    if (rs.osState === "RUNNING" && rs.identity) {
      return { ok: true, port: rs.identity.port, pid: rs.identity.pid };
    }
    if (rs.osState === "ORPHAN_RUNNING" && rs.identity) {
      // huérfano recuperable → adoptar sin crear duplicados
      const rec = await reconcileProduct(productId, { state: product.state, pid: product.pid, port: product.port });
      await log({ productId, channel: "USER", level: "info", message: `Instancia existente adoptada (PID ${rs.identity.pid})` });
      return { ok: true, port: rs.identity.port, pid: rs.identity.pid, detail: rec.evidence };
    }
    if (rs.osState === "CRASHED") {
      await log({ productId, channel: "USER", level: "warn", message: "Reinicio tras terminación inesperada", data: { pid: rs.identity?.pid } });
      removePidFile(productId);
    }
    if (rs.osState === "UNKNOWN") {
      await audit({ type: "START_FAILED", productId, severity: "ERROR", detail: { reason: "RUNTIME_UNKNOWN", evidence: rs.evidence } });
      return { ok: false, error: "RUNTIME_UNKNOWN", detail: "No se pudo verificar la identidad del proceso existente. No se iniciará un duplicado." };
    }

    // 2) Puerto: reutilizar el asignado si está libre; si no, resolver automáticamente
    const adapter = getDeploymentAdapter();
    const preferred = [...(product.port ? [product.port] : []), ...(PORT_PREFERENCES[productId] ?? [4190, 4191])];
    let port: number | null = null;
    for (const candidate of preferred) {
      if (await adapter.isPortFree(candidate)) {
        port = candidate;
        break;
      }
    }
    if (port === null) port = await adapter.findFreePort([preferred[0] + 100, 4200], 20);
    if (port === null) {
      await audit({ type: "START_FAILED", productId, severity: "ERROR", detail: { reason: "NO_PORT_AVAILABLE" } });
      return { ok: false, error: "NO_PORT_AVAILABLE" };
    }

    // 3) Spawn real + espera de /health autenticado
    const spawnRes = spawnProductProcess({ productId, version: product.version, port });
    if (!spawnRes.ok) {
      await audit({ type: "START_FAILED", productId, severity: "ERROR", detail: { reason: spawnRes.error, detail: spawnRes.detail } });
      return { ok: false, error: spawnRes.error, detail: spawnRes.detail };
    }
    const health = await waitUntilHealthy(productId);
    if (!health.ok) {
      // limpieza compensatoria: el proceso quedó mal nacido → terminar y evidenciar
      await stopProductProcess(productId, { force: true, timeoutMs: 4000 });
      await db.installedProduct.update({
        where: { productId },
        data: { state: "STOPPED", pid: null, bootToken: null, stoppedAt: new Date(), lastExitEvidence: JSON.stringify({ type: "START_FAILED", reason: health.error }) },
      });
      await audit({ type: "START_FAILED", productId, severity: "ERROR", detail: { reason: health.error, detail: health.detail, pid: spawnRes.pid } });
      await log({ productId, channel: "USER", level: "error", message: `El producto no quedó operativo: ${health.error}`, data: { detail: health.detail?.slice(0, 300) } });
      return { ok: false, error: health.error, detail: health.detail };
    }

    // 4) Registro con evidencia real
    await db.installedProduct.update({
      where: { productId },
      data: {
        state: "RUNNING",
        health: "UNKNOWN",
        port,
        pid: spawnRes.pid,
        bootToken: spawnRes.bootToken,
        runtimeHandle: `pid:${spawnRes.pid}`,
        startedAt: new Date(),
        stoppedAt: null,
        lastExitEvidence: null,
      },
    });
    await log({ productId, channel: "USER", level: "info", message: `Producto iniciado (PID ${spawnRes.pid}, puerto ${port})`, data: { pid: spawnRes.pid, port } });
    await audit({ type: "START_COMPLETED", productId, detail: { pid: spawnRes.pid, port, verifiedBy: "health-endpoint" } });
    return { ok: true, port, pid: spawnRes.pid };
}

export async function stopProduct(productId: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
  return withLock(productId, () => stopProductInner(productId));
}

async function stopProductInner(productId: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const product = await db.installedProduct.findUnique({ where: { productId } });
  if (!product) return { ok: false, error: "PRODUCT_NOT_INSTALLED" };

  const res = await stopProductProcess(productId);
  if (!res.stopped) {
    await audit({ type: res.error === "IDENTITY_MISMATCH" ? "PROCESS_IDENTITY_MISMATCH" : "STOP_FAILED", productId, severity: "ERROR", detail: { evidence: res.evidence } });
    return { ok: false, error: res.error ?? "STOP_FAILED", detail: res.evidence };
  }
  await db.installedProduct.update({
    where: { productId },
    data: {
      state: "STOPPED",
      pid: null,
      bootToken: null,
      stoppedAt: new Date(),
      lastExitEvidence: JSON.stringify({ type: res.forced ? "FORCED_STOP" : "GRACEFUL_STOP", evidence: res.evidence }),
    },
  });
  await log({ productId, channel: "USER", level: "info", message: `Producto detenido (${res.evidence})` });
  await audit({ type: "STOP_COMPLETED", productId, detail: { forced: res.forced, evidence: res.evidence } });
  return { ok: true, detail: res.evidence };
}

export async function restartProduct(productId: string): Promise<{ ok: boolean; port?: number; pid?: number; error?: string; detail?: string }> {
  await stopProductCore(productId); // tolera "ya detenido"
  return startProductCore(productId);
}

/** ¿Está realmente vivo en el SO? (nunca solo la DB) */
export async function isRunning(productId: string): Promise<boolean> {
  const product = await db.installedProduct.findUnique({ where: { productId }, select: { state: true, pid: true, port: true } });
  if (!product) return false;
  const rs = await readRuntimeState(productId, product.state === "RUNNING");
  return rs.osState === "RUNNING" || rs.osState === "ORPHAN_RUNNING";
}

/** Evidencia de proceso real para la GUI (PID, uptime, último check, puerto). */
export async function getRuntimeEvidence(productId: string): Promise<RuntimeEvidence & { portServing?: boolean; healthProbe?: { ok: boolean; latencyMs?: number; error?: string } }> {
  const product = await db.installedProduct.findUnique({ where: { productId }, select: { state: true, pid: true, port: true, bootToken: true, lastExitEvidence: true, lastHealthAt: true } });
  if (!product) {
    return { osState: "STOPPED" };
  }
  const rs = await readRuntimeState(productId, product.state === "RUNNING");
  const evidence: RuntimeEvidence & { portServing?: boolean; healthProbe?: { ok: boolean; latencyMs?: number; error?: string } } = { ...rs.evidence };
  if (rs.identity && (rs.osState === "RUNNING" || rs.osState === "ORPHAN_RUNNING")) {
    evidence.portServing = await isPortServing(rs.identity.port);
    if (product.bootToken) {
      evidence.healthProbe = await probeHealth(rs.identity.port, product.bootToken, rs.identity.pid, 2000);
    }
  }
  return evidence;
}
