/**
 * ALBRA — lifecycle for registered Docker Compose deployments.
 *
 * This layer only controls the recorded project. It never runs "down",
 * removes containers, or deletes persistent volumes.
 */
import {
  ensureAlbraAgentNetwork,
  parseDockerComposePs,
  runDockerCompose,
  type DockerComposeAction,
  type DockerComposeServiceState,
} from "@/lib/albra/adapters/docker-compose";
import {
  getContainerDeployment,
  updateContainerDeploymentState,
  withLock,
} from "@/lib/albra/core/registry";

export type ContainerLifecycleAction = "START" | "STOP" | "RESTART" | "STATUS" | "HEALTH";

export interface ContainerLifecycleResult {
  ok: boolean;
  productId: string;
  desiredState: "RUNNING" | "STOPPED";
  observedState: "RUNNING" | "STOPPED" | "DEGRADED" | "UNKNOWN";
  health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  services: DockerComposeServiceState[];
  error?: string;
}

function summarizeServices(services: DockerComposeServiceState[]) {
  if (services.length === 0) {
    return { observedState: "STOPPED" as const, health: "UNKNOWN" as const };
  }
  const allStopped = services.every(s =>
    ["exited", "stopped", "created"].includes(s.state) && (s.exitCode === null || s.exitCode === 0),
  );
  if (allStopped) return { observedState: "STOPPED" as const, health: "UNKNOWN" as const };
  const failed = services.some(s =>
    ["dead", "removing"].includes(s.state) || s.health === "unhealthy" ||
    (s.exitCode !== null && s.exitCode !== 0 && s.state !== "running"),
  );
  if (failed) return { observedState: "DEGRADED" as const, health: "FAILED" as const };
  const allRunning = services.every(s => s.state === "running");
  if (!allRunning) return { observedState: "DEGRADED" as const, health: "DEGRADED" as const };
  const anyStarting = services.some(s => s.health === "starting");
  if (anyStarting) return { observedState: "RUNNING" as const, health: "DEGRADED" as const };
  return { observedState: "RUNNING" as const, health: "HEALTHY" as const };
}

const composeAction: Record<Exclude<ContainerLifecycleAction, "STATUS" | "HEALTH">, DockerComposeAction> = {
  START: "start",
  STOP: "stop",
  RESTART: "restart",
};

export async function runContainerLifecycle(
  productId: string,
  action: ContainerLifecycleAction,
): Promise<ContainerLifecycleResult> {
  return withLock(productId, async () => {
    const deployment = await getContainerDeployment(productId);
    if (!deployment) throw new Error("CONTAINER_DEPLOYMENT_NOT_REGISTERED");

    const desiredState = action === "STOP"
      ? "STOPPED"
      : action === "START" || action === "RESTART"
        ? "RUNNING"
        : deployment.desiredState === "RUNNING" ? "RUNNING" : "STOPPED";

    if (action === "START" || action === "RESTART") {
      const network = await ensureAlbraAgentNetwork();
      if (!network.ok) {
        const error = network.stderr || "Could not ensure ALBRA agent network.";
        await updateContainerDeploymentState(productId, {
          desiredState: "RUNNING",
          observedState: "UNKNOWN",
          health: "UNKNOWN",
          lastError: error.slice(0, 2000),
        });
        return {
          ok: false, productId, desiredState: "RUNNING", observedState: "UNKNOWN",
          health: "UNKNOWN", services: [], error,
        };
      }
    }

    if (action !== "STATUS" && action !== "HEALTH") {
      const command = await runDockerCompose({
        productDir: deployment.installPath,
        composeFile: deployment.composeFile,
        envFile: deployment.envFile,
        projectName: deployment.projectName,
        action: composeAction[action],
      });
      if (!command.ok) {
        const error = command.stderr || command.code;
        await updateContainerDeploymentState(productId, {
          desiredState,
          observedState: "UNKNOWN",
          health: "UNKNOWN",
          lastError: error.slice(0, 2000),
        });
        return {
          ok: false, productId, desiredState, observedState: "UNKNOWN",
          health: "UNKNOWN", services: [], error,
        };
      }
    }

    const status = await runDockerCompose({
      productDir: deployment.installPath,
      composeFile: deployment.composeFile,
      envFile: deployment.envFile,
      projectName: deployment.projectName,
      action: "ps",
    });
    if (!status.ok) {
      const error = status.stderr || status.code;
      await updateContainerDeploymentState(productId, {
        desiredState,
        observedState: "UNKNOWN",
        health: "UNKNOWN",
        lastError: error.slice(0, 2000),
      });
      return {
        ok: false, productId, desiredState, observedState: "UNKNOWN",
        health: "UNKNOWN", services: [], error,
      };
    }

    const parsed = parseDockerComposePs(status.stdout);
    if (!parsed.ok) {
      const error = parsed.error ?? "Invalid Compose status.";
      await updateContainerDeploymentState(productId, {
        desiredState,
        observedState: "UNKNOWN",
        health: "UNKNOWN",
        lastError: error,
      });
      return {
        ok: false, productId, desiredState, observedState: "UNKNOWN",
        health: "UNKNOWN", services: [], error,
      };
    }

    const summary = summarizeServices(parsed.services);
    const matchesDesired = desiredState === "RUNNING"
      ? summary.observedState === "RUNNING" && summary.health !== "FAILED"
      : summary.observedState === "STOPPED";
    await updateContainerDeploymentState(productId, {
      desiredState,
      observedState: summary.observedState,
      health: summary.health,
      lastError: matchesDesired ? null : `Desired state ${desiredState}; observed ${summary.observedState}.`,
    });

    return {
      ok: matchesDesired && (desiredState !== "RUNNING" || summary.health === "HEALTHY"),
      productId,
      desiredState,
      ...summary,
      services: parsed.services,
      ...(!matchesDesired ? { error: `Desired state ${desiredState}; observed ${summary.observedState}.` } : {}),
    };
  });
}
