import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGraphStore } from "../stores/graphStore";
import { emptyComposition } from "../lib/composition";

// End-to-end test for the "edit before launch" workflow.
// Strict assertions:
//  - Load works from a static fixture (no ROS, no rosbridge).
//  - Swap / Disable / Add / Topic-rewire accumulate in composition + pending state.
//  - A single save emits the selective fork-chain ONLY under the GUI output root, never under src/.
//  - rosParamSet / restartNode / ensureRosbridge are NEVER called during pre-launch editing.
//  - Static parameter tuning queues generated-launch overrides without touching the source tree.

const SOURCE_ROOT = "/home/ws/src";
const ENTRY = "/home/ws/src/demo/launch/entry.launch.xml";
const OVERRIDES_ROOT = "/home/app/gui_tauri/autoware_graph_studio_overrides";

const fixtureFiles: Record<string, string> = {
  "/home/ws/src/loc_pkg/package.xml": "<package><name>loc_pkg</name></package>",
  "/home/ws/src/demo/package.xml": "<package><name>demo</name></package>",
  "/home/ws/src/demo/launch/entry.launch.xml": `<launch>
  <arg name="pose_source" default="ndt"/>
  <group if="$(eval &quot;'$(var pose_source)'=='ndt'&quot;)">
    <node pkg="loc_pkg" exec="ndt_scan_matcher" name="ndt_scan_matcher"/>
  </group>
  <group if="$(eval &quot;'$(var pose_source)'=='yabloc'&quot;)">
    <node pkg="loc_pkg" exec="yabloc_pose_corrector" name="yabloc_pose_corrector"/>
  </group>
  <node pkg="demo" exec="listener" name="listener">
    <remap from="~/input/state" to="/topic_old"/>
    <param name="gain" value="1.0"/>
  </node>
</launch>
`
};

beforeEach(() => {
  useGraphStore.setState({
    sourceRoot: SOURCE_ROOT,
    entryLaunch: ENTRY,
    composition: emptyComposition(),
    pendingOverrides: [],
    pendingTopicOverrides: [],
    selectedNodeId: null,
    switchArgs: [],
    launchArgSpecs: [],
    launchArgValues: {},
    outputRoot: "",
    defaultOutputRoot: "",
    graphSource: "static"
  });
  vi.mocked(window.api.readReachableFiles).mockReset().mockResolvedValue(fixtureFiles);
  vi.mocked(window.api.readText).mockReset().mockResolvedValue(fixtureFiles[ENTRY]);
  vi.mocked(window.api.getOutputRoot).mockReset().mockResolvedValue(OVERRIDES_ROOT);
  vi.mocked(window.api.writeText).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.writeTextFilesAtomically).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.removePath).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.chooseOutputFolder).mockReset().mockResolvedValue(null);
  vi.mocked(window.api.rosParamSet).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.rosDynamicParams).mockReset().mockResolvedValue([]);
  vi.mocked(window.api.restartNode).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.ensureRosbridge).mockReset().mockResolvedValue({ alreadyRunning: true });
});

describe("pre-launch editing — end-to-end (no ROS / no src writes)", () => {
  it("Load reads only static files and finds the swap candidate with provenance", async () => {
    await useGraphStore.getState().loadGraph();
    const state = useGraphStore.getState();
    const names = state.graph.nodes.map((node) => node.name);

    expect(names).toContain("ndt_scan_matcher");
    expect(names).toContain("listener");
    expect(names).not.toContain("yabloc_pose_corrector");

    const ndt = state.graph.nodes.find((node) => node.name === "ndt_scan_matcher");
    expect(ndt?.gatedBy ?? []).toContain("pose_source");

    const poseSwitch = state.switchArgs.find((item) => item.name === "pose_source");
    expect(poseSwitch).toBeDefined();
    expect([...(poseSwitch?.candidates ?? [])].sort()).toEqual(["ndt", "yabloc"]);

    expect(window.api.rosParamSet).not.toHaveBeenCalled();
    expect(window.api.restartNode).not.toHaveBeenCalled();
    expect(window.api.ensureRosbridge).not.toHaveBeenCalled();
    expect(state.graphSource).toBe("static");
  });

  it("captures swap / disable / add / rewire without ROS calls", async () => {
    const store = useGraphStore.getState();
    await store.loadGraph();
    useGraphStore.getState().setSwitchValue("pose_source", "yabloc");
    useGraphStore.getState().toggleNodeDisabled("listener");
    useGraphStore.getState().addComposedNode({ name: "extra_talker", packageName: "demo", executable: "talker" });

    const listener = useGraphStore.getState().graph.nodes.find((node) => node.id === "listener")!;
    expect(listener.inputs.length).toBeGreaterThan(0);
    useGraphStore.getState().updateTopicName("listener", listener.inputs[0].id, "/topic_new");

    const state = useGraphStore.getState();
    expect(state.composition.argOverrides).toEqual({ pose_source: "yabloc" });
    expect(state.composition.disabledNodeIds).toEqual(["listener"]);
    expect(state.composition.addedNodes).toEqual([
      { name: "extra_talker", packageName: "demo", executable: "talker" }
    ]);
    expect(state.pendingTopicOverrides[0]).toMatchObject({
      nodeName: "listener",
      pinKind: "input",
      toTopic: "/topic_new"
    });
    expect(state.pendingOverrides).toEqual([]);

    expect(window.api.rosParamSet).not.toHaveBeenCalled();
    expect(window.api.restartNode).not.toHaveBeenCalled();
    expect(window.api.ensureRosbridge).not.toHaveBeenCalled();
  });

  it("save emits a selective fork-chain ONLY under the GUI output root — never under src/", async () => {
    await useGraphStore.getState().loadGraph();
    useGraphStore.getState().setSwitchValue("pose_source", "yabloc");
    useGraphStore.getState().toggleNodeDisabled("listener");
    useGraphStore.getState().addComposedNode({ name: "extra_talker", packageName: "demo", executable: "talker" });

    const listener = useGraphStore.getState().graph.nodes.find((node) => node.id === "listener")!;
    useGraphStore.getState().updateTopicName("listener", listener.inputs[0].id, "/topic_new");
    const writeText = vi.mocked(window.api.writeText);
    const writeTextFilesAtomically = vi.mocked(window.api.writeTextFilesAtomically);
    writeText.mockClear();
    writeTextFilesAtomically.mockClear();
    await useGraphStore.getState().apply();

    const calls = writeText.mock.calls as Array<[string, string]>;
    const latestCall = writeTextFilesAtomically.mock.calls.find(([rootDir]) => rootDir === `${OVERRIDES_ROOT}/latest`);
    expect(latestCall).toBeDefined();
    const latestFiles = latestCall?.[1] ?? [];
    const paths = [...calls.map(([path]) => path), ...latestFiles.map((file) => `${OVERRIDES_ROOT}/latest/${file.relativePath}`)];

    // entry is always forked
    const entryForkPath = paths.find((path) => /\/runs\/\d{4}-\d{2}-\d{2}_\d{6}_\d{3}\/forks\/demo\/launch\/entry\.launch\.xml$/.test(path));
    expect(entryForkPath).toBeDefined();
    expect(paths).toContain(`${OVERRIDES_ROOT}/latest/forks/demo/launch/entry.launch.xml`);
    expect(paths).toContain(`${OVERRIDES_ROOT}/latest/launch/autoware_graph_studio.launch.py`);
    expect(paths).toContain(`${OVERRIDES_ROOT}/latest/manifest.json`);
    expect(useGraphStore.getState().entryForkPath).toBe(`${OVERRIDES_ROOT}/latest/launch/autoware_graph_studio.launch.py`);

    for (const [path] of calls) {
      expect(path.startsWith(`${OVERRIDES_ROOT}/runs/`) || path.startsWith(`${OVERRIDES_ROOT}/latest/`)).toBe(true);
      expect(path.startsWith(`${SOURCE_ROOT}/`)).toBe(false);
    }

    const entryFork = calls.find(([path]) => path === entryForkPath)![1];
    // listener removed (Disable), pose_source default rewritten (Swap), added node appended (Add),
    // listener remap would be applied in-place, but the listener block is removed by Disable.
    expect(entryFork).toMatch(/<arg name="pose_source" default="yabloc"\/>/);
    expect(entryFork).not.toMatch(/default="ndt"/);
    expect(entryFork).not.toMatch(/name="listener"/);
    expect(entryFork).toMatch(/<node pkg="demo" exec="talker" name="extra_talker">/);
    expect(entryFork.indexOf("extra_talker")).toBeLessThan(entryFork.indexOf("</launch>"));
    const generatedEntry = latestFiles.find((file) => file.relativePath === "launch/autoware_graph_studio.launch.py")?.content;
    expect(generatedEntry).toContain(`${OVERRIDES_ROOT}/latest/forks/demo/launch/entry.launch.xml`);
    expect(window.api.removePath).not.toHaveBeenCalledWith(`${OVERRIDES_ROOT}/latest`);

    expect(window.api.rosParamSet).not.toHaveBeenCalled();
    expect(window.api.restartNode).not.toHaveBeenCalled();
    expect(window.api.ensureRosbridge).not.toHaveBeenCalled();
  });

  it("Before-launch parameter tuning queues a generated-launch override without ROS calls", async () => {
    await useGraphStore.getState().loadGraph();
    const listener = useGraphStore.getState().graph.nodes.find((node) => node.id === "listener")!;
    await useGraphStore.getState().updateParameter(listener.params[0], "3.14");

    expect(useGraphStore.getState().pendingOverrides).toEqual([
      expect.objectContaining({
        nodeName: "listener",
        key: "gain",
        value: "3.14",
        sourceFile: ENTRY
      })
    ]);
    expect(useGraphStore.getState().status).toBe("Draft changed: listener.gain. Save writes the generated launch.");
    expect(window.api.rosParamSet).not.toHaveBeenCalled();
    expect(window.api.restartNode).not.toHaveBeenCalled();

    const writeText = vi.mocked(window.api.writeText);
    const writeTextFilesAtomically = vi.mocked(window.api.writeTextFilesAtomically);
    writeText.mockClear();
    writeTextFilesAtomically.mockClear();
    await useGraphStore.getState().apply();
    const latestCall = writeTextFilesAtomically.mock.calls.find(([rootDir]) => rootDir === `${OVERRIDES_ROOT}/latest`);
    const entryFork = latestCall?.[1].find((file) => file.relativePath === "forks/demo/launch/entry.launch.xml")?.content;
    expect(entryFork).toContain('<param name="gain" value="3.14"/>');
    expect(latestCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "launch/autoware_graph_studio.launch.py",
          content: expect.stringContaining(`${OVERRIDES_ROOT}/latest/forks/demo/launch/entry.launch.xml`)
        })
      ])
    );
    expect(window.api.restartNode).not.toHaveBeenCalled();
  });

  it("save emits the fixed entry launch for launch-arg-only edits", async () => {
    useGraphStore.setState({
      entryLaunch: ENTRY,
      launchArgSpecs: [{ name: "pose_source", defaultValue: "ndt", hasDefault: true, choices: ["ndt", "yabloc"], inputKind: "select" }],
      launchArgValues: { pose_source: "yabloc" },
      graph: { nodes: [], edges: [], includes: [], launchGraph: { launches: [], edges: [] } },
      composition: emptyComposition(),
      pendingOverrides: [],
      pendingTopicOverrides: [],
      dynamicTuningSession: []
    });

    await useGraphStore.getState().apply();

    expect(window.api.readReachableFiles).not.toHaveBeenCalled();
    expect(window.api.writeTextFilesAtomically).toHaveBeenCalledWith(
      `${OVERRIDES_ROOT}/latest`,
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "launch/autoware_graph_studio.launch.py",
          content: expect.stringContaining(`[["pose_source","yabloc"]]`)
        }),
        expect.objectContaining({
          relativePath: "manifest.json",
          content: expect.stringContaining(`"generatedEntryLaunch": "${OVERRIDES_ROOT}/latest/launch/autoware_graph_studio.launch.py"`)
        })
      ])
    );
    expect(useGraphStore.getState().entryForkPath).toBe(`${OVERRIDES_ROOT}/latest/launch/autoware_graph_studio.launch.py`);
  });

  it("save uses the GUI-selected output root when one is configured", async () => {
    const selectedRoot = "/tmp/custom_output";
    const expectedRoot = `${selectedRoot}/autoware_graph_studio_overrides`;
    useGraphStore.setState({
      outputRoot: selectedRoot,
      entryLaunch: ENTRY,
      launchArgSpecs: [{ name: "pose_source", defaultValue: "ndt", hasDefault: true, choices: ["ndt", "yabloc"], inputKind: "select" }],
      launchArgValues: { pose_source: "yabloc" },
      graph: { nodes: [], edges: [], includes: [], launchGraph: { launches: [], edges: [] } },
      composition: emptyComposition(),
      pendingOverrides: [],
      pendingTopicOverrides: [],
      dynamicTuningSession: []
    });

    await useGraphStore.getState().apply();

    expect(window.api.getOutputRoot).not.toHaveBeenCalled();
    expect(window.api.writeTextFilesAtomically).toHaveBeenCalledWith(
      `${expectedRoot}/latest`,
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "launch/autoware_graph_studio.launch.py"
        }),
        expect.objectContaining({
          relativePath: "manifest.json",
          content: expect.stringContaining(`"generatedEntryLaunch": "${expectedRoot}/latest/launch/autoware_graph_studio.launch.py"`)
        })
      ])
    );
    expect(useGraphStore.getState().entryForkPath).toBe(`${expectedRoot}/latest/launch/autoware_graph_studio.launch.py`);
  });
});
