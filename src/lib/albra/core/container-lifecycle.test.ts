import { describe, expect, test } from "bun:test";
import { summarizeContainerServices } from "./container-lifecycle";

describe("summarizeContainerServices", () => {
  test("reports stopped when every service exited cleanly", () => {
    expect(summarizeContainerServices([
      { service: "app", name: "app-1", state: "exited", health: null, exitCode: 0 },
      { service: "redis", name: "redis-1", state: "exited", health: null, exitCode: 0 },
    ])).toEqual({ observedState: "STOPPED", health: "UNKNOWN" });
  });

  test("reports healthy only when every service is running and none is unhealthy", () => {
    expect(summarizeContainerServices([
      { service: "app", name: "app-1", state: "running", health: "healthy", exitCode: 0 },
      { service: "scheduler", name: "scheduler-1", state: "running", health: null, exitCode: 0 },
    ])).toEqual({ observedState: "RUNNING", health: "HEALTHY" });
  });

  test("reports failed health for unhealthy or non-zero exited services", () => {
    expect(summarizeContainerServices([
      { service: "app", name: "app-1", state: "running", health: "unhealthy", exitCode: 0 },
    ])).toEqual({ observedState: "DEGRADED", health: "FAILED" });
    expect(summarizeContainerServices([
      { service: "worker", name: "worker-1", state: "exited", health: null, exitCode: 2 },
    ])).toEqual({ observedState: "DEGRADED", health: "FAILED" });
  });

  test("treats an empty project as stopped but not healthy", () => {
    expect(summarizeContainerServices([])).toEqual({ observedState: "STOPPED", health: "UNKNOWN" });
  });
});
