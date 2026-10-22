/**
 * ALBRA — Installer Engine (LAYER 5) con máquina de estados completa:
 *
 * DISCOVER → PREFLIGHT → PLAN → CONFIRM → DOWNLOAD → VERIFY → PREPARE →
 * INSTALL → CONFIGURE → INITIALIZE → MIGRATE → REGISTER → START →
 * HEALTH CHECK → COMPLETE
 *
 * Instalación TRANSACCIONAL: PREPARE → STAGE → COMMIT → ROLLBACK.
 * Si algo falla, el sistema vuelve a un estado consistente.
 */
import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  PATHS, ensureDirs, productAppDir, productDataDir, productStagingDir, commitDirectory, writeFileAtomic,
} from "@/lib/albra/env";
import { getDeploymentAdapter, type PlatformInfo } from "@/lib/albra/adapters";
import { checkCompatibility, parseProductContract } from "@/lib/albra/contracts";
import { PACKAGE_BUILDS, getBaseVersion } from "@/lib/albra/products/catalog";
import { readPackageFile, verifyPackage, type AlbraPackage } from "@/lib/albra/package/format";
import { seedProductData } from "@/lib/albra/products/data";
import { withLock } from "@/lib/albra/core/registry";
import { runHealthChecks } from "@/lib/albra/core/health";
import { startProduct } from "@/lib/albra/core/runtime";
import { Run, sleep, registerRunPromise } from "@/lib/albra/core/runs";
import { log } from "@/lib/albra/core/logger";
import { audit } from "@/lib/albra/core/audit";

const STEP_DEFS = [
  { step: "DISCOVER", label: "Descubriendo paquetes disponibles" },
  { step: "PREFLIGHT", label: "Verificando requisitos del sistema" },
  { step: "PLAN", label: "Generando plan de instalación" },
  { step: "CONFIRM", label: "Confirmando operaciones" },
  { step: "DOWNLOAD", label: "Descargando paquete" },
  { step: "VERIFY", label: "Verificando hash y firma" },
  { step: "PREPARE", label: "Preparando instalación transaccional" },
  { step: "INSTALL", label: "Instalando aplicación" },
  { step: "CONFIGURE", label: "Configurando (usuario + sistema)" },
  { step: "INITIALIZE", label: "Inicializando datos" },
  { step: "MIGRATE", label: "Migraciones de esquema" },
  { step: "REGISTER", label: "Registrando en el registro local" },
  { step: "START", label: "Iniciando servicio" },
  { step: "HEALTH", label: "Verificación de salud" },
  { step: "COMPLETE", label: "Finalizando" },
];

export interface PreflightIssue {
  code: string;
  severity: "BLOCKER" | "WARNING" | "RESOLVED";
  message: string;
}

export interface PreflightReport {
  ok: boolean;
  issues: PreflightIssue[];
  platform: PlatformInfo;
  assignedPort?: number;
}

export async function preflight(packageId: string): Promise<PreflightReport> {
  ensureDirs();
  const adapter = getDeploymentAdapter();
  const platform = adapter.info();
  const build = PACKAGE_BUILDS.find(b => b.packageId === packageId && b.version === getBaseVersion(packageId));
  const issues: PreflightIssue[] = [];
  if (!build) {
    return { ok: false, platform, issues: [{ code: "PACKAGE_NOT_FOUND", severity: "BLOCKER", message: "Paquete no encontrado en la bóveda" }] };
  }
  const parsed = parseProductContract(build.contract);
  if (!parsed.ok) {
    issues.push({ code: "CONTRACT_INVALID", severity: "BLOCKER", message: `Contrato inválido: ${parsed.errors.join("; ")}` });
    return { ok: false, platform, issues };
  }
  const contract = parsed.contract!;

  // Compatibilidad de plataforma
  const compat = checkCompatibility({ platform: platform.platform, arch: platform.arch, platformVersion: platform.platformVersion, contract });
  if (compat.result !== "COMPATIBLE") {
    issues.push({ code: `COMPATIBILITY_${compat.result}`, severity: "BLOCKER", message: compat.reasons.join(" · ") });
  }

  // Espacio en disco
  if (platform.freeDiskMB < contract.requirements.minDiskMB) {
    issues.push({ code: "INSUFFICIENT_DISK", severity: "BLOCKER", message: `Se requieren ${contract.requirements.minDiskMB} MB libres; disponibles ${platform.freeDiskMB} MB` });
  } else {
    issues.push({ code: "DISK_OK", severity: "RESOLVED", message: `Espacio suficiente (${platform.freeDiskMB} MB libres)` });
  }

  // Dependencias — ALBRA las resuelve automáticamente cuando puede
  for (const dep of contract.dependencies) {
    if (dep.dependencyId.startsWith("albra-")) {
      issues.push({ code: "DEP_OK", severity: "RESOLVED", message: `Dependencia ${dep.dependencyId} provista por ALBRA Platform` });
    } else if (dep.autoInstallable) {
      issues.push({ code: "DEP_AUTINSTALL", severity: "RESOLVED", message: `Dependencia ${dep.dependencyId} se instalará automáticamente` });
    } else {
      issues.push({ code: "DEP_MISSING", severity: "BLOCKER", message: `Dependencia ${dep.dependencyId} no disponible` });
    }
  }

  // Instalación previa / conflictos
  const existing = await db.installedProduct.findUnique({ where: { productId: packageId } });
  if (existing) {
    issues.push({ code: "ALREADY_INSTALLED", severity: "BLOCKER", message: `${packageId} ya está instalado (versión ${existing.version}). Desinstálalo primero.` });
  }

  // Puertos — resolver conflictos automáticamente si es seguro
  let assignedPort: number | undefined;
  const port = await adapter.findFreePort(contract.requirements.preferredPorts);
  if (!port) {
    issues.push({ code: "NO_PORT_AVAILABLE", severity: "BLOCKER", message: "No hay puertos libres en el rango configurado" });
  } else {
    assignedPort = port;
    const preferred = contract.requirements.preferredPorts[0];
    issues.push({
      code: "PORT_RESOLVED",
      severity: port === preferred ? "RESOLVED" : "WARNING",
      message: port === preferred ? `Puerto preferido ${port} libre` : `Puerto ${preferred} ocupado → ALBRA reasignó automáticamente el puerto ${port}`,
    });
  }

  // Permisos de escritura
  try {
    fs.mkdirSync(PATHS.products, { recursive: true });
    fs.accessSync(PATHS.products, fs.constants.W_OK);
    issues.push({ code: "PERMISSIONS_OK", severity: "RESOLVED", message: "Permisos de escritura correctos" });
  } catch {
    issues.push({ code: "PERMISSION_DENIED", severity: "BLOCKER", message: "Sin permisos de escritura en el directorio de productos" });
  }

  return { ok: !issues.some(i => i.severity === "BLOCKER"), issues, platform, assignedPort };
}

export async function runInstall(packageId: string, opts?: { paceMs?: number }): Promise<{ runId: string }> {
  const pace = opts?.paceMs ?? 220;
  const run = await Run.create("INSTALL", packageId, STEP_DEFS);
  const runId = run.id;

  const flow = (async () => {
    const stagingDir = productStagingDir(packageId, runId);
    let staged: AlbraPackage | null = null;
    let stagedContractValid = false;
    let port: number | undefined;
    try {
      await withLock(packageId, async () => {
        // DISCOVER
        await run.begin("DISCOVER");
        await sleep(pace);
        const latest = getBaseVersion(packageId);
        if (!latest) throw new Error("PACKAGE_NOT_FOUND");
        await run.done("DISCOVER", "SUCCESS", `${packageId} v${latest} (versión base) descubierto en la bóveda`);

        // PREFLIGHT
        await run.begin("PREFLIGHT");
        await sleep(pace);
        const pre = await preflight(packageId);
        port = pre.assignedPort;
        if (!pre.ok) {
          const blockers = pre.issues.filter(i => i.severity === "BLOCKER").map(i => `${i.code}: ${i.message}`);
          throw new Error(`PREFLIGHT_FAILED — ${blockers.join(" | ")}`);
        }
        const autoResolved = pre.issues.filter(i => i.severity === "WARNING");
        await run.done("PREFLIGHT", autoResolved.length > 0 ? "WARNING" : "SUCCESS", pre.issues.map(i => i.message).join(" · "));

        // PLAN
        await run.begin("PLAN");
        await sleep(pace);
        await run.done("PLAN", "SUCCESS", `Instalar ${packageId} v${latest} en ${productAppDir(packageId)}`);

        // CONFIRM (automático: el usuario ya confirmó en la UI)
        await run.begin("CONFIRM");
        await sleep(pace);
        await run.done("CONFIRM", "SUCCESS", "Confirmado por el usuario desde el Launcher");

        // DOWNLOAD (desde la bóveda local → downloads/)
        await run.begin("DOWNLOAD");
        await sleep(pace);
        const fileName = `${packageId}-${latest}.albra`;
        const pkg = readPackageFile(fileName);
        if (!pkg) throw new Error("PACKAGE_FILE_MISSING");
        const dlPath = path.join(PATHS.downloads, fileName);
        writeFileAtomic(dlPath, JSON.stringify(pkg));
        await run.done("DOWNLOAD", "SUCCESS", `Paquete descargado (${(fs.statSync(dlPath).size / 1024).toFixed(1)} KB)`);

        // VERIFY — hash + firma. Nunca instalar paquetes inválidos.
        await run.begin("VERIFY");
        await sleep(pace);
        const verdict = verifyPackage(JSON.parse(fs.readFileSync(dlPath, "utf-8")));
        if (!verdict.valid) {
          await audit({ type: "PACKAGE_REJECTED", productId: packageId, severity: "ERROR", detail: { reason: verdict.reason } });
          throw new Error(`PACKAGE_INVALID — ${verdict.reason}`);
        }
        await audit({ type: "PACKAGE_VERIFIED", productId: packageId, detail: { packageHash: verdict.packageHash.slice(0, 16) + "…" } });
        await run.done("VERIFY", "SUCCESS", `SHA-256 y firma HMAC válidos (${verdict.packageHash.slice(0, 12)}…)`);

        // PREPARE (transaccional: staging)
        await run.begin("PREPARE");
        await sleep(pace);
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });
        await run.done("PREPARE", "SUCCESS", "Área de staging creada");

        // INSTALL (stage archivos)
        await run.begin("INSTALL");
        await sleep(pace);
        for (const file of pkg.payload.application) {
          const target = path.join(stagingDir, file.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, file.content, "utf-8");
        }
        // Verificación de archivos staged
        for (const file of pkg.payload.application) {
          const onDisk = fs.readFileSync(path.join(stagingDir, file.path), "utf-8");
          if (onDisk !== file.content) throw new Error(`STAGE_CHECKSUM_MISMATCH: ${file.path}`);
        }
        staged = pkg;
        stagedContractValid = parseProductContract(pkg.contract).ok;
        if (!stagedContractValid) throw new Error("CONTRACT_INVALID_AFTER_STAGE");
        await run.done("INSTALL", "SUCCESS", `${pkg.payload.application.length} archivos verificados en staging`);

        // CONFIGURE (separación USER / SYSTEM / PRODUCT; sin .env para el usuario)
        await run.begin("CONFIGURE");
        await sleep(pace);
        const contract2 = parseProductContract(pkg.contract).contract!;
        const userValues: Record<string, unknown> = {};
        const systemValues: Record<string, unknown> = { port, dataPath: productDataDir(packageId), runtimeMode: "managed" };
        const productValues: Record<string, unknown> = { schemaVersion: 1 };
        for (const field of contract2.configuration.fields) {
          if (field.type === "secret") continue;
          if (field.defaultValue !== undefined) {
            if (field.scope === "USER") userValues[field.key] = field.defaultValue;
            if (field.scope === "SYSTEM") systemValues[field.key] = systemValues[field.key] ?? field.defaultValue;
            if (field.scope === "PRODUCT") productValues[field.key] = productValues[field.key] ?? field.defaultValue;
          }
        }
        await db.configRecord.upsert({ where: { productId_scope: { productId: packageId, scope: "USER" } }, create: { productId: packageId, scope: "USER", values: userValues as Prisma.InputJsonValue }, update: { values: userValues as Prisma.InputJsonValue } });
        await db.configRecord.upsert({ where: { productId_scope: { productId: packageId, scope: "SYSTEM" } }, create: { productId: packageId, scope: "SYSTEM", values: systemValues as Prisma.InputJsonValue }, update: { values: systemValues as Prisma.InputJsonValue } });
        await db.configRecord.upsert({ where: { productId_scope: { productId: packageId, scope: "PRODUCT" } }, create: { productId: packageId, scope: "PRODUCT", values: productValues as Prisma.InputJsonValue }, update: { values: productValues as Prisma.InputJsonValue } });
        for (const prov of contract2.providers.providers) {
          await db.providerRecord.upsert({
            where: { providerId_productId: { providerId: prov.providerId, productId: packageId } },
            create: { providerId: prov.providerId, productId: packageId, status: "DISCOVERED", meta: { label: prov.label, kind: prov.kind } },
            update: { meta: { label: prov.label, kind: prov.kind } },
          });
        }
        await run.done("CONFIGURE", "SUCCESS", "Configuración USER/SYSTEM/PRODUCT inicializada (sin .env)");

        // INITIALIZE (seeds de datos del producto)
        await run.begin("INITIALIZE");
        await sleep(pace);
        const seeded = await seedProductData(packageId);
        await run.done("INITIALIZE", "SUCCESS", seeded > 0 ? `${seeded} registros iniciales creados` : "Datos existentes conservados");

        // MIGRATE (nada en instalación fresca)
        await run.begin("MIGRATE");
        await sleep(pace);
        await run.done("MIGRATE", "SKIPPED", "Instalación fresca: sin migraciones pendientes");

        // COMMIT — instalación transaccional: staging → app
        await run.begin("REGISTER");
        await sleep(pace);
        commitDirectory(stagingDir, productAppDir(packageId));
        fs.mkdirSync(productDataDir(packageId), { recursive: true });
        await db.installedProduct.upsert({
          where: { productId: packageId },
          create: {
            productId: packageId,
            displayName: pkg.manifest.displayName,
            vendor: "ALBRA",
            version: pkg.manifest.version,
            channel: pkg.manifest.channel,
            state: "INSTALLED",
            port,
            installPath: productAppDir(packageId),
            dataPath: productDataDir(packageId),
            packageHash: verdict.packageHash,
            entitlement: null,
            installedAt: new Date(),
          },
          update: {
            version: pkg.manifest.version,
            state: "INSTALLED",
            port,
            packageHash: verdict.packageHash,
            installedAt: new Date(),
          },
        });
        await run.done("REGISTER", "SUCCESS", `Registrado v${pkg.manifest.version} (commit transaccional completado)`);

        // START
        await run.begin("START");
        await sleep(pace);
        const startRes = await startProduct(packageId);
        if (!startRes.ok) throw new Error(`SERVICE_START_FAILED — ${startRes.error}`);
        await run.done("START", "SUCCESS", `Servicio activo en puerto ${startRes.port}`);

        // HEALTH CHECK
        await run.begin("HEALTH");
        await sleep(pace);
        const health = await runHealthChecks(packageId);
        if (health.overall === "FAILED") throw new Error("HEALTH_CHECK_FAILED");
        await run.done("HEALTH", health.overall === "HEALTHY" ? "SUCCESS" : "WARNING", `Salud: ${health.overall} (${health.checks.filter(c => c.status === "PASS").length}/${health.checks.length} checks OK)`);

        // COMPLETE
        await run.begin("COMPLETE");
        await sleep(pace);
        await run.done("COMPLETE", "SUCCESS", "Instalación completada");
        await run.finish("SUCCESS", { version: pkg.manifest.version, port: startRes.port });
        await audit({ type: "INSTALL_COMPLETED", productId: packageId, detail: { version: pkg.manifest.version, port } });
      });
    } catch (e) {
      const message = (e as Error).message;
      // ROLLBACK transaccional: eliminar staging y volver a estado consistente.
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        const reg = await db.installedProduct.findUnique({ where: { productId: packageId } });
        if (reg && reg.state === "INSTALLED" && !reg.runtimeHandle) {
          await db.installedProduct.delete({ where: { productId: packageId } });
        }
      } catch { /* best effort */ }
      // Marcar pasos pendientes como fallidos
      for (const s of run.steps) {
        if (s.status === "PENDING") s.status = "SKIPPED";
        if (s.status === "RUNNING") { s.status = "FAILURE"; s.detail = message; }
      }
      await run.finish("FAILURE", undefined, message);
      await audit({ type: "INSTALL_FAILED", productId: packageId, severity: "ERROR", detail: { error: message } });
      await log({ productId: packageId, level: "error", message: `Instalación fallida: ${message}` });
    }
  })();

  registerRunPromise(runId, flow);
  return { runId };
}
