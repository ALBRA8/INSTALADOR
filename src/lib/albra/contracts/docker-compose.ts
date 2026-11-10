/**
 * ALBRA — Docker Compose deployment descriptor (contract foundation).
 *
 * This descriptor is intentionally separate from ProductContract until the
 * installer, persistent registry and lifecycle/health engines all support
 * container deployments. It must not be treated as installable by itself.
 */
import { z } from "zod";

const SafeRelativePath = z.string().min(1).refine(
  value =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/^[A-Za-z]:/.test(value) &&
    value.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== ".."),
  "Path must be a normalized relative POSIX path without traversal",
);

const ImageDigest = z.string().min(1).refine(
  value => !/\s/.test(value) && /^.+@sha256:[a-f0-9]{64}$/.test(value),
  "Container images must be pinned by an immutable sha256 digest",
);

export const DockerComposeDeploymentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  composeFile: SafeRelativePath.refine(value => /\.ya?ml$/i.test(value), "Compose file must be YAML"),
  /** Installer-generated at mode 0600; never package-supplied secret contents. */
  envFile: SafeRelativePath,
  projectName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  /** Restrict managed agents to the platform-owned private network. */
  networkName: z.literal("albra-agents"),
  /** Secret names for which the installer may generate random values. */
  generatedSecretKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)).min(1),
  imageDigests: z.array(z.object({
    service: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
    image: ImageDigest,
  })).min(1),
  healthTimeoutSeconds: z.number().int().min(10).max(900).default(180),
  preserveVolumesOnStop: z.literal(true).default(true),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.generatedSecretKeys).size !== value.generatedSecretKeys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["generatedSecretKeys"], message: "Duplicate generated secret keys are not allowed." });
  }
  const seen = new Set<string>();
  for (const item of value.imageDigests) {
    if (seen.has(item.service)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageDigests"],
        message: `Duplicate image digest declaration for service: ${item.service}`,
      });
    }
    seen.add(item.service);
  }
});

export type DockerComposeDeployment = z.infer<typeof DockerComposeDeploymentSchema>;

export function parseDockerComposeDeployment(raw: unknown): {
  ok: true;
  deployment: DockerComposeDeployment;
  errors: [];
} | {
  ok: false;
  errors: string[];
} {
  const parsed = DockerComposeDeploymentSchema.safeParse(raw);
  if (parsed.success) return { ok: true, deployment: parsed.data, errors: [] };
  return {
    ok: false,
    errors: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`),
  };
}
