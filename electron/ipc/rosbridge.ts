import { spawn } from "node:child_process";
import net from "node:net";

export type RosbridgeProcess = {
  kill(signal?: NodeJS.Signals | number): boolean | void;
  killed?: boolean;
  unref?: () => void;
};

type EnsureRosbridgeOptions = {
  probe?: (url: string) => Promise<boolean>;
  spawnRosbridge?: () => RosbridgeProcess;
  waitMs?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
};

export type EnsureRosbridgeResult = { alreadyRunning: boolean };

let managedRosbridge: RosbridgeProcess | null = null;
let ensureInFlight: Promise<EnsureRosbridgeResult> | null = null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tcpProbe(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const port = Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
  const host = parsed.hostname || "localhost";

  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export function spawnRosbridge(): RosbridgeProcess {
  const rosDistro = process.env.ROS_DISTRO ?? "humble";
  const command =
    process.env.AUTOWARE_GRAPH_STUDIO_ROSBRIDGE_COMMAND ??
    `source /opt/ros/${rosDistro}/setup.bash && ros2 launch rosbridge_server rosbridge_websocket_launch.xml`;
  const child = spawn("bash", ["-lc", command], {
    detached: false,
    stdio: "ignore"
  });
  child.unref();
  return child;
}

export async function ensureRosbridge(
  url = "ws://localhost:9090",
  options: EnsureRosbridgeOptions = {}
): Promise<EnsureRosbridgeResult> {
  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
    const probe = options.probe ?? tcpProbe;
    if (await probe(url)) return { alreadyRunning: true };

    if (!managedRosbridge || managedRosbridge.killed) {
      managedRosbridge = (options.spawnRosbridge ?? spawnRosbridge)();
    }

    const waitMs = options.waitMs ?? wait;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const now = options.now ?? Date.now;
    const deadline = now() + timeoutMs;

    while (now() <= deadline) {
      await waitMs(pollIntervalMs);
      if (await probe(url)) return { alreadyRunning: false };
    }

    stopManagedRosbridge();
    throw new Error(`Timed out waiting for rosbridge at ${url}`);
  })();

  try {
    return await ensureInFlight;
  } finally {
    ensureInFlight = null;
  }
}

export function stopManagedRosbridge(): void {
  if (!managedRosbridge || managedRosbridge.killed) return;
  managedRosbridge.kill();
  managedRosbridge = null;
}
