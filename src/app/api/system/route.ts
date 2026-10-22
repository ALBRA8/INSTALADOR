/**
 * ALBRA API — GET /api/system
 * SystemInfoDTO: versión de plataforma, adapter activo, recursos,
 * productos instalados y paquetes en bóveda.
 */
import fs from "fs";
import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/albra/core/bootstrap";
import { getDeploymentAdapter } from "@/lib/albra/adapters";
import { PATHS, ensureDirs } from "@/lib/albra/env";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/albra/api-serialize";
import type { SystemInfoDTO } from "@/lib/albra/api-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureBootstrap();
    ensureDirs();

    const adapter = getDeploymentAdapter();
    const info = adapter.info();
    const productsInstalled = await db.installedProduct.count();
    const packagesInVault = fs
      .readdirSync(PATHS.packages)
      .filter(f => f.endsWith(".albra")).length;

    const dto: SystemInfoDTO = {
      version: "1.0.0",
      adapterId: info.adapterId,
      adapterLabel: info.adapterLabel,
      platform: info.platform,
      arch: info.arch,
      osRelease: info.osRelease,
      nodeVersion: info.nodeVersion,
      totalMemMB: info.totalMemMB,
      freeDiskMB: info.freeDiskMB,
      albraHome: info.albraHome,
      productsInstalled,
      packagesInVault,
      uptimeS: Math.round(process.uptime()),
    };
    return NextResponse.json(dto);
  } catch (e) {
    return errorResponse(e);
  }
}
