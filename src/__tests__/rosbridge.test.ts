import { describe, expect, it, vi } from "vitest";
import { ensureRosbridge, stopManagedRosbridge, type RosbridgeProcess } from "../../electron/ipc/rosbridge";

describe("ensureRosbridge", () => {
  it("does not spawn rosbridge when the websocket port is already open", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const spawnRosbridge = vi.fn();

    await expect(ensureRosbridge("ws://localhost:9090", { probe, spawnRosbridge })).resolves.toEqual({
      alreadyRunning: true
    });

    expect(probe).toHaveBeenCalledWith("ws://localhost:9090");
    expect(spawnRosbridge).not.toHaveBeenCalled();
  });

  it("spawns rosbridge and waits until the port opens", async () => {
    const process = { kill: vi.fn() } satisfies RosbridgeProcess;
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const spawnRosbridge = vi.fn().mockReturnValue(process);
    const waitMs = vi.fn().mockResolvedValue(undefined);

    await expect(
      ensureRosbridge("ws://localhost:9090", {
        probe,
        spawnRosbridge,
        waitMs,
        timeoutMs: 1000,
        pollIntervalMs: 25
      })
    ).resolves.toEqual({ alreadyRunning: false });

    expect(spawnRosbridge).toHaveBeenCalledTimes(1);
    expect(waitMs).toHaveBeenCalledWith(25);
    stopManagedRosbridge();
    expect(process.kill).toHaveBeenCalled();
  });

  it("times out if the spawned rosbridge never opens the port", async () => {
    const process = { kill: vi.fn() } satisfies RosbridgeProcess;
    const probe = vi.fn().mockResolvedValue(false);
    const spawnRosbridge = vi.fn().mockReturnValue(process);
    const waitMs = vi.fn().mockResolvedValue(undefined);
    let now = 0;

    await expect(
      ensureRosbridge("ws://localhost:9090", {
        probe,
        spawnRosbridge,
        waitMs,
        timeoutMs: 100,
        pollIntervalMs: 25,
        now: () => {
          now += 50;
          return now;
        }
      })
    ).rejects.toThrow("Timed out waiting for rosbridge");

    expect(process.kill).toHaveBeenCalled();
  });
});
