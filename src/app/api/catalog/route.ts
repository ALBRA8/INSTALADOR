/**
 * ALBRA API — GET /api/catalog
 * Catálogo del Launcher: estado de instalación, salud, puerto,
 * actualizaciones disponibles, lock de operaciones y certificación.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { CATALOG, getLatestVersion } from "@/lib/albra/products/catalog";
import { listInstalled, isLocked } from "@/lib/albra/core/registry";
import { db } from "@/lib/db";
import { errorResponse, asArray, semverGt } from "@/lib/albra/api-serialize";
import type { CatalogItem, ExitEvidenceDTO, LifecycleStateDTO, RunStepDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureBootstrap();

    const installedList = await listInstalled();
    const installedMap = new Map(installedList.map(p => [p.productId, p]));

    // V3: progreso POR PROYECTO — runs activos (uno visible por producto).
    // % global del run = pasos cerrados + mitad del paso en curso.
    const activeRuns = await db.lifecycleRun.findMany({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    const progressByProduct = new Map<string, { pct: number; label: string }>();
    for (const r of activeRuns) {
      if (!r.productId || progressByProduct.has(r.productId)) continue;
      const steps = asArray<RunStepDTO>(r.steps);
      if (steps.length === 0) continue;
      const done = steps.filter(s => s.status === "SUCCESS" || s.status === "WARNING" || s.status === "SKIPPED" || s.status === "FAILURE").length;
      const running = steps.some(s => s.status === "RUNNING");
      const pct = Math.min(99, Math.round(((done + (running ? 0.5 : 0)) / steps.length) * 100));
      const opLabel: Record<string, string> = {
        INSTALL: "Instalando", UPDATE: "Actualizando", REPAIR: "Reparando",
        UNINSTALL: "Desinstalando", START: "Iniciando", STOP: "Deteniendo",
      };
      progressByProduct.set(r.productId, { pct, label: opLabel[r.operation] ?? r.operation });
    }

    const products: CatalogItem[] = [];
    for (const entry of CATALOG) {
      const inst = installedMap.get(entry.productId) ?? null;
      const certRow = await db.platformState.findUnique({
        where: { key: `certification:${entry.productId}` },
      });
      const cert = (certRow?.value ?? null) as { passed?: boolean } | null;
      // Última versión con paquete en la bóveda; fallback a la del catálogo
      // (productos bloqueados sin paquete declaran su versión de referencia).
      const latestVersion = getLatestVersion(entry.productId) ?? entry.latestVersion;

      // Evidencia persistida de la última salida del proceso (parseada; null si no hay)
      const lastExitEvidence = (() => {
        if (!inst?.lastExitEvidence) return null;
        try {
          return JSON.parse(inst.lastExitEvidence) as ExitEvidenceDTO;
        } catch {
          return null;
        }
      })();

      products.push({
        productId: entry.productId,
        displayName: entry.displayName,
        description: entry.description,
        icon: entry.icon,
        category: entry.category,
        state: (inst?.state ?? "AVAILABLE") as LifecycleStateDTO,
        health: (inst?.health ?? "UNKNOWN") as CatalogItem["health"],
        installedVersion: inst?.version ?? null,
        latestVersion,
        updateAvailable: Boolean(inst && latestVersion && semverGt(latestVersion, inst.version)),
        locked: entry.locked,
        requiredEntitlement: entry.requiredEntitlement ?? null,
        port: inst?.port ?? null,
        busy: inst ? isLocked(entry.productId) : false,
        certified: Boolean(cert?.passed),
        pid: inst?.pid ?? null,
        lastExitEvidence,
        // V3: progreso por proyecto (barra en la tarjeta mientras opera)
        progress: progressByProduct.get(entry.productId)?.pct ?? null,
        progressLabel: progressByProduct.get(entry.productId)?.label ?? null,
      });
    }

    return NextResponse.json({ products });
  } catch (e) {
    return errorResponse(e);
  }
}
