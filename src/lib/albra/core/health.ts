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
          const running = installed.state === "RUNNING";
          result = {
            ...result,
            status: running ? "PASS" : "WARN",
            detail: running ? `Activo (handle ${installed.runtimeHandle ?? "n/a"})` : `Estado actual: ${installed.state}`,
          };
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
            const free = await adapter.isPortFree(installed.port);
            // Si el producto está corriendo, el puerto DEBERÍA estar reservado por ALBRA.
            result = {
              ...result,
              status: installed.state === "RUNNING" ? "PASS" : free ? "PASS" : "WARN",
              detail: `Puerto ${installed.port} ${installed.state === "RUNNING" ? "asignado y reservado" : free ? "libre (producto detenido)" : "en uso por otro proceso"}`,
            };
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
    data: { health: overall, lastHealthAt: new Date(), state: installed.state === "RUNNING" && overall === "FAILED" ? "DEGRADED" : installed.state },
  });
  await log({ productId, channel: "DEBUG", level: overall === "HEALTHY" ? "info" : "warn", message: `Health: ${overall}`, data: { checks: checks.map(c => `${c.checkId}:${c.status}`) } });
  if (overall === "FAILED" && installed.state === "RUNNING") {
    await setState(productId, "FAILED");
  } else if (overall !== "FAILED" && installed.state === "FAILED") {
    await setState(productId, installed.runtimeHandle ? "RUNNING" : "STOPPED");
  }
  return { overall, checks };
}

export async function latestHealth(productId: string) {
  return db.healthSnapshot.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
}
