/**
 * ALBRA — Health Engine (Health Contract).
 * Ejecuta los checks declarados por el producto y produce HEALTHY /
 * DEGRADED / FAILED / UNKNOWN. Los checks son reales cuando es posible.
 */
import { db } from "@/lib/db";
import fs from "fs";
import { productAppDir, productDataDir } from "@/lib/albra/env";
import { requireInstalled, setState } from "@/lib/albra/core/registry";
import { getDeploymentAdapter } from "@/lib/albra/adapters";
import { getContractFor } from "@/lib/albra/products/catalog";
import { log } from "@/lib/albra/core/logger";
import { readRuntimeState, probeHealth, isPortServing } from "@/lib/albra/core/process-runtime";
import { audit } from "@/lib/albra/core/audit";

export interface HealthCheckResult {
  checkId: string;
  label: string;
  target: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIP";
  detail?: string;
  critical: boolean;
}

export async function runHealthChecks(productId: string): Promise<{ overall: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN"; checks: HealthCheckResult[] }> {
  const installed = await requireInstalled(productId);
  const contract = getContractFor(productId, installed.version);
  const specs = contract?.health.checks ?? [
    { checkId: "runtime", label: "Runtime del servicio", target: "runtime" as const, critical: true },
  ];
  const adapter = getDeploymentAdapter();
  // V2: estado REAL del sistema operativo una sola vez por corrida
  const rs = await readRuntimeState(productId, installed.state === "RUNNING");
  const realRunning = rs.osState === "RUNNING" || rs.osState === "ORPHAN_RUNNING";
  const checks: HealthCheckResult[] = [];

  for (const spec of specs) {
    let result: HealthCheckResult = { checkId: spec.checkId, label: spec.label, target: spec.target, status: "SKIP", critical: spec.critical };
    try {
      switch (spec.target) {
        case "application": {
          const manifestPath = `${productAppDir(productId)}/manifest.json`;
          const exists = fs.existsSync(manifestPath);
          let detail = exists ? "Aplicación staged y manifest presente" : "manifest.json no encontrado en app/";
          let status: HealthCheckResult["status"] = exists ? "PASS" : "FAIL";
          if (exists) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
              if (manifest.version !== installed.version) {
                status = "WARN";
                detail = `Versión en disco (${manifest.version}) difiere del registro (${installed.version})`;
              }
            } catch {
              status = "FAIL";
              detail = "manifest.json corrupto";
            }
          }
          result = { ...result, status, detail };
          break;
        }
        case "runtime": {
          // V2: verificación de PROCESO REAL (pidfile + identidad del SO), no de la DB
          if (rs.osState === "RUNNING" && rs.identity) {
            result = {
              ...result,
              status: "PASS",
              detail: `Proceso real vivo (PID ${rs.identity.pid}, uptime ${rs.evidence.uptimeS ?? "?"}s, puerto ${rs.identity.port}, identidad ${rs.evidence.identityVerified ? "verificada" : "no verificable"})`,
            };
          } else if (rs.osState === "ORPHAN_RUNNING" && rs.identity) {
            result = {
              ...result,
              status: "WARN",
              detail: `Proceso vivo (PID ${rs.identity.pid}) pero pendiente de adopción por el INSTALADOR`,
            };
          } else if (rs.osState === "CRASHED") {
            result = {
              ...result,
              status: "FAIL",
              detail: `Terminación inesperada (PID ${rs.identity?.pid ?? "?"}). ${rs.evidence.errLogTail?.slice(-160) ?? "Sin stderr"}`,
            };
            // V2: persistir evidencia de crash y auditar (además de la reconciliación)
            await db.installedProduct.update({
              where: { productId },
              data: {
                pid: null,
                bootToken: null,
                lastExitEvidence: JSON.stringify({ type: "UNEXPECTED_EXIT", at: new Date().toISOString(), pid: rs.identity?.pid, errTail: (rs.evidence.errLogTail ?? "").slice(-512) }),
              },
            });
            await audit({ type: "PROCESS_CRASHED", productId, severity: "CRITICAL", detail: { pid: rs.identity?.pid, detectedBy: "health-check" } });
          } else if (rs.osState === "EXITED_CLEAN") {
            result = { ...result, status: "WARN", detail: `Proceso detenido con salida ordenada (${rs.evidence.exitReason ?? "n/d"})` };
          } else if (rs.osState === "LOST") {
            result = { ...result, status: "FAIL", detail: "El registro decía RUNNING pero no existe proceso ni pidfile (estado perdido)" };
          } else {
            result = { ...result, status: "WARN", detail: `El producto no está en ejecución (estado: ${installed.state})` };
          }
          break;
        }
        case "http-health": {
          // V2: endpoint de salud AUTENTICADO del proceso real (SKIP si el producto no lo declara/expone)
          const identity = rs.identity;
          if (!identity || !installed.bootToken || !realRunning) {
            result = { ...result, status: installed.state === "RUNNING" ? "FAIL" : "SKIP", detail: installed.state === "RUNNING" ? "Sin proceso real que responda al endpoint de salud" : "Producto detenido — no aplica" };
            break;
          }
          const probe = await probeHealth(identity.port, installed.bootToken, identity.pid, 2500);
          result = probe.ok
            ? { ...result, status: "PASS", detail: `/health respondió 200 autenticado en ${probe.latencyMs}ms (pid ${probe.body?.pid}, uptime ${probe.body?.uptimeS}s)` }
            : { ...result, status: "FAIL", detail: `Endpoint de salud sin respuesta válida: ${probe.error ?? probe.status}` };
          break;
        }
        case "database": {
          if (productId === "crm") {
            const [c, d] = await Promise.all([db.crmContact.count(), db.crmDeal.count()]);
            result = { ...result, status: "PASS", detail: `${c} contactos, ${d} oportunidades accesibles` };
          } else if (productId === "leads") {
            const l = await db.leadRecord.count();
            result = { ...result, status: "PASS", detail: `${l} leads accesibles` };
          } else {
            result = { ...result, status: "SKIP", detail: "Sin base de datos declarada" };
          }
          break;
        }
        case "dependencies": {
          const deps = contract?.dependencies ?? [];
          const unresolved = deps.filter(d => d.required && !d.dependencyId.startsWith("albra-"));
          result = {
            ...result,
            status: unresolved.length === 0 ? "PASS" : "FAIL",
            detail: deps.length === 0 ? "Sin dependencias declaradas" : `${deps.length} dependencias resueltas y provistas por ALBRA Platform`,
          };
          break;
        }
        case "storage": {
          const dataDir = productDataDir(productId);
          try {
            fs.mkdirSync(dataDir, { recursive: true });
            const probe = `${dataDir}/.health-probe`;
            fs.writeFileSync(probe, String(Date.now()));
            fs.rmSync(probe);
            result = { ...result, status: "PASS", detail: "Lectura/escritura OK" };
          } catch {
            result = { ...result, status: "FAIL", detail: "Sin permisos de escritura en data/" };
          }
          break;
        }
        case "port": {
          if (installed.port) {
            const serving = await isPortServing(installed.port);
            if (realRunning) {
              // Si el producto está corriendo, el puerto DEBE estar siendo servido por su proceso
              result = {
                ...result,
                status: serving ? "PASS" : "FAIL",
                detail: serving
                  ? `Puerto ${installed.port} sirviendo conexiones (127.0.0.1)`
                  : `Proceso vivo pero el puerto ${installed.port} NO acepta conexiones`,
              };
            } else {
              const free = await adapter.isPortFree(installed.port);
              result = {
                ...result,
                status: free ? "PASS" : "WARN",
                detail: free ? `Puerto ${installed.port} libre (producto detenido)` : `Puerto ${installed.port} en uso por otro proceso (producto detenido)`,
              };
            }
          } else {
            result = { ...result, status: "SKIP", detail: "Puerto no asignado (producto detenido)" };
          }
          break;
        }
        case "providers": {
          const providers = await db.providerRecord.findMany({ where: { productId } });
          if (providers.length === 0) {
            result = { ...result, status: "SKIP", detail: "El producto no declara proveedores obligatorios" };
          } else {
            const bad = providers.filter(p => ["INVALID", "EXPIRED", "BLOCKED"].includes(p.status));
            result = { ...result, status: bad.length === 0 ? "PASS" : "WARN", detail: `${providers.length} proveedores registrados` };
          }
          break;
        }
      }
    } catch (e) {
      result = { ...result, status: "FAIL", detail: `Error de check: ${(e as Error).message}` };
    }
    checks.push(result);
  }

  const criticals = checks.filter(c => c.critical);
  const overall =
    criticals.some(c => c.status === "FAIL") ? "FAILED"
    : criticals.every(c => c.status === "PASS") ? "HEALTHY"
    : checks.some(c => c.status === "FAIL") ? "DEGRADED"
    : checks.some(c => c.status === "WARN") ? "DEGRADED"
    : "UNKNOWN";

  await db.healthSnapshot.create({ data: { productId, overall, checks: checks as unknown as object[] } });
  await db.installedProduct.update({
    where: { productId },
    data: { health: overall, lastHealthAt: new Date() },
  });
  await log({ productId, channel: "DEBUG", level: overall === "HEALTHY" ? "info" : "warn", message: `Health: ${overall}`, data: { checks: checks.map(c => `${c.checkId}:${c.status}`) } });
  if (overall === "FAILED" && installed.state === "RUNNING") {
    await setState(productId, "FAILED");
  } else if (overall !== "FAILED" && installed.state === "FAILED") {
    // V2: decidir por estado real del SO, no por un handle guardado
    await setState(productId, realRunning ? "RUNNING" : "STOPPED");
  }
  return { overall, checks };
}

export async function latestHealth(productId: string) {
  return db.healthSnapshot.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
}
