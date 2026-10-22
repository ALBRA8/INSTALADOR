/**
 * ALBRA API — /api/trust/keys
 * Gestión de la cadena de confianza de firma (V2 §5).
 *
 * GET  → { activeSigner, trusted, supportMatrix }
 * POST { action: "generate" }                          → identidad Ed25519 (idempotente)
 * POST { action: "trust",   keyId, name, trust }       → registra clave (FULL|DEV)
 * POST { action: "revoke",  keyId, reason }            → revoca clave
 * POST { action: "rotate",  reason? }                  → rota: revoca activa + identidad nueva
 *
 * La autoridad central de firma de producción está PENDING: este endpoint
 * gestiona el modo de desarrollo local seguro (clave privada jamás sale
 * de PATHS.keys/signing con 0600) y el almacén de confianza con
 * rotación/revocación.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { audit } from "@/lib/albra/core/audit";
import { ApiError, errorResponse, readJson } from "@/lib/albra/api-serialize";
import {
  ensureSigningIdentity,
  getActiveSigner,
  listKeys,
  addTrustedKey,
  revokeKey,
  rotateSigningKey,
  type TrustLevel,
} from "@/lib/albra/core/signing";

export const dynamic = "force-dynamic";

interface TrustKeysBody {
  action?: string;
  keyId?: unknown;
  name?: unknown;
  trust?: unknown;
  reason?: unknown;
}

export async function GET() {
  try {
    await ensureBootstrap();
    // Idempotente: si aún no hay identidad de firma, se crea aquí.
    const identity = ensureSigningIdentity();
    const activeSigner = getActiveSigner();
    return NextResponse.json({
      activeSigner: { ...activeSigner, trust: identity.trust, revoked: identity.revoked },
      trusted: listKeys(),
      supportMatrix: {
        algorithm: "ed25519",
        signatureFormat: "albra-sig-2",
        devFallback: "hmac-dev (HMAC local — integridad sí, procedencia no)",
        productionCA: "PENDING — pendiente de autoridad central; modo desarrollo local seguro",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureBootstrap();
    const body = await readJson<TrustKeysBody>(req);
    const action = body?.action;
    if (!action || typeof action !== "string") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Body must include action: generate | trust | revoke | rotate",
        "Indica la acción a realizar sobre las claves de firma.",
      );
    }

    if (action === "generate") {
      const identity = ensureSigningIdentity();
      if (identity.created) {
        await audit({
          type: "KEY_GENERATED",
          detail: { keyId: identity.keyId, algorithm: "ed25519", trust: identity.trust },
        });
      }
      return NextResponse.json({
        keyId: identity.keyId,
        created: identity.created,
        trust: identity.trust,
        revoked: identity.revoked,
        activeSigner: getActiveSigner(),
      });
    }

    if (action === "trust") {
      const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
      const trust = body.trust;
      if (!keyId) {
        throw new ApiError(400, "VALIDATION_ERROR", "keyId is required", "Indica el keyId de la clave a registrar.");
      }
      if (trust !== "FULL" && trust !== "DEV") {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "trust must be FULL or DEV",
          "El nivel de confianza debe ser FULL o DEV.",
        );
      }
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Clave firmante local";
      const entry = addTrustedKey(keyId, name, trust as TrustLevel);
      await audit({
        type: "TRUST_POLICY_CHANGED",
        detail: { action: "trust", keyId, name: entry.name, trust: entry.trust },
      });
      return NextResponse.json({ trusted: entry, keys: listKeys() });
    }

    if (action === "rotate") {
      // Rotación planificada: revoca la activa, destruye su privada, genera
      // identidad nueva (trust DEV; elevar a FULL es decisión explícita).
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "rotación de clave de firma";
      const result = rotateSigningKey(reason);
      if (result.oldWasRevoked) {
        await audit({ type: "KEY_REVOKED", severity: "WARNING", detail: { keyId: result.oldKeyId, reason, via: "rotate" } });
      }
      await audit({ type: "KEY_GENERATED", detail: { keyId: result.newKeyId, algorithm: "ed25519", trust: result.trust, via: "rotate", oldKeyId: result.oldKeyId } });
      return NextResponse.json({ rotated: true, oldKeyId: result.oldKeyId, keyId: result.newKeyId, trust: result.trust, activeSigner: getActiveSigner(), keys: listKeys() });
    }

    if (action === "revoke") {
      const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
      if (!keyId) {
        throw new ApiError(400, "VALIDATION_ERROR", "keyId is required", "Indica el keyId de la clave a revocar.");
      }
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "revocación sin motivo declarado";
      const entry = revokeKey(keyId, reason); // KEY_NOT_FOUND si no está registrada
      await audit({
        type: "KEY_REVOKED",
        severity: "WARNING",
        detail: { keyId, reason: entry.reason },
      });
      return NextResponse.json({ revoked: entry, keys: listKeys() });
    }

    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `Unknown action: ${action}`,
      "Acción no reconocida (usa generate, trust, revoke o rotate).",
    );
  } catch (e) {
    if (e instanceof Error && e.message === "KEY_NOT_FOUND") {
      return errorResponse(new ApiError(404, "KEY_NOT_FOUND", "KEY_NOT_FOUND", "Esa clave no está registrada como confiable."));
    }
    if (e instanceof Error && e.message === "KEY_REVOKED_CANNOT_TRUST") {
      return errorResponse(new ApiError(409, "KEY_REVOKED_CANNOT_TRUST", "KEY_REVOKED_CANNOT_TRUST", "Esa clave está revocada; no puede volver a ser de confianza. Genera una nueva."));
    }
    return errorResponse(e);
  }
}
