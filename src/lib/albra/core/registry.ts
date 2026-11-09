/**
 * ALBRA — Registry (LAYER 5): registro local de productos instalados.
 */
import { db } from "@/lib/db";
import type { ContainerDeployment, InstalledProduct, Prisma } from "@prisma/client";

export async function getContainerDeployment(productId: string): Promise<ContainerDeployment | null> {
  return db.containerDeployment.findUnique({ where: { productId } });
}

export async function listContainerDeployments(): Promise<ContainerDeployment[]> {
  return db.containerDeployment.findMany({ orderBy: { createdAt: "asc" } });
}

export async function registerContainerDeployment(input: {
  productId: string;
  projectName: string;
  installPath: string;
  composeFile: string;
  envFile: string;
  networkName: string;
  imageDigests: Prisma.InputJsonValue;
}): Promise<ContainerDeployment> {
  return db.containerDeployment.upsert({
    where: { productId: input.productId },
    create: {
      ...input,
      desiredState: "STOPPED",
      observedState: "UNKNOWN",
      health: "UNKNOWN",
    },
    update: {
      projectName: input.projectName,
      installPath: input.installPath,
      composeFile: input.composeFile,
      envFile: input.envFile,
      networkName: input.networkName,
      imageDigests: input.imageDigests,
      observedState: "UNKNOWN",
      health: "UNKNOWN",
      lastError: null,
    },
  });
}

export async function updateContainerDeploymentState(
  productId: string,
  state: {
    desiredState?: "RUNNING" | "STOPPED";
    observedState?: "RUNNING" | "STOPPED" | "DEGRADED" | "UNKNOWN";
    health?: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
    lastError?: string | null;
  },
): Promise<ContainerDeployment> {
  return db.containerDeployment.update({
    where: { productId },
    data: { ...state, lastObservedAt: new Date() },
  });
}


export async function getInstalled(productId: string): Promise<InstalledProduct | null> {
  return db.installedProduct.findUnique({ where: { productId } });
}

export async function requireInstalled(productId: string): Promise<InstalledProduct> {
  const p = await getInstalled(productId);
  if (!p) throw new Error("PRODUCT_NOT_INSTALLED");
  return p;
}

export async function listInstalled(): Promise<InstalledProduct[]> {
  return db.installedProduct.findMany({ orderBy: { createdAt: "asc" } });
}

export async function setState(productId: string, state: string): Promise<void> {
  await db.installedProduct.update({ where: { productId }, data: { state } });
}

/**
 * ALBRA — Lock de operaciones: una operación de ciclo de vida a la vez
 * por producto (evita instalaciones/actualizaciones concurrentes).
 */
const locks = new Set<string>();

export function isLocked(productId: string): boolean {
  return locks.has(productId);
}

export async function withLock<T>(productId: string, fn: () => Promise<T>): Promise<T> {
  if (locks.has(productId)) throw new Error("PRODUCT_BUSY");
  locks.add(productId);
  try {
    return await fn();
  } finally {
    locks.delete(productId);
  }
}
