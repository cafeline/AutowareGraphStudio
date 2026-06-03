import { describe, expect, it } from "vitest";
import { buildDynamicTuningLaunchPy, upsertDynamicTuningEntry } from "../lib/dynamicTuning";

describe("dynamic tuning exports", () => {
  it("builds a launch.py wrapper that starts the source launch then replays ros2 param set", () => {
    const launch = buildDynamicTuningLaunchPy({
      sourceLaunch: "/ws/src/demo/launch/planning_simulator.launch.xml",
      launchArgs: { map_path: "/tmp/map" },
      entries: [{ nodeName: "/planning/foo", key: "threshold", value: "2.5", parameterType: "double" }],
      applyDelaySec: 3
    });

    expect(launch).toContain("AnyLaunchDescriptionSource");
    expect(launch).toContain("/ws/src/demo/launch/planning_simulator.launch.xml");
    expect(launch).toContain('"map_path"');
    expect(launch).toContain('"ros2","param","set","/planning/foo","threshold","2.5"');
    expect(launch).toContain("period=3");
  });

  it("keeps the latest successful tuning value for a node parameter", () => {
    const entries = upsertDynamicTuningEntry(
      [{ nodeName: "/n", key: "gain", value: "1", parameterType: "double" }],
      { nodeName: "/n", key: "gain", value: "2", parameterType: "double" }
    );

    expect(entries).toEqual([{ nodeName: "/n", key: "gain", value: "2", parameterType: "double" }]);
  });
});
