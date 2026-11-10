/**
 * ALBRA — Tests del motor de despliegue Docker Compose (F2).
 * Ejecutan SIN Docker real: pinning/materialización/espera de salud se
 * prueban con runner inyectado y composiciones de juguete. El despliegue
 * E2E con daemon real queda marcado como pendiente (entorno sin Docker).
 */
import { describe, expect, test, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  materializeComposeWithDigests,
  materializeDescriptor,
  pinImageDigest,
  waitForContainerHealth,
  ContainerDeployError,
  type DockerRunner,
} from "./container-deploy";
import { parseSourceContract } from "@/lib/albra/contracts/source";

const COMPOSE = `
services:
  app:
    image: \${APP_IMAGE:?falta APP_IMAGE}
    expose: ["3000"]
  redis:
    image: \${REDIS_IMAGE:?falta REDIS_IMAGE}
volumes:
  data:
networks:
  albra_gateway:
    external: true
    name: albra-agents
`;

const DIGEST_APP = "ghcr.io/albra8/chismoso@sha256:" + "a".repeat(64);
const DIGEST_REDIS = "redis@sha256:" + "b".repeat(64);

function fakeRunner(map: Record<string, { stdout?: string; stderr?: string; ok?: boolean }>): DockerRunner {
  return {
    async exec(args: string[]) {
      const key = args.join(" ");
      for (const [needle, res] of Object.entries(map)) {
        if (key.includes(needle)) return { ok: res.ok ?? true, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
      }
      return { ok: false, stdout: "", stderr: `unexpected docker call: ${key}` };
    },
  };
}

let tmp = "";
afterEach(async () => { if (tmp) await fs.rm(tmp, { recursive: true, force: true }); tmp = ""; });

async function tmpProduct(composeName = "compose.yaml"): Promise<string> {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "albra-deploy-"));
  await fs.writeFile(path.join(tmp, composeName), COMPOSE, "utf8");
  // El driver exige env existente con modo 0600 (validación real del adaptador).
  await fs.writeFile(path.join(tmp, ".env"), "X=1\n", { mode: 0o600 });
  return tmp;
}

describe("pinImageDigest", () => {
  test("fija digest real vía pull + inspect RepoDigests", async () => {
    const runner = fakeRunner({
      "pull ": { stdout: "" },
      "image inspect": { stdout: `${DIGEST_APP}\n` },
    });
    const digest = await pinImageDigest(runner, "ghcr.io/albra8/chismoso:1.0.0");
    expect(digest).toBe(DIGEST_APP);
  });

  test("acepta referencias ya fijadas sin llamar a Docker", async () => {
    const calls: string[] = [];
    const runner: DockerRunner = { async exec(a) { calls.push(a.join(" ")); return { ok: true, stdout: "", stderr: "" }; } };
    const digest = await pinImageDigest(runner, DIGEST_APP);
    expect(digest).toBe(DIGEST_APP);
    expect(calls.length).toBe(0);
  });

  test("falla sin digest de registro (fail-closed, nunca tags móviles)", async () => {
    const runner = fakeRunner({ "pull ": { stdout: "" }, "image inspect": { stdout: "\n" } });
    try {
      await pinImageDigest(runner, "some/image:latest");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContainerDeployError);
      expect((e as ContainerDeployError).code).toBe("IMAGE_DIGEST_UNRESOLVABLE");
    }
  });
});

describe("materializeComposeWithDigests", () => {
  test("sustituye solo las líneas image: de las variables declaradas", () => {
    const out = materializeComposeWithDigests(COMPOSE, [
      { imageVar: "APP_IMAGE", digest: DIGEST_APP },
      { imageVar: "REDIS_IMAGE", digest: DIGEST_REDIS },
    ]);
    expect(out).toContain(`image: ${DIGEST_APP}`);
    expect(out).toContain(`image: ${DIGEST_REDIS}`);
    expect(out).not.toContain("${APP_IMAGE");
    expect(out).toContain("expose:");
  });

  test("falla si queda alguna interpolación de imagen sin resolver", () => {
    expect(() => materializeComposeWithDigests(COMPOSE, [{ imageVar: "APP_IMAGE", digest: DIGEST_APP }])).toThrow(ContainerDeployError);
  });
});

describe("materializeDescriptor", () => {
  const source = parseSourceContract({
    deployment: {
      kind: "docker-compose",
      composeFile: "compose.albra.yaml",
      envFile: ".env.albra",
      projectName: "chismoso",
      generatedSecretKeys: ["CHISMOSO_JWT_SECRET"],
      images: [{ service: "app", imageVar: "CHISMOSO_IMAGE", ref: "ghcr.io/albra8/chismoso:1.0.0" }],
      healthTimeoutSeconds: 60,
    },
  });
  test("el parche de contrato acepta deployment docker-compose", () => {
    expect(source.ok).toBe(true);
    expect(source.patch?.deployment?.kind).toBe("docker-compose");
  });
  test("materializa el descriptor estricto con digests reales", () => {
    const d = materializeDescriptor(source.patch!.deployment!, [{ service: "app", image: DIGEST_APP }]);
    expect(d.schemaVersion).toBe("1.0.0");
    expect(d.networkName).toBe("albra-agents");
    expect(d.imageDigests[0].image).toBe(DIGEST_APP);
    expect(d.preserveVolumesOnStop).toBe(true);
  });
  test("rechaza digests malformados", () => {
    expect(() => materializeDescriptor(source.patch!.deployment!, [{ service: "app", image: "img:latest" }])).toThrow(ContainerDeployError);
  });
});

describe("waitForContainerHealth", () => {
  test("consolida HEALTHY cuando todos los servicios están running+healthy", async () => {
    const dir = await tmpProduct();
    const row = JSON.stringify({ Service: "app", Name: "x-app-1", State: "running", Health: "healthy", ExitCode: 0 });
    const runner = fakeRunner({ "--format json": { stdout: row } });
    const r = await waitForContainerHealth(runner, { productDir: dir, projectName: "x", composeFile: "compose.yaml", envFile: ".env", timeoutSeconds: 5, intervalMs: 10 });
    expect(r.ok).toBe(true);
    expect(r.health).toBe("HEALTHY");
  });

  test("fail-fast ante unhealthy explícito", async () => {
    const dir = await tmpProduct();
    const row = JSON.stringify({ Service: "app", Name: "x-app-1", State: "running", Health: "unhealthy", ExitCode: 1 });
    const runner = fakeRunner({ "--format json": { stdout: row } });
    const r = await waitForContainerHealth(runner, { productDir: dir, projectName: "x", composeFile: "compose.yaml", envFile: ".env", timeoutSeconds: 30, intervalMs: 10 });
    expect(r.ok).toBe(false);
    expect(r.health).toBe("FAILED");
  });

  test("timeout sin salud → FAILED/UNKNOWN, nunca simulación de éxito", async () => {
    const dir = await tmpProduct();
    const runner: DockerRunner = { async exec() { return { ok: true, stdout: "", stderr: "" }; } };
    const r = await waitForContainerHealth(runner, { productDir: dir, projectName: "x", composeFile: "compose.yaml", envFile: ".env", timeoutSeconds: 1, intervalMs: 10 });
    expect(r.ok).toBe(false);
  });
});
