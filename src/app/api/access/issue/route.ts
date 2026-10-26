/**
 * ALBRA — PORTAL DE LICENCIAMIENTO DEMO.
 * POST /api/access/issue   Body: { packageId } → { accessKey, expiresAt, plan }
 * GET  /api/access/issue   → claves DEMO emitidas (enmascaradas) para la UI.
 *
 * Replica el flujo real "solicitar una clave al portal del licenciante y
 * luego introducirla en el instalador". La emisión NO salta la puerta: la
 * clave emitida debe pasar por POST /api/access/verify como cualquier otra.
 */
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { issueDemoKey, readIssuedKeys } from "@/lib/albra/core/access-key";
import { AccessKeyIssueRequestSchema } from "@/lib/albra/contracts/access";
import { errorResponse, readJson } from "@/lib/albra/api-serialize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureBootstrap();
    const body = await readJson<{ packageId?: unknown }>(req);
    const parsed = AccessKeyIssueRequestSchema.safeParse({ packageId: body?.packageId });
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "packageId requerido", userMessage: "Indica el proyecto (packageId) para emitir la clave." } },
        { status: 400 },
      );
    }
    const entry = issueDemoKey(parsed.data.packageId);
    return NextResponse.json({ accessKey: entry.key, plan: entry.plan, expiresAt: entry.expiresAt });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET() {
  try {
    await ensureBootstrap();
    const now = Date.now();
    const keys = readIssuedKeys()
      .keys.filter(k => k.plan === "DEMO")
      .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))
      .slice(0, 20)
      .map(k => ({
        keyMasked: k.key.slice(0, 10) + "••••",
        packageId: k.packageId,
        revoked: k.revoked,
        expired: Boolean(k.expiresAt && Date.parse(k.expiresAt) < now),
        issuedAt: k.issuedAt,
        expiresAt: k.expiresAt,
      }));
    return NextResponse.json({ keys });
  } catch (e) {
    return errorResponse(e);
  }
}
