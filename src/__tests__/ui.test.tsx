import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopToolbar } from "../components/TopToolbar";
import { App } from "../App";
import { defaultMapPath, useGraphStore } from "../stores/graphStore";
import { emptyComposition } from "../lib/composition";
import { fetchRuntimeGraph } from "../lib/ros/roslibClient";
import { buildRuntimeGraph } from "../lib/parser";

vi.mock("../lib/ros/roslibClient", () => ({ fetchRuntimeGraph: vi.fn() }));

function resetComposition() {
  useGraphStore.setState({ composition: emptyComposition(), switchArgs: [], selectedNodeId: null });
}

beforeEach(() => {
  vi.mocked(window.api.readReachableFiles).mockReset().mockResolvedValue({});
  vi.mocked(window.api.readText).mockReset().mockResolvedValue(null);
  vi.mocked(window.api.getOutputRoot).mockReset().mockResolvedValue("/gui_tauri/autoware_graph_studio_overrides");
  vi.mocked(window.api.writeText).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.writeTextFilesAtomically).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.removePath).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.chooseLaunchFile).mockReset().mockResolvedValue(null);
  vi.mocked(window.api.chooseOutputFolder).mockReset().mockResolvedValue(null);
  vi.mocked(window.api.pathForFile).mockReset().mockReturnValue("");
  vi.mocked(window.api.rosParamSet).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.rosDynamicParams).mockReset().mockResolvedValue([]);
  vi.mocked(window.api.restartNode).mockReset().mockResolvedValue(undefined);
  vi.mocked(window.api.ensureRosbridge).mockReset().mockResolvedValue({ alreadyRunning: true });
  vi.mocked(fetchRuntimeGraph).mockReset();
  useGraphStore.setState({ outputRoot: "", defaultOutputRoot: "", graphSource: "static" });
});

describe("TopToolbar", () => {
  it("starts with an empty map_path so nothing is hardcoded to one machine", () => {
    expect(defaultMapPath).toBe("");
    useGraphStore.setState({ mapPath: defaultMapPath, launchArgSpecs: [], launchArgValues: {}, showUnusedNodes: false });
    render(<App />);
    expect(screen.queryByLabelText("map_path")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("arg:map_path")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load" })).not.toBeInTheDocument();
  });

  it("keeps the toolbar free of the manual Load button", () => {
    useGraphStore.setState({ mapPath: "", status: "Ready." });
    render(<TopToolbar />);
    expect(screen.queryByRole("button", { name: "Load" })).not.toBeInTheDocument();
  });

  it("lets users choose and reset the output folder", async () => {
    vi.mocked(window.api.getOutputRoot).mockResolvedValue("/default/autoware_graph_studio_overrides");
    vi.mocked(window.api.chooseOutputFolder).mockResolvedValue("/custom");
    useGraphStore.setState({
      outputRoot: "",
      defaultOutputRoot: "",
      status: "Ready."
    });

    render(<TopToolbar />);

    await waitFor(() => expect(screen.getByTitle("/default/autoware_graph_studio_overrides")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Choose output folder" }));

    await waitFor(() => expect(useGraphStore.getState().outputRoot).toBe("/custom/autoware_graph_studio_overrides"));
    expect(window.api.chooseOutputFolder).toHaveBeenCalledWith({
      defaultPath: "/default/autoware_graph_studio_overrides"
    });
    expect(screen.getByTitle("/custom/autoware_graph_studio_overrides")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset output folder" }));

    expect(useGraphStore.getState().outputRoot).toBe("");
    expect(screen.getByTitle("/default/autoware_graph_studio_overrides")).toBeInTheDocument();
  });

  it("updates launch arg inputs and keeps unused nodes hidden by default", () => {
    useGraphStore.setState({
      launchArgSpecs: [{ name: "map_path", defaultValue: "", hasDefault: false, choices: [], inputKind: "text" }],
      launchArgValues: { map_path: "" },
      mapPath: "",
      showUnusedNodes: false
    });
    render(<App />);
    fireEvent.change(screen.getByLabelText("arg:map_path"), { target: { value: "/tmp/map" } });
    expect(screen.getByLabelText("arg:map_path")).toHaveValue("/tmp/map");
    expect(screen.getByLabelText("Show Unused Nodes")).not.toBeChecked();
  });

  it("locks launch args while showing the runtime graph", () => {
    useGraphStore.setState({
      graphSource: "runtime",
      launchArgSpecs: [
        { name: "map_path", defaultValue: "", hasDefault: false, choices: [], inputKind: "text" },
        { name: "rviz", defaultValue: "true", hasDefault: true, choices: ["true", "false"], inputKind: "select" }
      ],
      launchArgValues: { map_path: "/current/map", rviz: "true" },
      mapPath: "/current/map",
      showUnusedNodes: false,
      status: "Synced."
    });

    render(<App />);

    expect(screen.getByText("Launch args are locked while synced from running ROS. Disconnect runtime before changing them.")).toBeInTheDocument();
    expect(screen.getByLabelText("arg:map_path")).toBeDisabled();
    expect(screen.getByLabelText("arg:rviz")).toBeDisabled();

    useGraphStore.getState().setLaunchArgValue("map_path", "/new/map");

    expect(useGraphStore.getState().launchArgValues.map_path).toBe("/current/map");
    expect(useGraphStore.getState().status).toBe("Launch args are locked while synced from running ROS. Disconnect runtime before changing them.");

    useGraphStore.getState().resetDraft();

    expect(useGraphStore.getState().launchArgValues).toEqual({ map_path: "/current/map", rviz: "true" });
    expect(useGraphStore.getState().mapPath).toBe("/current/map");
    expect(useGraphStore.getState().status).toBe("Launch args are locked while synced from running ROS. Disconnect runtime before changing them.");
  });

  it("keeps composition switches editable while showing the runtime graph", () => {
    resetComposition();
    useGraphStore.setState({
      graphSource: "runtime",
      composition: { ...emptyComposition(), argOverrides: { planner_type: "a" } },
      switchArgs: [{ name: "planner_type", defaultValue: "a", candidates: ["a", "b"], source: "condition" }],
      selectedNodeId: "planner",
      graph: {
        nodes: [
          {
            id: "planner",
            name: "planner",
            launchFile: "/L/planner.launch.xml",
            inputs: [],
            outputs: [],
            params: [],
            gatedBy: ["planner_type"]
          }
        ],
        edges: [],
        includes: [],
        launchGraph: { launches: [], edges: [] }
      }
    });

    render(<App />);

    // Switches are composition, not launch args, so they stay editable while synced.
    expect(screen.getByLabelText("node-switch:planner_type")).not.toBeDisabled();

    // Changing a switch records the draft and does not reparse / leave runtime.
    useGraphStore.getState().setSwitchValue("planner_type", "b");
    expect(useGraphStore.getState().composition.argOverrides).toEqual({ planner_type: "b" });
    expect(useGraphStore.getState().graphSource).toBe("runtime");
    expect(useGraphStore.getState().status).toContain("Save");

    // Reset Composition also works while synced.
    useGraphStore.getState().resetComposition();
    expect(useGraphStore.getState().composition.argOverrides).toEqual({});
    expect(useGraphStore.getState().graphSource).toBe("runtime");

    resetComposition();
  });

  it("keeps node selection empty after loading a graph", async () => {
    vi.mocked(window.api.readReachableFiles).mockResolvedValue({
      "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>",
      "/ws/src/demo_pkg/launch/entry.launch.xml": `
        <launch>
          <node pkg="demo_pkg" exec="lsdb_interface" name="lsdb_interface"/>
        </launch>
      `
    });
    useGraphStore.setState({
      sourceRoot: "/ws/src",
      entryLaunch: "/ws/src/demo_pkg/launch/entry.launch.xml",
      launchArgSpecs: [{ name: "map_path", defaultValue: "", hasDefault: false, choices: [], inputKind: "text" }],
      launchArgValues: { map_path: "" },
      mapPath: "",
      selectedNodeId: "lsdb_interface"
    });

    await useGraphStore.getState().loadGraph();

    await waitFor(() => expect(useGraphStore.getState().status).toContain("Loaded 1 nodes"));
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it("selects the launch file through a filesystem picker", async () => {
    const planningLaunch = "/ws/src/a/launch/planning_simulator.launch.xml";
    const sensingLaunch = "/ws/src/b/launch/sensing.launch.xml";
    vi.mocked(window.api.pathForFile).mockReturnValue(sensingLaunch);
    vi.mocked(window.api.readText).mockResolvedValue('<launch><arg name="vehicle_model" default="palta"/></launch>');
    vi.mocked(window.api.readReachableFiles).mockResolvedValue({
      [sensingLaunch]: '<launch><node pkg="demo_pkg" exec="talker" name="talker"/></launch>',
      "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>"
    });
    useGraphStore.setState({
      sourceRoot: "/home/ryofunai/PALTA_autoware/src",
      entryLaunch: planningLaunch,
      mapPath: defaultMapPath
    });

    render(<App />);
    const input = screen.getByLabelText("launch_file_picker");
    fireEvent.change(input, { target: { files: [new File([""], "sensing.launch.xml", { type: "text/xml" })] } });

    await waitFor(() => expect(useGraphStore.getState().entryLaunch).toBe(sensingLaunch));
    expect(window.api.pathForFile).toHaveBeenCalled();
    await waitFor(() =>
      expect(window.api.readReachableFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          entryLaunch: sensingLaunch
        })
      )
    );
    expect(screen.getAllByText("sensing.launch.xml").length).toBeGreaterThan(0);
  });

  it("shows the selected launch without exposing a full-path text input", () => {
    const planningLaunch =
      "/home/ryofunai/PALTA_autoware/src/launcher/autoware_launch/autoware_launch/launch/planning_simulator.launch.xml";
    useGraphStore.setState({
      entryLaunch: planningLaunch,
      mapPath: defaultMapPath
    });

    render(<App />);

    expect(screen.queryByLabelText("entry_launch")).not.toBeInTheDocument();
    expect(screen.getByText("planning_simulator.launch.xml")).toBeInTheDocument();
    expect(screen.getByText("launcher/autoware_launch/autoware_launch/launch")).toBeInTheDocument();
  });

  it("recomposes the selected node without an edit mode toggle", () => {
    resetComposition();
    useGraphStore.setState({
      entryLaunch: "",
      composition: emptyComposition(),
      switchArgs: [{ name: "pose_source", defaultValue: "ndt", candidates: ["ndt", "yabloc"], source: "condition" }],
      selectedNodeId: "ndt_scan_matcher",
      graph: {
        nodes: [
          {
            id: "ndt_scan_matcher",
            name: "ndt_scan_matcher",
            launchFile: "/L/ndt.launch.xml",
            inputs: [],
            outputs: [{ id: "ndt:out", nodeId: "ndt_scan_matcher", topicName: "/pose", dataType: "known", kind: "output" }],
            params: [],
            gatedBy: ["pose_source"]
          }
        ],
        edges: [],
        includes: [],
        launchGraph: { launches: [], edges: [] }
      }
    });

    render(<App />);

    expect(screen.queryByText("Edit Mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Exit Edit")).not.toBeInTheDocument();
    expect(screen.getByText("Recompose")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "I/O" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Parameters" })).not.toBeInTheDocument();
    expect(screen.queryByText("Subscribers")).not.toBeInTheDocument();
    expect(screen.queryByText("Publishers")).not.toBeInTheDocument();
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Disable node"));
    expect(useGraphStore.getState().composition.disabledNodeIds).toEqual(["ndt_scan_matcher"]);

    fireEvent.change(screen.getByLabelText("node-switch:pose_source"), { target: { value: "yabloc" } });
    expect(useGraphStore.getState().composition.argOverrides.pose_source).toBe("yabloc");

    fireEvent.click(screen.getByRole("button", { name: /I\/O/ }));
    expect(screen.getAllByText("Publishers").length).toBeGreaterThan(0);
    expect(screen.queryByText("Subscribers")).not.toBeInTheDocument();
    expect(screen.getByText("/pose")).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "Save" })[0]).not.toBeDisabled();
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    resetComposition();
  });

  it("adds a node through the composition form", () => {
    resetComposition();
    useGraphStore.setState({
      composition: emptyComposition(),
      selectedNodeId: "listener",
      graph: {
        nodes: [{ id: "listener", name: "listener", launchFile: "/L/entry.launch.xml", inputs: [], outputs: [], params: [] }],
        edges: [],
        includes: [],
        launchGraph: { launches: [], edges: [] }
      }
    });

    render(<App />);

    // Add Node lives on the graph-wide Composition tab, not the selected node's tab.
    fireEvent.click(screen.getByRole("tab", { name: "Composition" }));
    fireEvent.change(screen.getByLabelText("add-node-name"), { target: { value: "extra_node" } });
    fireEvent.change(screen.getByLabelText("add-node-package"), { target: { value: "demo_pkg" } });
    fireEvent.change(screen.getByLabelText("add-node-executable"), { target: { value: "talker" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Node" }));

    expect(useGraphStore.getState().composition.addedNodes).toEqual([
      { name: "extra_node", packageName: "demo_pkg", executable: "talker" }
    ]);
    resetComposition();
  });

  it("toggles node I/O and parameters inside the node detail panel", () => {
    useGraphStore.setState({
      selectedNodeId: "planner",
      graphSource: "static",
      graph: {
        nodes: [
          {
            id: "planner",
            name: "planner",
            launchFile: "/L/planner.launch.xml",
            inputs: [{ id: "planner:in", nodeId: "planner", topicName: "/input/path", dataType: "nav_msgs/Path", kind: "input" }],
            outputs: [{ id: "planner:out", nodeId: "planner", topicName: "/output/traj", dataType: "autoware/Trajectory", kind: "output" }],
            params: [
              {
                nodeId: "planner",
                nodeName: "planner",
                key: "rear_offset",
                value: -0.5,
                sourceFile: "/L/planner.launch.xml",
                dirty: false
              },
              {
                nodeId: "planner",
                nodeName: "planner",
                key: "speed_limit",
                value: 4.2,
                sourceFile: "/L/planner.launch.xml",
                dirty: false
              },
              {
                nodeId: "planner",
                nodeName: "planner",
                key: "speed_offset",
                value: 1001,
                sourceFile: "/L/planner.launch.xml",
                dirty: false
              },
              {
                nodeId: "planner",
                nodeName: "planner",
                key: "front_offset",
                value: 0.5,
                sourceFile: "/L/planner.launch.xml",
                dirty: false
              }
            ]
          }
        ],
        edges: [],
        includes: [],
        launchGraph: { launches: [], edges: [] }
      }
    });

    render(<App />);

    expect(screen.getByText("Recompose")).toBeInTheDocument();
    expect(screen.queryByText("/input/path")).not.toBeInTheDocument();
    expect(screen.queryByText("speed_limit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I\/O/ }));
    expect(screen.getAllByText("Subscribers").length).toBeGreaterThan(0);
    expect(screen.getByText("/input/path")).toBeInTheDocument();
    expect(screen.getByText("/output/traj")).toBeInTheDocument();

    fireEvent.click(screen.getByText("/input/path"));
    expect(screen.getByDisplayValue("/input/path")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I\/O/ }));
    expect(screen.queryByText("/input/path")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Parameters/ }));
    expect(screen.getByText("speed_limit:")).toBeInTheDocument();
    expect(screen.getByText("rear_offset:")).toBeInTheDocument();
    expect(screen.getByText("front_offset:")).toBeInTheDocument();
    expect(screen.queryByText("rear")).not.toBeInTheDocument();
    expect(screen.queryByText("front")).not.toBeInTheDocument();
    expect(screen.getByText("speed_limit:").compareDocumentPosition(screen.getByText("rear_offset:"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Applied on relaunch")).toBeInTheDocument();
    expect(screen.queryByText("on relaunch")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter parameters")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Parameters/ }));
    expect(screen.queryByText("speed_limit:")).not.toBeInTheDocument();
  });

  it("syncs the graph from the running ROS node list", async () => {
    vi.mocked(window.api.readReachableFiles).mockResolvedValue({
      "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>",
      "/ws/src/demo_pkg/launch/entry.launch.xml": `
        <launch>
          <arg name="controller" default="mpc"/>
          <group if="$(eval &quot;'$(var controller)'=='mpc'&quot;)">
            <node pkg="demo_pkg" exec="control" name="/control/control_container">
              <param name="static_gain" value="2.0"/>
            </node>
          </group>
          <group if="$(eval &quot;'$(var controller)'=='pure_pursuit'&quot;)">
            <node pkg="demo_pkg" exec="pp" name="/control/pure_pursuit"/>
          </group>
        </launch>
      `
    });
    const runtime = buildRuntimeGraph({
      nodes: [
        { name: "/control/control_container", publishers: { "/cmd": "T" }, subscribers: {} },
        { name: "/vehicle/converter", publishers: {}, subscribers: { "/cmd": "T" } }
      ]
    });
    vi.mocked(fetchRuntimeGraph).mockResolvedValue(runtime);
    vi.mocked(window.api.rosDynamicParams).mockResolvedValue([
      {
        nodeName: "/control/control_container",
        paramName: "gain",
        value: 1.5,
        parameterType: "double",
        readOnly: false
      }
    ]);
    useGraphStore.setState({ graphSource: "static", sourceRoot: "/ws/src", entryLaunch: "/ws/src/demo_pkg/launch/entry.launch.xml" });

    render(<TopToolbar />);
    fireEvent.click(screen.getByText("Sync from running ROS"));

    await waitFor(() => expect(useGraphStore.getState().graphSource).toBe("runtime"));
    expect(window.api.ensureRosbridge).toHaveBeenCalledWith("ws://localhost:9090");
    expect(window.api.rosDynamicParams).toHaveBeenCalledWith(["/control/control_container", "/vehicle/converter"]);
    expect(useGraphStore.getState().graph.nodes.map((node) => node.name)).toContain("/control/control_container");
    const controlNode = useGraphStore.getState().graph.nodes.find((node) => node.name === "/control/control_container");
    expect(controlNode?.gatedBy).toEqual(["controller"]);
    expect(useGraphStore.getState().switchArgs.find((item) => item.name === "controller")?.candidates).toEqual([
      "mpc",
      "pure_pursuit"
    ]);
    expect(controlNode?.params).toEqual([
      expect.objectContaining({ key: "static_gain" }),
      expect.objectContaining({
        key: "gain",
        dynamic: true,
        parameterType: "double"
      })
    ]);
    expect(useGraphStore.getState().graph.edges).toHaveLength(1);

    fireEvent.click(screen.getByText("Disconnect runtime"));

    await waitFor(() => expect(useGraphStore.getState().graphSource).toBe("static"));
    expect(useGraphStore.getState().graph.nodes.map((node) => node.name)).toEqual(["/control/control_container"]);
    expect(useGraphStore.getState().graph.nodes[0].params).toEqual([expect.objectContaining({ key: "static_gain" })]);
    expect(useGraphStore.getState().graph.edges).toHaveLength(0);
    expect(screen.getByText("Sync from running ROS")).toBeInTheDocument();
  });

  it("tunes only runtime dynamic parameters and exports an overlay launch", async () => {
    vi.mocked(window.api.getOutputRoot).mockResolvedValue("/over");
    useGraphStore.setState({
      sourceRoot: "/ws/src",
      entryLaunch: "/ws/src/demo_pkg/launch/entry.launch.xml",
      launchArgSpecs: [],
      launchArgValues: { map_path: "/tmp/map" },
      mapPath: "/tmp/map",
      graphSource: "runtime",
      dynamicTuningSession: [],
      selectedNodeId: "/planning/foo",
      graph: {
        nodes: [
          {
            id: "/planning/foo",
            name: "/planning/foo",
            launchFile: "runtime",
            inputs: [],
            outputs: [],
            params: [
              {
                nodeId: "/planning/foo",
                nodeName: "/planning/foo",
                key: "threshold",
                value: 1,
                sourceFile: "runtime",
                dirty: false,
                dynamic: true,
                parameterType: "double",
                readOnly: false
              },
              {
                nodeId: "/planning/foo",
                nodeName: "/planning/foo",
                key: "static_param",
                value: "x",
                sourceFile: "runtime",
                dirty: false,
                dynamic: false,
                readOnly: false
              }
            ]
          }
        ],
        edges: [],
        includes: [],
        launchGraph: { launches: [], edges: [] }
      }
    });

    render(<App />);

    expect(screen.queryByTitle("runtime")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Parameters/ }));
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2.5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]);

    await waitFor(() => expect(window.api.rosParamSet).toHaveBeenCalledWith("/planning/foo", "threshold", "2.5"));
    expect(useGraphStore.getState().dynamicTuningSession).toEqual([
      { nodeName: "/planning/foo", key: "threshold", value: "2.5", parameterType: "double" }
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() =>
      expect(window.api.writeText).toHaveBeenCalledWith(
        expect.stringMatching(/^\/over\/runs\/\d{4}-\d{2}-\d{2}_\d{6}_\d{3}\/launch\/autoware_graph_studio\.launch\.py$/),
        expect.stringContaining("ros2")
      )
    );
    expect(window.api.writeTextFilesAtomically).toHaveBeenCalledWith(
      "/over/latest",
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "launch/autoware_graph_studio.launch.py",
          content: expect.stringContaining("ros2")
        }),
        expect.objectContaining({
          relativePath: "manifest.json",
          content: expect.stringContaining('"dynamicParams"')
        })
      ])
    );
    expect(window.api.removePath).not.toHaveBeenCalledWith("/over/latest");
    expect(useGraphStore.getState().entryForkPath).toBe("/over/latest/launch/autoware_graph_studio.launch.py");
  });

  it("queues runtime static parameters and restarts their target after save", async () => {
    const entryLaunch = "/ws/src/demo_pkg/launch/entry.launch.xml";
    vi.mocked(window.api.getOutputRoot).mockResolvedValue("/over");
    vi.mocked(window.api.readReachableFiles).mockResolvedValue({
      "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>",
      [entryLaunch]: `<launch>
  <node pkg="demo_pkg" exec="controller" name="controller">
    <param name="gain" value="1"/>
  </node>
</launch>
`
    });
    useGraphStore.setState({
      sourceRoot: "/ws/src",
      entryLaunch,
      launchArgSpecs: [],
      launchArgValues: {},
      graphSource: "runtime",
      pendingOverrides: [],
      pendingTopicOverrides: [],
      dynamicTuningSession: [],
      graph: {
        nodes: [
          {
            id: "/controller",
            name: "/controller",
            launchFile: entryLaunch,
            inputs: [],
            outputs: [],
            restartTarget: {
              kind: "component",
              nodeName: "/controller",
              restartName: "/control/control_container",
              containerName: "/control/control_container",
              plugin: "demo_pkg::Controller",
              launchFile: entryLaunch
            },
            params: [
              {
                nodeId: "/controller",
                nodeName: "/controller",
                sourceNodeName: "controller",
                key: "gain",
                value: 1,
                sourceFile: entryLaunch,
                dirty: false,
                dynamic: false,
                readOnly: false
              }
            ]
          }
        ],
        edges: [],
        includes: [],
        launchGraph: {
          launches: [
            {
              path: entryLaunch,
              label: "entry.launch.xml",
              includePaths: [],
              nodeNames: ["controller"],
              totalNodeCount: 1,
              argNames: [],
              paramFiles: [],
              parameters: []
            }
          ],
          edges: []
        }
      }
    });

    const parameter = useGraphStore.getState().graph.nodes[0].params[0];
    await useGraphStore.getState().updateParameter(parameter, "2.5");

    expect(window.api.rosParamSet).not.toHaveBeenCalled();
    expect(window.api.restartNode).not.toHaveBeenCalled();
    expect(useGraphStore.getState().pendingOverrides).toEqual([
      expect.objectContaining({
        nodeName: "/controller",
        key: "gain",
        value: 2.5,
        sourceFile: entryLaunch,
        nodeAliases: expect.arrayContaining(["/controller", "controller"])
      })
    ]);

    await useGraphStore.getState().apply();

    expect(window.api.writeTextFilesAtomically).toHaveBeenCalledWith(
      "/over/latest",
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "forks/demo_pkg/launch/entry.launch.xml",
          content: expect.stringContaining('<param name="gain" value="2.5"/>')
        }),
        expect.objectContaining({
          relativePath: "manifest.json",
          content: expect.stringContaining('"restartTargets"')
        })
      ])
    );
    expect(window.api.restartNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeName: "/controller",
        targetName: "/control/control_container",
        kind: "component",
        containerName: "/control/control_container",
        latestEntryLaunch: "/over/latest/launch/autoware_graph_studio.launch.py"
      })
    );
  });

  it("offers an optimize layout button on the topic graph", () => {
    useGraphStore.setState({ selectedNodeId: null });
    render(<App />);
    expect(screen.getByRole("button", { name: "Optimize Layout" })).toBeInTheDocument();
  });

  it("can hide the property detail panel", () => {
    useGraphStore.setState({ selectedNodeId: null });
    render(<App />);

    expect(screen.getByText("Select a node.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText("Select a node.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
  });

  it("can hide the launch setup panel", () => {
    useGraphStore.setState({ mapPath: defaultMapPath });
    render(<App />);

    expect(screen.getByText("Selected Launch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide launch setup" }));
    expect(screen.queryByText("Selected Launch")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show launch setup" })).toBeInTheDocument();
  });

  it("switches to launch graph and shows launch details", async () => {
    useGraphStore.setState({
      entryLaunch: "/ws/src/demo_pkg/launch/entry.launch.xml",
      graphSource: "runtime",
      launchArgSpecs: [],
      graph: {
        nodes: [],
        edges: [],
        includes: [{ fromLaunch: "/ws/src/demo_pkg/launch/entry.launch.xml", toLaunch: "/ws/src/child_pkg/launch/child.launch.xml" }],
        launchGraph: {
          launches: [
            {
              path: "/ws/src/demo_pkg/launch/entry.launch.xml",
              label: "entry.launch.xml",
              includePaths: ["/ws/src/child_pkg/launch/child.launch.xml"],
              nodeNames: [],
              totalNodeCount: 1,
              argNames: ["vehicle_model", "sensor_model"],
              paramFiles: ["/ws/src/demo_pkg/config/demo.param.yaml"],
              parameters: [
                {
                  nodeId: "talker",
                  nodeName: "talker",
                  key: "gain",
                  value: 1,
                  sourceFile: "/ws/src/demo_pkg/config/demo.param.yaml",
                  dirty: false
                }
              ]
            },
            {
              path: "/ws/src/child_pkg/launch/child.launch.xml",
              label: "child.launch.xml",
              includePaths: [],
              nodeNames: ["child_node"],
              totalNodeCount: 1,
              argNames: [],
              paramFiles: [],
              parameters: []
            }
          ],
          edges: [
            {
              id: "/ws/src/demo_pkg/launch/entry.launch.xml->/ws/src/child_pkg/launch/child.launch.xml",
              source: "/ws/src/demo_pkg/launch/entry.launch.xml",
              target: "/ws/src/child_pkg/launch/child.launch.xml"
            }
          ]
        }
      }
    });
    render(<App />);

    fireEvent.click(screen.getByText("Launch Graph"));
    expect(screen.queryByText("Click a launch to expand or collapse its includes.")).not.toBeInTheDocument();
    expect(screen.queryByText("contains ROS nodes")).not.toBeInTheDocument();
    expect(screen.queryByText("direct / total counts")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Launch graph legend")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Optimize Layout" })).toBeInTheDocument();
    expect(screen.getByText("Select a launch.")).toBeInTheDocument();
    expect(screen.queryAllByText("child.launch.xml").some((element) => element.closest(".launch-node"))).toBe(false);
    const entryLaunchNode = screen.getAllByText("entry.launch.xml").find((element) => element.closest(".launch-node"));
    expect(entryLaunchNode).toBeTruthy();
    fireEvent.click(entryLaunchNode as HTMLElement);

    await waitFor(() => expect(screen.getByText("Nodes Started Here")).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getAllByText("entry.launch.xml").find((element) => element.closest(".launch-node"))?.closest(".launch-node")).toHaveClass(
        "has-ros-nodes"
      );
      expect(screen.getAllByText("child.launch.xml").find((element) => element.closest(".launch-node"))?.closest(".launch-node")).toHaveClass(
        "has-ros-nodes"
      );
    });
    expect(screen.getByText("direct 0")).toBeInTheDocument();
    expect(screen.getAllByText("total 1")).toHaveLength(2);
    expect(screen.getAllByLabelText("1 total nodes")).toHaveLength(2);
    expect(screen.queryByLabelText("ROS nodes in entry.launch.xml")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ROS nodes/i })).not.toBeInTheDocument();
    const argsToggle = screen.getByRole("button", { name: /Args/i });
    expect(argsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("vehicle_model")).not.toBeInTheDocument();
    fireEvent.click(argsToggle);
    expect(argsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("vehicle_model")).toBeInTheDocument();
    expect(screen.getByText("sensor_model")).toBeInTheDocument();
    expect(screen.getAllByText("child.launch.xml").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("ROS nodes in child.launch.xml")).toBeInTheDocument();
    expect(screen.getByText("child_node")).toBeInTheDocument();
    expect(screen.getByText("talker.gain")).toBeInTheDocument();
  });
});
