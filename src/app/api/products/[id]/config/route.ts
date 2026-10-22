/**
 * ALBRA API — /api/products/[id]/config
 * GET  = bloque de configuración del detalle (3 scopes + secretos).
 * PUT  { values }: solo campos USER no systemManaged; campos "secret" con
 *      valor no vacío van al SecretStore (cifrados) y NUNCA a ConfigRecord.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { requireInstalled } from "@/lib/albra/core/registry";
import { putSecret } from "@/lib/albra/core/secrets";
import { audit } from "@/lib/albra/core/audit";
import { db } from "@/lib/db";
import {
  ApiError,
  buildProductConfig,
  errorResponse,
  loadContract,
  readJson,
} from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const installed = await requireInstalled(id);
    const contract = loadContract(id, installed.version);
    const block = await buildProductConfig(id, contract?.configuration.fields ?? []);
    return NextResponse.json(block);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureBootstrap();
    const { id } = await params;

    const installed = await requireInstalled(id);
    const contract = loadContract(id, installed.version);
    const fields = contract?.configuration.fields ?? [];

    const body = await readJson<{ values?: unknown }>(req);
    const values = body?.values;
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include a values object",
        "Envía un objeto 'values' con la configuración a guardar.",
      );
    }

    const current = await db.configRecord.findUnique({
      where: { productId_scope: { productId: id, scope: "USER" } },
    });
    // Objeto mutable con valores JSON primitivos; se serializa al upsert.
    const userValues: Record<string, unknown> = {
      ...((current?.values ?? {}) as Record<string, unknown>),
    };

    const touchedKeys: string[] = [];
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      const field = fields.find(f => f.key === key);
      // Solo campos USER editables por el usuario.
      if (!field || field.scope !== "USER" || field.systemManaged) continue;
      if (field.type === "secret") {
        const plain = String(value ?? "");
        if (plain.length > 0) {
          await putSecret(field.key, plain, id);
          touchedKeys.push(key);
        }
        continue; // los secretos jamás se guardan en ConfigRecord
      }
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        userValues[key] = value;
      } else {
        userValues[key] = JSON.stringify(value);
      }
      touchedKeys.push(key);
    }

    await db.configRecord.upsert({
      where: { productId_scope: { productId: id, scope: "USER" } },
      create: { productId: id, scope: "USER", values: userValues as Prisma.InputJsonObject },
      update: { values: userValues as Prisma.InputJsonObject },
    });

    if (touchedKeys.length > 0) {
      await audit({ type: "CONFIG_CHANGED", productId: id, detail: { keys: touchedKeys } });
    }

    const block = await buildProductConfig(id, fields);
    return NextResponse.json(block);
  } catch (e) {
    return errorResponse(e);
  }
}
