import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDockerComposePs, runDockerCompose } from "./docker-compose";

describe("runDockerCompose env file confinement", () => {
  let root = "";
  let outside = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "albra-compose-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "albra-outside-"));
    await fs.writeFile(path.join(root, "compose.yaml"), "services: {}\n");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  test("rejects an env file that escapes the managed directory", async () => {
    await fs.writeFile(path.join(outside, "secrets.env"), "TOKEN=secret\n", { mode: 0o600 });
    const result = await runDockerCompose({
      productDir: root,
      composeFile: "compose.yaml",
      projectName: "albra-test",
      action: "ps",
      envFile: path.join("..", path.basename(outside), "secrets.env"),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENV_FILE_INVALID");
  });

  test("rejects a missing env file without invoking Docker", async () => {
    const result = await runDockerCompose({
      productDir: root,
      composeFile: "compose.yaml",
      projectName: "albra-test",
      action: "ps",
      envFile: ".env.albra",
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENV_FILE_NOT_FOUND");
  });

  test("rejects group/world-readable env files on POSIX", async () => {
    if (process.platform === "win32") return;
    const envPath = path.join(root, ".env.albra");
    await fs.writeFile(envPath, "TOKEN=secret\n", { mode: 0o644 });
    const result = await runDockerCompose({
      productDir: root,
      composeFile: "compose.yaml",
      projectName: "albra-test",
      action: "ps",
      envFile: ".env.albra",
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENV_FILE_INVALID");
  });

  test("rejects absolute env file paths", async () => {
    const result = await runDockerCompose({
      productDir: root,
      composeFile: "compose.yaml",
      projectName: "albra-test",
      action: "ps",
      envFile: path.join(root, ".env.albra"),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENV_FILE_INVALID");
  });
});


describe("parseDockerComposePs", () => {
  test("parses Compose JSON-lines output and normalizes state", () => {
    const result = parseDockerComposePs([
      JSON.stringify({ Service: "app", Name: "agent-app-1", State: "running", Health: "healthy", ExitCode: 0 }),
      JSON.stringify({ Service: "redis", Name: "agent-redis-1", State: "running", Health: "", ExitCode: 0 }),
    ].join("\n"));
    expect(result.ok).toBe(true);
    expect(result.services).toHaveLength(2);
    expect(result.services[0]).toEqual({
      service: "app",
      name: "agent-app-1",
      state: "running",
      health: "healthy",
      exitCode: 0,
    });
    expect(result.services[1].health).toBeNull();
  });

  test("accepts an empty project and rejects malformed or incomplete rows", () => {
    expect(parseDockerComposePs("").services).toEqual([]);
    expect(parseDockerComposePs("{not-json").ok).toBe(false);
    expect(parseDockerComposePs(JSON.stringify({ Name: "missing-service" })).ok).toBe(false);
  });
});
