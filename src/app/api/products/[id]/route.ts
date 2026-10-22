/**
 * ALBRA API — GET /api/products/[id]
 * ProductDetail: contrato real del paquete, configuración (3 scopes + secretos),
 * proveedores, último health, updates disponibles, rollback y backups.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { latestHealth } from "@/lib/albra/core/health";
import { getRuntimeEvidence } from "@/lib/albra/core/runtime";
import { listBackups } from "@/lib/albra/core/backup";
import { PACKAGE_BUILDS } from "@/lib/albra/products/catalog";
import { db } from "@/lib/db";
import {
  asArray,
  buildProductConfig,
  errorResponse,
  iso,
  loadContract,
  semverGt,
} from "@/lib/albra/api-serialize";
import type {
  BackupDTO,
  ExitEvidenceDTO,
  HealthCheckDTO,
  LifecycleStateDTO,
  ProductDetail,
  ProviderDTO,
} from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const installed = await requireInstalled(id);
    const contract = loadContract(id, installed.version);

    // Configuración: USER / SYSTEM / PRODUCT + secretos (sin valores)
    const { configFields, configValues } = await buildProductConfig(
      id,
      contract?.configuration.fields ?? [],
    );

    // Proveedores registrados + descripción del contrato
    const providerRows = await db.providerRecord.findMany({ where: { productId: id } });
    const providers: ProviderDTO[] = providerRows.map(rec => {
      const meta = (rec.meta ?? null) as { label?: string; kind?: string } | null;
      const spec = contract?.providers.providers.find(p => p.providerId === rec.providerId);
      return {
        providerId: rec.providerId,
        label: spec?.label ?? meta?.label ?? rec.providerId,
        kind: spec?.kind ?? meta?.kind ?? "custom",
        status: rec.status,
        ...(spec?.description ? { description: spec.description } : {}),
      };
    });

    // Último health snapshot
    const snapshot = await latestHealth(id);
    const checks: HealthCheckDTO[] = snapshot
      ? asArray<HealthCheckDTO>(snapshot.checks).map(c => ({
        checkId: c.checkId,
        label: c.label,
        target: c.target,
        status: c.status,
        ...(c.detail !== undefined ? { detail: c.detail } : {}),
        critical: Boolean(c.critical),
      }))
      : [];

    // Updates disponibles en la bóveda (posteriores a la versión instalada)
    const updates = PACKAGE_BUILDS.filter(
      b => b.packageId === id && semverGt(b.version, installed.version),
    ).map(b => ({
      version: b.version,
      hasMigration: b.contract.update.migrations.some(
        m => m.fromVersion === installed.version && m.toVersion === b.version,
      ),
    }));

    // Rollback: existe backup PRE_UPDATE de una versión distinta a la actual
    const rollbackBackup = await db.backupRecord.findFirst({
      where: { productId: id, kind: "PRE_UPDATE", version: { not: installed.version } },
    });

    // Backups existentes
    const backupRows = await listBackups(id);
    const backups: BackupDTO[] = backupRows.map(b => ({
      id: b.id,
      kind: b.kind,
      version: b.version,
      note: b.note ?? null,
      sizeBytes: b.sizeBytes ?? 0,
      createdAt: iso(b.createdAt) ?? "",
    }));

    // Certificación de plataforma
    const certRow = await db.platformState.findUnique({ where: { key: `certification:${id}` } });
    const cert = (certRow?.value ?? null) as { passed?: boolean; at?: string } | null;

    // Evidencia de proceso REAL verificada en el SO (pidfile + identidad + /health autenticado)
    const runtime = await getRuntimeEvidence(id);

    // Evidencia persistida de la última salida del proceso (p.ej. terminación inesperada)
    const lastExitEvidence = (() => {
      if (!installed.lastExitEvidence) return null;
      try {
        return JSON.parse(installed.lastExitEvidence) as ExitEvidenceDTO;
      } catch {
        return null;
      }
    })();

    const detail: ProductDetail & { configValues: typeof configValues } = {
      productId: installed.productId,
      displayName: installed.displayName,
      vendor: installed.vendor,
      version: installed.version,
      state: installed.state as LifecycleStateDTO,
      health: (installed.health ?? "UNKNOWN") as ProductDetail["health"],
      port: installed.port ?? null,
      runtimeHandle: installed.runtimeHandle ?? null,
      installPath: installed.installPath ?? null,
      dataPath: installed.dataPath ?? null,
      installedAt: iso(installed.installedAt),
      lastHealthAt: iso(installed.lastHealthAt),
      checks,
      providers,
      updates,
      rollbackAvailable: Boolean(rollbackBackup),
      backups,
      configFields,
      configValues,
      certified: Boolean(cert?.passed),
      ...(cert?.at ? { certifiedAt: iso(cert.at) } : { certifiedAt: null }),
      runtime,
      lastExitEvidence,
    };

    return NextResponse.json(detail);
  } catch (e) {
    return errorResponse(e);
  }
}
