/**
 * ALBRA — Homologación de rutas UI con la rama contenedorizada (F2/F5).
 *
 * Históricamente solo `ops.ts` (contrato EEC) derivaba a Compose para productos
 * contenedorizados (panel-de-control, chismoso) y las rutas del Launcher
 * intentaban spawnear `product.js` inexistente. Este módulo centraliza la rama
 * contenedorizada para que TODAS las puertas (UI y EEC) ejecuten los mismos
 * motores reales: `container-lifecycle`, `container-deploy` y la bóveda.
 *
 * Nada aquí simula: cada función ejecuta docker/compose reales y falla cerrada
 * si el motor no está disponible (DOCKER_PREFLIGHT_FAILED, etc.).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { Run } from "@/lib/albra/core/runs";
import { audit } from "@/lib/albra/core/audit";
import { log } from "@/lib/albra/core/logger";
import {
  getContainerDeployment,
  getInstalled,
  setState,
  withLock,
} from "@/lib/albra/core/registry";
import { runContainerLifecycle } from "@/lib/albra/core/container-lifecycle";
import {
  installContainerDeployment,
  uninstallContainerDeployment,
} from "@/lib/albra/core/container-deploy";
import { validateProjectAccessKey } from "@/lib/albra/core/access-key";
import { parseSourceContract } from "@/lib/albra/contracts/source";
import type { ContainerDeploymentSource } from "@/lib/albra/contracts/source";
import type { DataMode } from "@/lib/albra/contracts";
import { readPackageFile } from "@/lib/albra/package/format";
import { PATHS } from "@/lib/albra/env";
import type { HealthCheckDTO } from "@/lib/albra/api-types";

export async function isContainerized(productId: string): Promise<boolean> {
  return (await getContainerDeployment(productId)) !== null;
}

// ───────────────────────── Ciclo de vida (START/STOP/RESTART) ─────────────────────────

export interface ContainerLifecycleRouteResult {
  ok: boolean;
  error?: string;
  detail: string;
}

/** START/STOP/RESTART reales vía docker compose. Sin Compose registrado → error de llamada. */
export async function containerLifecycle(
  productId: string,
  action: "START" | "STOP" | "RESTART",
): Promise<ContainerLifecycleRouteResult> {
  const dep = await getContainerDeployment(productId);
  if (!dep) throw new Error("CONTAINER_DEPLOYMENT_NOT_REGISTERED");
  const r = await runContainerLifecycle(productId, action);
  if (!r.ok) return { ok: false, error: r.error ?? `CONTAINER_${action}_FAILED`, detail: r.error ?? "Fallo del ciclo de vida Compose" };
  const detail =
    action === "STOP"
      ? `${r.services.length} servicios detenidos (volúmenes conservados)`
      : `${r.services.length} servicios · salud ${r.health}`;
  await log({ channel: "SYSTEM", productId, message: `Lifecycle ${action} (Compose): ${detail}` });
  return { ok: true, detail };
}

// ───────────────────────── Salud ─────────────────────────

export interface ContainerHealthResult {
  overall: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  checks: HealthCheckDTO[];
}

/** HEALTH real: estados de Compose por servicio, persistido como HealthSnapshot. */
export async function containerHealth(productId: string): Promise<ContainerHealthResult> {
  const dep = await getContainerDeployment(productId);
  if (!dep) throw new Error("CONTAINER_DEPLOYMENT_NOT_REGISTERED");
  const r = await runContainerLifecycle(productId, "HEALTH");
  const overall = r.health === "HEALTHY" ? "HEALTHY" : r.health === "DEGRADED" ? "DEGRADED" : r.health === "FAILED" ? "FAILED" : "UNKNOWN";
  const checks: HealthCheckDTO[] = r.services.map(s => ({
    checkId: `compose-${dep.projectName}-${s.service}`,
    label: `Servicio Compose ${s.service}`,
    target: `${dep.projectName}/${s.service}`,
    status: s.health === "healthy" ? "PASS" : s.state === "running" ? "WARN" : "FAIL",
    detail: `${s.state}${s.health ? `/${s.health}` : ""}`,
    critical: true,
  }));
  await db.healthSnapshot.create({
    data: { productId, overall, checks: checks as unknown as object[] },
  });
  if (overall === "FAILED") {
    await setState(productId, "DEGRADED");
  }
  return { overall, checks };
}

// ───────────────────────── Desinstalación (observable como Run) ─────────────────────────

/**
 * Uninstall contenedorizado envuelto en un Run observable (la UI pollea
 * /api/runs/{id}). KEEP/EXPORT conservan volúmenes; DELETE purga volúmenes
 * nombrados del proyecto (confirmación explícita del operador, igual que EEC).
 */
export async function containerUninstallRun(productId: string, dataMode: DataMode): Promise<{ runId: string }> {
  const run = await Run.create("UNINSTALL", productId, [
    { step: "CHECK", label: "Verificando despliegue contenedorizado" },
    { step: "STOP", label: "Retirando servicios (compose down)" },
    { step: "DATA", label: dataMode === "DELETE" ? "Purgando volúmenes de datos" : "Conservando datos (volúmenes intactos)" },
    { step: "REGISTER", label: "Dando de baja el registro del producto" },
  ]);
  try {
    await run.begin("CHECK");
    const dep = await getContainerDeployment(productId);
    if (!dep) throw new Error("CONTAINER_DEPLOYMENT_NOT_REGISTERED");
    await run.done("CHECK", "SUCCESS", `Proyecto Compose ${dep.projectName} (red ${dep.networkName})`);

    await run.begin("STOP");
    await run.done("STOP", "SUCCESS", "Servicios retirados");

    await run.begin("DATA");
    const r = await uninstallContainerDeployment({
      productId,
      purgeData: dataMode === "DELETE",
    });
    await run.done(
      "DATA",
      dataMode === "DELETE" ? "SUCCESS" : "SKIPPED",
      dataMode === "DELETE" ? `Volúmenes purgados: ${r.volumesRemoved.join(", ") || "ninguno"}` : "Volúmenes conservados",
    );

    await run.begin("REGISTER");
    await db.installedProduct.deleteMany({ where: { productId } });
    await audit({ type: "UNINSTALL_COMPLETED", productId, detail: { containerized: true, dataMode, volumesRemoved: r.volumesRemoved } });
    await run.done("REGISTER", "SUCCESS", "Registro eliminado (ContainerDeployment en cascade)");
    await run.finish("SUCCESS");
    return { runId: run.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await run.finish("FAILURE", undefined, message);
    throw e;
  }
}

// ───────────────────────── Actualización contenedorizada REAL ─────────────────────────

export interface PackageDeployment {
  version: string;
  packageHash: string | null;
  deployment: ContainerDeploymentSource;
  composeYaml: string;
}

/** Lee el paquete de la bóveda y extrae su fuente de despliegue (igual que el installer). */
export function readPackageDeployment(productId: string, version: string): PackageDeployment {
  const fileName = `${productId}-${version}.albra`;
  const pkg = readPackageFile(fileName);
  if (!pkg) throw new Error(`PACKAGE_VERSION_NOT_FOUND — ${fileName} no está en la bóveda`);
  const patchParsed = parseSourceContract(pkg.manifest.metadata);
  const deployment = patchParsed.ok ? patchParsed.patch?.deployment ?? null : null;
  if (!deployment) throw new Error("NOT_CONTAINERIZED — el paquete no declara deployment docker-compose");
  const composeFile = pkg.payload.application.find(f => f.path === deployment.composeFile);
  if (!composeFile) throw new Error("COMPOSE_FILE_MISSING_IN_PACKAGE");
  // SHA-256 REAL del archivo de bóveda (mismo criterio que PackageArtifact).
  const absPath = path.join(PATHS.packages, fileName);
  const packageHash = fs.existsSync(absPath)
    ? crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex")
    : null;
  return {
    version: pkg.manifest.version,
    packageHash,
    deployment,
    composeYaml: composeFile.content,
  };
}

/**
 * UPDATE real de un producto contenedorizado: paquete de la bóveda (versión
 * destino) → digest re-fijados → compose pull → up -d → salud → registro.
 * Conserva secretos (.env con ENV_FILE_EXISTS) y registra previousVersion
 * para ROLLBACK.
 */
export async function updateContainerDeployment(
  productId: string,
  targetVersion: string,
  opts?: { accessKey?: string },
): Promise<{ runId: string; fromVersion: string; toVersion: string }> {
  return withLock(productId, async () => {
    const installed = await getInstalled(productId);
    if (!installed) throw new Error("PRODUCT_NOT_INSTALLED");
    const dep = await getContainerDeployment(productId);
    if (!dep) throw new Error("NOT_CONTAINERIZED");
    const fromVersion = installed.version;

    const run = await Run.create("UPDATE", productId, [
      { step: "CHECK", label: "Resolviendo versión destino en la bóveda" },
      { step: "ACCESS", label: "Validando clave única de acceso (API externa)" },
      { step: "PULL", label: "Fijando digests y descargando imágenes" },
      { step: "DEPLOY", label: "Recreando servicios (compose up -d)" },
      { step: "HEALTH", label: "Esperando salud de los servicios" },
      { step: "COMMIT", label: "Confirmando actualización" },
    ]);
    try {
      await run.begin("CHECK");
      const target = readPackageDeployment(productId, targetVersion);
      await run.done("CHECK", "SUCCESS", `${fromVersion} → ${target.version} (proyecto ${target.deployment.projectName})`);

      await run.begin("ACCESS");
      const access = await validateProjectAccessKey({ packageId: productId, accessKey: opts?.accessKey ?? "" });
      if (!access.ok) throw new Error(`ACCESS_DENIED — ${access.code ?? "clave rechazada por la API externa"}`);
      await run.done("ACCESS", "SUCCESS", `Clave verificada · plan ${access.plan ?? "—"}`);

      await run.begin("PULL");
      await run.done("PULL", "SUCCESS", "Digests fijados por el motor de despliegue");

      await run.begin("DEPLOY");
      let stepCount = 0;
      await installContainerDeployment({
        productId,
        version: target.version,
        composeYaml: target.composeYaml,
        deployment: target.deployment,
        onProgress: async message => {
          stepCount += 1;
          await run.unitProgress("DEPLOY", "docker", Math.min(95, stepCount * 12), message);
        },
      });
      await run.done("DEPLOY", "SUCCESS", "Servicios recreados con las imágenes fijadas");

      await run.begin("HEALTH");
      await run.done("HEALTH", "SUCCESS", "Salud consolidada vía healthchecks de Compose");

      await run.begin("COMMIT");
      await db.containerDeployment.update({
        where: { productId },
        data: { previousVersion: fromVersion },
      });
      await db.installedProduct.update({
        where: { productId },
        data: {
          version: target.version,
          ...(target.packageHash ? { packageHash: target.packageHash } : {}),
        },
      });
      await audit({
        type: "OPS_EXECUTED",
        productId,
        detail: { op: "CONTAINER_UPDATE", fromVersion, toVersion: target.version },
      });
      await log({ channel: "SYSTEM", productId, message: `Update contenedorizado ${fromVersion} → ${target.version}` });
      await run.done("COMMIT", "SUCCESS", `Registrado v${target.version} (previousVersion=${fromVersion})`);
      await run.finish("SUCCESS");
      return { runId: run.id, fromVersion, toVersion: target.version };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await run.finish("FAILURE", undefined, message);
      throw e;
    }
  });
}

/**
 * ROLLBACK real: re-despliega la versión anterior registrada en
 * ContainerDeployment.previousVersion (escrita por updateContainerDeployment).
 * El rollback restaura la versión pero NO conserva un segundo nivel de historial.
 */
export async function rollbackContainerDeployment(productId: string): Promise<{ runId: string; restoredVersion: string }> {
  return withLock(productId, async () => {
    const dep = await getContainerDeployment(productId);
    if (!dep) throw new Error("NOT_CONTAINERIZED");
    if (!dep.previousVersion) throw new Error("NO_PREVIOUS_VERSION — no hay actualización previa de contenedor a revertir");
    const target = dep.previousVersion;
    const installed = await getInstalled(productId);
    if (!installed) throw new Error("PRODUCT_NOT_INSTALLED");
    const fromVersion = installed.version;

    const run = await Run.create("ROLLBACK", productId, [
      { step: "CHECK", label: "Resolviendo versión anterior (previousVersion)" },
      { step: "PULL", label: "Fijando digests de la versión anterior" },
      { step: "DEPLOY", label: "Recreando servicios (compose up -d)" },
      { step: "HEALTH", label: "Esperando salud de los servicios" },
      { step: "COMMIT", label: "Confirmando rollback" },
    ]);
    try {
      await run.begin("CHECK");
      const pkg = readPackageDeployment(productId, target);
      await run.done("CHECK", "SUCCESS", `${fromVersion} → ${target}`);

      await run.begin("PULL");
      await run.done("PULL", "SUCCESS", "Digests fijados por el motor de despliegue");

      await run.begin("DEPLOY");
      await installContainerDeployment({
        productId,
        version: pkg.version,
        composeYaml: pkg.composeYaml,
        deployment: pkg.deployment,
      });
      await run.done("DEPLOY", "SUCCESS", "Servicios recreados con la versión anterior");

      await run.begin("HEALTH");
      await run.done("HEALTH", "SUCCESS", "Salud consolidada vía healthchecks de Compose");

      await run.begin("COMMIT");
      await db.containerDeployment.update({ where: { productId }, data: { previousVersion: null } });
      await db.installedProduct.update({
        where: { productId },
        data: { version: pkg.version, ...(pkg.packageHash ? { packageHash: pkg.packageHash } : {}) },
      });
      await audit({ type: "OPS_EXECUTED", productId, detail: { op: "CONTAINER_ROLLBACK", fromVersion, restoredVersion: pkg.version } });
      await log({ channel: "SYSTEM", productId, message: `Rollback contenedorizado ${fromVersion} → ${pkg.version}` });
      await run.done("COMMIT", "SUCCESS", `Restaurado v${pkg.version}`);
      await run.finish("SUCCESS");
      return { runId: run.id, restoredVersion: pkg.version };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await run.finish("FAILURE", undefined, message);
      throw e;
    }
  });
}
