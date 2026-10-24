/**
 * ALBRA — Contratos Zod de la PUERTA DE ACCESO (ACCESS GATE).
 *
 * Antes de descargar CUALQUIER paquete, el instalador valida la CLAVE ÚNICA
 * DE ACCESO del proyecto contra una API EXTERNA de licenciamiento. Estos
 * esquemas definen el contrato HTTP de esa API (request/response) y la
 * forma de las claves emitidas.
 */
import { z } from "zod";

/**
 * Formato de clave: ALBRA-XXXX-XXXX-XXXX (grupos alfanuméricos mayúsculos).
 * Los prefijos reservados son: SVC (servicio interno), DEM (demostración).
 */
export const ACCESS_KEY_PATTERN = /^ALBRA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** POST /verify — solicitud de validación que envía el instalador. */
export const AccessKeyVerifyRequestSchema = z.object({
  accessKey: z.string().trim().regex(ACCESS_KEY_PATTERN, "FORMAT_INVALID"),
  packageId: z.string().trim().min(1).max(64),
  /** Identificador opcional de la instalación (trazabilidad del licenciante). */
  installationId: z.string().trim().max(64).optional(),
});
export type AccessKeyVerifyRequest = z.infer<typeof AccessKeyVerifyRequestSchema>;

/** Códigos de rechazo estables de la API de licenciamiento. */
export const ACCESS_REJECT_CODES = [
  "FORMAT_INVALID",
  "ACCESS_KEY_UNKNOWN",
  "ACCESS_KEY_REVOKED",
  "ACCESS_KEY_EXPIRED",
  "ACCESS_KEY_PRODUCT_MISMATCH",
  "ACCESS_API_UNREACHABLE",
  "ACCESS_API_CONTRACT_INVALID",
  "ACCESS_KEY_REQUIRED",
] as const;
export type AccessRejectCode = (typeof ACCESS_REJECT_CODES)[number];

/** POST /verify — respuesta canónica (200 SIEMPRE; `valid` decide el veredicto). */
export const AccessKeyVerifyResponseSchema = z.object({
  valid: z.boolean(),
  /** Código de rechazo cuando valid=false (AccessRejectCode). */
  code: z.string().optional(),
  reason: z.string().optional(),
  plan: z.string().optional(),
  licensee: z.string().optional(),
  issuedAt: z.string().optional(),
  /** null/ausente = sin vencimiento. */
  expiresAt: z.string().nullable().optional(),
});
export type AccessKeyVerifyResponse = z.infer<typeof AccessKeyVerifyResponseSchema>;

/** POST /issue — emisión de clave de demostración (portal de licenciamiento demo). */
export const AccessKeyIssueRequestSchema = z.object({
  packageId: z.string().trim().min(1).max(64),
});
export type AccessKeyIssueRequest = z.infer<typeof AccessKeyIssueRequestSchema>;

/** Clave emitida registrada en la bóveda de licencias (issued-keys.json). */
export interface IssuedAccessKey {
  key: string;
  packageId: string; // "*" = universal (servicio)
  plan: "SERVICE" | "DEMO";
  licensee: string;
  issuedAt: string;
  expiresAt: string | null;
  revoked: boolean;
}

export interface IssuedAccessKeyStore {
  keys: IssuedAccessKey[];
}
