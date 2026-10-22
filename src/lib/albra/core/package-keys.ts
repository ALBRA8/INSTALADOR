/**
 * ALBRA — Master key del platform root (separa de SecretStore de productos).
 * Se usa para firmar paquetes. Generada una vez, persistida con 0600.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PATHS, ensureDirs } from "@/lib/albra/env";

let cached: string | null = null;

export function getMasterKeyHex(): string {
  if (cached) return cached;
  ensureDirs();
  const file = path.join(PATHS.keys, "package-signing.key");
  if (fs.existsSync(file)) {
    cached = fs.readFileSync(file, "utf-8").trim();
  } else {
    cached = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, cached, { mode: 0o600 });
  }
  return cached;
}
