import { describe, expect, it } from "bun:test";
import { parseDockerComposeDeployment } from "./docker-compose";

const digest = "sha256:" + "a".repeat(64);
const valid = {
  schemaVersion: "1.0.0",
  composeFile: "compose.albra.yaml",
  envFile: ".env.albra",
  projectName: "albra-chismoso",
  networkName: "albra-agents",
  generatedSecretKeys: ["CHISMOSO_APP_SECRET", "CHISMOSO_API_TOKEN"],
  imageDigests: [
    { service: "app", image: `ghcr.io/albra/chismoso@${digest}` },
    { service: "redis", image: `redis@${digest}` },
  ],
};

describe("Docker Compose deployment descriptor", () => {
  it("accepts normalized paths and immutable image digests", () => {
    const result = parseDockerComposeDeployment(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deployment.healthTimeoutSeconds).toBe(180);
  });

  it("rejects traversal in managed paths", () => {
    expect(parseDockerComposeDeployment({ ...valid, composeFile: "../compose.yaml" }).ok).toBe(false);
    expect(parseDockerComposeDeployment({ ...valid, envFile: "/tmp/secrets.env" }).ok).toBe(false);
  });

  it("rejects mutable image tags", () => {
    expect(parseDockerComposeDeployment({
      ...valid,
      imageDigests: [{ service: "app", image: "ghcr.io/albra/chismoso:latest" }],
    }).ok).toBe(false);
  });

  it("rejects duplicate service image declarations", () => {
    expect(parseDockerComposeDeployment({
      ...valid,
      imageDigests: [
        { service: "app", image: `ghcr.io/albra/chismoso@${digest}` },
        { service: "app", image: `ghcr.io/albra/chismoso@${digest}` },
      ],
    }).ok).toBe(false);
  });

  it("rejects any network other than the managed private network", () => {
    expect(parseDockerComposeDeployment({ ...valid, networkName: "public" }).ok).toBe(false);
  });
});
