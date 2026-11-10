/**
 * ALBRA — safe generation of installer-owned Compose environment files.
 *
 * Only explicitly declared secret keys are generated. Product-specific
 * non-secret values must be supplied by a separate configuration flow.
 * Secret values are never returned or logged.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ENV_KEY = /^[A-Z][A-Z0-9_]{0,127}$/;

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.length > 0 && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

export type GeneratedEnvResult =
  | { ok: true; path: string; keys: string[] }
  | { ok: false; code: "PRODUCT_DIR_INVALID" | "ENV_FILE_INVALID" | "ENV_FILE_EXISTS" | "ENV_FILE_WRITE_FAILED"; message: string };

/**
 * Creates a new env file with O_EXCL semantics and mode 0600.
 * Existing files are never overwritten; this prevents accidental secret rotation.
 */
export async function createGeneratedDockerEnvFile(input: {
  productDir: string;
  envFile: string;
  secretKeys: string[];
  /** Valores NO secretos escritos junto a los secretos (rutas, URLs). */
  plainValues?: Record<string, string>;
}): Promise<GeneratedEnvResult> {
  let root: string;
  try {
    const stat = await fs.stat(input.productDir);
    if (!stat.isDirectory()) throw new Error("not a directory");
    root = await fs.realpath(input.productDir);
  } catch {
    return { ok: false, code: "PRODUCT_DIR_INVALID", message: "Managed product directory is invalid." };
  }

  if (!input.envFile || path.isAbsolute(input.envFile) || input.envFile.includes("\\") ||
      input.envFile.split("/").some(part => !part || part === "." || part === "..")) {
    return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file path must be normalized and relative." };
  }
  const target = path.resolve(root, input.envFile);
  if (!inside(root, target)) {
    return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file must remain inside the managed product directory." };
  }
  if (input.secretKeys.length === 0 || input.secretKeys.some(key => !ENV_KEY.test(key)) ||
      new Set(input.secretKeys).size !== input.secretKeys.length) {
    return { ok: false, code: "ENV_FILE_INVALID", message: "At least one unique, valid secret key must be declared." };
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const parent = await fs.realpath(path.dirname(target));
    // El .env puede vivir DIRECTAMENTE en la raíz del producto (parent === root).
    if (parent !== root && !inside(root, parent)) {
      return { ok: false, code: "ENV_FILE_INVALID", message: "Environment file parent may not escape the product directory." };
    }
    const secretLines = input.secretKeys.map(key => `${key}=${quoteEnvValue(randomBytes(32).toString("base64url"))}`);
    const plainLines = Object.entries(input.plainValues ?? {}).map(([k, v]) => `${k}=${quoteEnvValue(v)}`);
    const contents = [...plainLines, ...secretLines].join("\n") + "\n";
    const handle = await fs.open(target, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform !== "win32") await fs.chmod(target, 0o600);
    return { ok: true, path: target, keys: [...input.secretKeys, ...Object.keys(input.plainValues ?? {})] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return { ok: false, code: "ENV_FILE_EXISTS", message: "Environment file already exists; refusing to overwrite secrets." };
    }
    return { ok: false, code: "ENV_FILE_WRITE_FAILED", message: "Could not securely create the environment file." };
  }
}
