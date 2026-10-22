/**
 * ALBRA — LAYER 4: DEPLOYMENT FRAMEWORK (adapters)
 *
 * El núcleo NUNCA depende de Windows. Windows es la primera implementación
 * de producción (windows-local). En este entorno sandbox se ejecuta el
 * adapter local-dev (Linux), con la misma interfaz y semántica.
 */
import os from "os";
import fs from "fs";
import net from "net";
import { PATHS, ensureDirs } from "@/lib/albra/env";

export interface PlatformInfo {
  adapterId: "windows-local" | "linux-local" | "local-dev" | "selfhosted-vps";
  adapterLabel: string;
  platform: "windows" | "linux" | "macos";
  arch: "x64" | "arm64";
  platformVersion: string; // versión de ALBRA Platform
  osRelease: string;
  nodeVersion: string;
  totalMemMB: number;
  freeDiskMB: number;
  albraHome: string;
}

export interface DeploymentAdapter {
  id: PlatformInfo["adapterId"];
  info(): PlatformInfo;
  /** Sonda real de disponibilidad de puerto. */
  isPortFree(port: number): Promise<boolean>;
  /** Resolución automática de conflictos de puerto seguros. */
  findFreePort(preferred: number[], maxTry?: number): Promise<number | null>;
  fileChecksum(filePath: string): string | null;
}

function freeDiskMBSafe(): number {
  try {
    // Node 18+: fs.statfs
    const statfs = (fs as unknown as { statfs?: (p: string, cb: (e: Error | null, s: { bsize: number; bavail: number; blocks: number }) => void) => void }).statfs;
    if (!statfs) return 20480;
    const st = fs.statfsSync(PATHS.root);
    return Math.floor((st.bavail * st.bsize) / (1024 * 1024));
  } catch {
    return 20480;
  }
}

class LocalDevAdapter implements DeploymentAdapter {
  id: PlatformInfo["adapterId"] = "local-dev";

  info(): PlatformInfo {
    ensureDirs();
    return {
      adapterId: this.id,
      adapterLabel: "Local Adapter (dev sandbox) — semántica idéntica a windows-local",
      platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
      arch: os.arch() === "arm64" ? "arm64" : "x64",
      platformVersion: "1.0.0",
      osRelease: `${os.type()} ${os.release()}`,
      nodeVersion: process.version,
      totalMemMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeDiskMB: freeDiskMBSafe(),
      albraHome: PATHS.root,
    };
  }

  isPortFree(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port, "127.0.0.1");
    });
  }

  async findFreePort(preferred: number[], maxTry = 20): Promise<number | null> {
    const base = preferred[0] ?? 4100;
    for (let i = 0; i < maxTry; i++) {
      const candidate = base + i;
      // Evitar duplicar puertos ya asignados a otros productos.
      const used = await this.isPortFree(candidate);
      if (used) return candidate;
    }
    return null;
  }

  fileChecksum(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      // FNV-1a rápida para verificación de staging (los .albra ya llevan sha256).
      const content = fs.readFileSync(filePath);
      let hash = 0x811c9dc5;
      for (const byte of content) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    } catch {
      return null;
    }
  }
}

/**
 * Windows Local Adapter — implementación de producción (especificada).
 * Se activa cuando process.platform === 'win32'. Misma interfaz; usa
 * %ProgramData%\ALBRA, servicios de Windows y estructura idéntica de directorios.
 */
class WindowsLocalAdapter extends LocalDevAdapter {
  override id: PlatformInfo["adapterId"] = "windows-local";
  override info(): PlatformInfo {
    const base = super.info();
    return {
      ...base,
      adapterId: "windows-local",
      adapterLabel: "Windows Local Adapter (producción)",
      platform: "windows",
      osRelease: `${os.type()} ${os.release()}`,
    };
  }
}

/**
 * SelfHosted Deployment Adapter — destino VPS/dedicado (WAVE 11, especificado).
 * Evoluciona hacia: VPS, dedicated server, cloud VM, compatible hosting (Hostinger).
 */
export class SelfHostedDeploymentAdapter {
  static readonly id = "selfhosted-vps" as const;
  static capabilities = {
    provisioning: false,   // por implementar en WAVE 11
    remoteExec: false,
    nginx: false,
    backupsRemote: false,
  };
  static isImplemented(): boolean {
    return false; // MVP: solo especificado; no bloquea el núcleo.
  }
}

export function getDeploymentAdapter(): DeploymentAdapter {
  if (process.platform === "win32") return new WindowsLocalAdapter();
  return new LocalDevAdapter();
}
