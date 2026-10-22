/**
 * ALBRA API — /api/certification
 * GET  ?productId (default "crm") → { certification: CertificationDTO | null }
 * POST { productId? } → { runId } (suite completa en vivo, corre en background)
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getCertification, runCertification } from "@/lib/albra/core/certification";
import { asArray, errorResponse, iso, readJson } from "@/lib/albra/api-serialize";
import type { CertificationDTO, CertificationStepDTO, RunStatus } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

function normalizeProductId(raw: unknown): string {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim().slice(0, 64) : "crm";
}

export async function GET(req: Request) {
  try {
    await ensureBootstrap();

    const url = new URL(req.url);
    const productId = normalizeProductId(url.searchParams.get("productId"));

    const row = await getCertification(productId);
    if (!row) {
      return NextResponse.json({ certification: null });
    }

    const result = (row.result ?? null) as { passed?: boolean } | null;
    const steps: CertificationStepDTO[] = asArray<CertificationStepDTO>(row.steps).map(s => ({
      step: s.step,
      label: s.label,
      status: s.status,
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
      durationMs: Number(s.durationMs ?? 0),
    }));

    const certification: CertificationDTO = {
      id: row.id,
      productId: row.productId,
      status: row.status as RunStatus,
      passed: result?.passed ?? row.status === "SUCCESS",
      steps,
      startedAt: iso(row.startedAt) ?? "",
      finishedAt: iso(row.finishedAt),
    };
    return NextResponse.json({ certification });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureBootstrap();

    const body = await readJson<{ productId?: unknown }>(req).catch(() => null);
    const productId = normalizeProductId(body?.productId);

    const { runId } = await runCertification(productId);
    return NextResponse.json({ runId });
  } catch (e) {
    return errorResponse(e);
  }
}
