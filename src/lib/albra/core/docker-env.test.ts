import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGeneratedDockerEnvFile } from "./docker-env";

let root = "";
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = ""; });

describe("createGeneratedDockerEnvFile", () => {
  test("creates unique secrets with restrictive permissions and refuses overwrite", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "albra-env-"));
    const first = await createGeneratedDockerEnvFile({ productDir: root, envFile: ".env.albra", secretKeys: ["APP_SECRET", "API_TOKEN"] });
    expect(first.ok).toBe(true);
    const file = await fs.readFile(path.join(root, ".env.albra"), "utf8");
    expect(file).toMatch(/APP_SECRET="[A-Za-z0-9_-]{43}"/);
    expect(file).toMatch(/API_TOKEN="[A-Za-z0-9_-]{43}"/);
    if (process.platform !== "win32") {
      const stat = await fs.stat(path.join(root, ".env.albra"));
      expect(stat.mode & 0o777).toBe(0o600);
    }
    const second = await createGeneratedDockerEnvFile({ productDir: root, envFile: ".env.albra", secretKeys: ["APP_SECRET"] });
    expect(second).toMatchObject({ ok: false, code: "ENV_FILE_EXISTS" });
  });

  test("rejects traversal and invalid or duplicate keys", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "albra-env-"));
    expect(await createGeneratedDockerEnvFile({ productDir: root, envFile: "../.env", secretKeys: ["TOKEN"] })).toMatchObject({ ok: false, code: "ENV_FILE_INVALID" });
    expect(await createGeneratedDockerEnvFile({ productDir: root, envFile: ".env", secretKeys: ["bad-key"] })).toMatchObject({ ok: false, code: "ENV_FILE_INVALID" });
    expect(await createGeneratedDockerEnvFile({ productDir: root, envFile: ".env", secretKeys: ["TOKEN", "TOKEN"] })).toMatchObject({ ok: false, code: "ENV_FILE_INVALID" });
  });
});
