/**
 * ALBRA — Environment & filesystem layout (deployment-adapter aware).
 * En el adapter Windows-local estos paths resuelven bajo %ProgramData%/ALBRA.
 * En el adapter local-dev resuelven bajo <repo>/albra-data.
 */
import path from "path";
import fs from "fs";

export const ALBRA_ROOT = process.env.ALBRA_HOME
  ? path.resolve(process.env.ALBRA_HOME)
  : path.join(process.cwd(), "albra-data");

export const PATHS = {
  root: ALBRA_ROOT,
  packages: path.join(ALBRA_ROOT, "packages"),
  products: path.join(ALBRA_ROOT, "products"),
  backups: path.join(ALBRA_ROOT, "backups"),
  exports: path.join(ALBRA_ROOT, "exports"),
  keys: path.join(ALBRA_ROOT, "keys"),
  logs: path.join(ALBRA_ROOT, "logs"),
  downloads: path.join(ALBRA_ROOT, "downloads"),
};

export function ensureDirs(): void {
  for (const dir of Object.values(PATHS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function productAppDir(productId: string): string {
  return path.join(PATHS.products, productId, "app");
}
export function productDataDir(productId: string): string {
  return path.join(PATHS.products, productId, "data");
}
export function productStagingDir(productId: string, runId: string): string {
  return path.join(PATHS.products, productId, `staging-${runId}`);
}
export function productPreviousDir(productId: string): string {
  return path.join(PATHS.products, productId, ".previous");
}

/** Escritura atómica de archivo (tmp + rename) — base de la instalación transaccional. */
export function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

/** Commit transaccional: rename atómico de staging → app. */
export function commitDirectory(stagingDir: string, targetDir: string): void {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.renameSync(stagingDir, targetDir);
}
