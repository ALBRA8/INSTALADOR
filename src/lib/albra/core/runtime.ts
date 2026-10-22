/**
 * ALBRA — LAYER 3/5: Runtime Manager (START / STOP / RESTART / STATUS / HEALTH)
 * El usuario ve "🟢 Funcionando", no procesos internos.
 */
import { db } from "@/lib/db";
import { log } from "@/lib/albra/core/logger";
import { audit } from "@/lib/albra/core/audit";
import { getDeploymentAdapter } from "@/lib/albra/adapters";

export async function startProduct(productId: string): Promise<{ ok: boolean; port?: number; error?: string }> {
  const product = await db.installedProduct.findUnique({ where: { productId } });
  if (!product) return { ok: false, error: "PRODUCT_NOT_INSTALLED" };
  if (product.state === "RUNNING") return { ok: true, port: product.port ?? undefined };

  const adapter = getDeploymentAdapter();
  let port = product.port ?? undefined;
  if (!port) {
    const preferred = productId === "crm" ? [4101, 4111, 4121] : productId === "leads" ? [4102, 4112, 4122] : [4190, 4191];
    port = (await adapter.findFreePort(preferred)) ?? undefined;
    if (!port) return { ok: false, error: "NO_PORT_AVAILABLE" };
  }

  await db.installedProduct.update({
    where: { productId },
    data: {
      state: "RUNNING",
      port,
      runtimeHandle: `albra-runtime-${productId}-${Date.now().toString(36)}`,
      startedAt: new Date(),
      stoppedAt: null,
      health: "UNKNOWN",
    },
  });
  await log({ productId, channel: "USER", level: "info", message: `Producto iniciado en puerto ${port}`, data: { port } });
  await audit({ type: "START_COMPLETED", productId, detail: { port } });
  return { ok: true, port };
}

export async function stopProduct(productId: string): Promise<{ ok: boolean; error?: string }> {
  const product = await db.installedProduct.findUnique({ where: { productId } });
  if (!product) return { ok: false, error: "PRODUCT_NOT_INSTALLED" };
  await db.installedProduct.update({
    where: { productId },
    data: { state: "STOPPED", runtimeHandle: null, stoppedAt: new Date() },
  });
  await log({ productId, channel: "USER", level: "info", message: "Producto detenido" });
  await audit({ type: "STOP_COMPLETED", productId });
  return { ok: true };
}

export async function restartProduct(productId: string): Promise<{ ok: boolean; error?: string }> {
  await stopProduct(productId);
  const res = await startProduct(productId);
  return res;
}

export async function isRunning(productId: string): Promise<boolean> {
  const p = await db.installedProduct.findUnique({ where: { productId }, select: { state: true } });
  return p?.state === "RUNNING";
}
