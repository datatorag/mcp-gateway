import { afterEach, describe, expect, it, vi } from "vitest";
import { isDockerAvailable } from "./db";

// No Docker is stopped for this: DOCKER_HOST names a socket that does not
// exist, so `docker info` fails here the way it does with the daemon down
// (and the same way on a machine with no docker command at all).
describe("isDockerAvailable with no daemon to reach", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports unavailable, so a file run by hand skips its database suites", () => {
    vi.stubEnv("DOCKER_HOST", "unix:///nonexistent.sock");
    vi.stubEnv("GATE_REQUIRE_DB", "");
    expect(isDockerAvailable()).toBe(false);
  });

  it("throws when the gate requires the database, naming the cause and the remedy", () => {
    vi.stubEnv("DOCKER_HOST", "unix:///nonexistent.sock");
    vi.stubEnv("GATE_REQUIRE_DB", "1");
    expect(() => isDockerAvailable()).toThrow(/Docker[^]*Start Docker and run it again/);
  });
});
