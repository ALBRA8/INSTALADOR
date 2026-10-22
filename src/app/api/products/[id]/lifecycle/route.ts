/**
 * ALBRA API — POST /api/products/[id]/lifecycle
 * Body: { action: "START" | "STOP" | "RESTART" } → { ok, port? }
 * PRODUCT_BUSY → 409 con mensaje para el usuario.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { restartProduct, startProduct, stopProduct } from "@/lib/albra/core/runtime";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

type LifecycleAction = "START" | "STOP" | "RESTART";
type LifecycleResult = { ok: boolean; port?: number; error?: string };

const USER_MESSAGES: Record<string, string> = {
  PRODUCT_BUSY: "Hay una operación en curso para este producto",
  NO_PORT_AVAILABLE: "No hay puertos libres disponibles",
  PRODUCT_NOT_INSTALLED: "Este producto no está instalado.",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const body = await readJson<{ action?: unknown }>(req);
    const action = body?.action;
    if (action !== "START" && action !== "STOP" && action !== "RESTART") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "action must be START | STOP | RESTART",
        "Acción inválida. Usa START, STOP o RESTART.",
      );
    }

    await requireInstalled(id);

    let res: LifecycleResult;
    if (action === "START") {
      res = await startProduct(id);
    } else if (action === "STOP") {
      res = await stopProduct(id);
    } else {
      res = await restartProduct(id);
    }

    if (!res.ok) {
      const code = res.error ?? "LIFECYCLE_ERROR";
      throw new ApiError(
        code === "PRODUCT_BUSY" ? 409 : 400,
        code,
        `Lifecycle ${action} failed: ${code}`,
        USER_MESSAGES[code] ?? `No se pudo completar la operación (${code}).`,
      );
    }

    return NextResponse.json({
      ok: true,
      ...(res.port !== undefined ? { port: res.port } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
