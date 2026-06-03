import { describe, expect, it } from "vitest";
import {
  buildEdges,
  buildPackageIndex,
  buildRuntimeGraph,
  mergeResolvedGraph,
  mergeRuntimeGraphWithStaticGraph,
  parseStaticGraph
} from "../lib/parser";
import { edgeClass, visibleNodes } from "../lib/filters";
import { buildCanvasEdges, targetArrowAngleForCanvasEdge } from "../lib/canvasEdges";
import { buildCategoryFrameRects } from "../lib/categoryFrames";
import { buildClusteredGraph, classifyNode, type ClusterId } from "../lib/clusters";
import { resolveTopicNodeCollisions } from "../lib/clusterCollision";
import { graphTopologyKey, layoutGroupedGraph } from "../lib/graphLayout";
import { sizeForFlowNode } from "../lib/nodeSizes";
import {
  directChildLaunchPaths,
  estimatedLaunchNodeHeight,
  launchFlowEdges,
  launchGraphRenderKey,
  layoutLaunchGraph,
  placeNewChildLaunchesNearParent,
  resolveLaunchNodeCollisions,
  visibleLaunchEdges,
  visibleLaunchPaths
} from "../lib/launchGraphLayout";
import { defaultNodeSize } from "../lib/nodeSizes";
import { applyPositionOverrides, withPositionOverride } from "../lib/positionOverrides";
import { connectedNodeIdsForSelection, selectedTopicNamesForNode, selectedTopicRolesForNode } from "../lib/selection";
import { upsertParamOverride, upsertTopicOverride } from "../lib/overlays";
import type { GraphModel, ResolvedGraph } from "../lib/graphModel";

const files = {
  "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>",
  "/ws/src/child_pkg/package.xml": "<package><name>child_pkg</name></package>",
  "/ws/src/demo_pkg/launch/entry.launch.xml": `
    <launch>
      <arg name="vehicle_model" default="sample_vehicle"/>
      <arg name="sensor_model" default="sample_sensor_kit"/>
      <include file="$(find-pkg-share child_pkg)/launch/child.launch.xml">
        <arg name="param_file" value="$(find-pkg-share child_pkg)/config/child.param.yaml"/>
      </include>
      <node pkg="demo_pkg" exec="talker" name="psim_talker">
        <remap from="~/output/state" to="/psim/state"/>
        <param from="$(find-pkg-share demo_pkg)/config/demo.param.yaml"/>
      </node>
      <node pkg="demo_pkg" exec="listener" name="listener">
        <remap from="~/input/state" to="/psim/state"/>
      </node>
      <node pkg="demo_pkg" exec="idle" name="unused_node"/>
    </launch>
  `,
  "/ws/src/child_pkg/launch/child.launch.xml": `
    <launch>
      <arg name="param_file"/>
      <node pkg="child_pkg" exec="child" name="child_node">
        <param from="$(var param_file)"/>
      </node>
    </launch>
  `,
  "/ws/src/demo_pkg/config/demo.param.yaml": `
/**:
  ros__parameters:
    gain: 1.0
    enabled: true
  `,
  "/ws/src/child_pkg/config/child.param.yaml": `
/**:
  ros__parameters:
    threshold: 2.5
  `
};

describe("PALTA graph model", () => {
  it("builds a package index", () => {
    expect(buildPackageIndex(files)).toEqual({
      demo_pkg: "/ws/src/demo_pkg",
      child_pkg: "/ws/src/child_pkg"
    });
  });

  it("parses launch nodes, include params, and topic edges", () => {
    const graph = parseStaticGraph(files, "/ws/src/demo_pkg/launch/entry.launch.xml", {
      vehicle_model: "palta",
      sensor_model: "palta_sensor_kit",
      map_path: "/tmp/map"
    });
    expect(graph.nodes.map((node) => node.name)).toContain("psim_talker");
    expect(graph.nodes.map((node) => node.name)).toContain("child_node");
    expect(graph.nodes.find((node) => node.name === "psim_talker")?.params[0]?.key).toBe("gain");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: "psim_talker",
      target: "listener",
      topicName: "/psim/state"
    });
  });

  it("removes ROS system topics from static and runtime graphs", () => {
    const graph = parseStaticGraph(
      {
        ...files,
        "/ws/src/demo_pkg/launch/system_topics.launch.xml": `
          <launch>
            <node pkg="demo_pkg" exec="talker" name="talker">
              <remap from="~/output/rosout" to="/rosout"/>
              <remap from="~/output/state" to="/state"/>
            </node>
            <node pkg="demo_pkg" exec="listener" name="listener">
              <remap from="~/input/parameter_events" to="/parameter_events"/>
              <remap from="~/input/state" to="/state"/>
            </node>
          </launch>
        `
      },
      "/ws/src/demo_pkg/launch/system_topics.launch.xml",
      {}
    );

    expect(graph.nodes.flatMap((node) => [...node.inputs, ...node.outputs]).map((pin) => pin.topicName)).toEqual([
      "/state",
      "/state"
    ]);
    expect(graph.edges.map((edge) => edge.topicName)).toEqual(["/state"]);

    const runtime = buildRuntimeGraph({
      nodes: [
        {
          name: "/talker",
          publishers: {
            "/rosout": "rcl_interfaces/msg/Log",
            "/parameter_events": "rcl_interfaces/msg/ParameterEvent",
            "/state": "std_msgs/msg/String"
          },
          subscribers: {}
        },
        {
          name: "/listener",
          publishers: {},
          subscribers: {
            "/parameter_events": "rcl_interfaces/msg/ParameterEvent",
            "/state": "std_msgs/msg/String"
          }
        }
      ]
    });

    expect(runtime.nodes.flatMap((node) => [...node.inputs, ...node.outputs]).map((pin) => pin.topicName)).toEqual([
      "/state",
      "/state"
    ]);
    expect(runtime.edges.map((edge) => edge.topicName)).toEqual(["/state"]);
  });

  it("preserves static launch metadata when showing a running ROS graph", () => {
    const staticGraph = parseStaticGraph(
      {
        "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>",
        "/ws/src/demo_pkg/launch/entry.launch.xml": `
          <launch>
            <arg name="pose_source" default="ndt"/>
            <group if="$(eval &quot;'$(var pose_source)'=='ndt'&quot;)">
              <node pkg="demo_pkg" exec="ndt" name="ndt_scan_matcher">
                <param name="score_threshold" value="1.0"/>
              </node>
            </group>
          </launch>
        `
      },
      "/ws/src/demo_pkg/launch/entry.launch.xml",
      { pose_source: "ndt" }
    );
    const runtimeGraph = buildRuntimeGraph({
      nodes: [{ name: "/ndt_scan_matcher", publishers: { "/pose": "Pose" }, subscribers: {} }]
    });

    const merged = mergeRuntimeGraphWithStaticGraph(runtimeGraph, staticGraph);
    const node = merged.nodes[0];

    expect(node.launchFile).toBe("/ws/src/demo_pkg/launch/entry.launch.xml");
    expect(node.gatedBy).toEqual(["pose_source"]);
    expect(node.params).toEqual([
      expect.objectContaining({
        nodeName: "/ndt_scan_matcher",
        key: "score_threshold"
      })
    ]);
    expect(merged.launchGraph.launches).toHaveLength(1);
  });

  it("matches runtime composable nodes with static restart metadata", () => {
    const staticGraph = parseStaticGraph(
      {
        "/ws/src/control_pkg/package.xml": "<package><name>control_pkg</name></package>",
        "/ws/src/control_pkg/launch/entry.launch.xml": `
          <launch>
            <load_composable_node target="/control/control_container">
              <composable_node pkg="control_pkg" plugin="ns::Controller" name="controller_node" namespace="trajectory_follower">
                <param name="gain" value="1.0"/>
              </composable_node>
            </load_composable_node>
          </launch>
        `
      },
      "/ws/src/control_pkg/launch/entry.launch.xml",
      {}
    );
    const runtimeGraph = buildRuntimeGraph({
      nodes: [{ name: "/control/trajectory_follower/controller_node", publishers: {}, subscribers: {} }]
    });

    const merged = mergeRuntimeGraphWithStaticGraph(runtimeGraph, staticGraph);
    const node = merged.nodes[0];

    expect(node.launchFile).toBe("/ws/src/control_pkg/launch/entry.launch.xml");
    expect(node.params).toEqual([expect.objectContaining({ key: "gain", sourceNodeName: "controller_node" })]);
    expect(node.restartTarget).toMatchObject({
      kind: "component",
      nodeName: "/control/trajectory_follower/controller_node",
      restartName: "/control/control_container",
      containerName: "/control/control_container",
      plugin: "ns::Controller"
    });
  });

  it("builds launch graph details for includes, nodes, args, and parameters", () => {
    const graph = parseStaticGraph(files, "/ws/src/demo_pkg/launch/entry.launch.xml", {
      vehicle_model: "palta",
      sensor_model: "palta_sensor_kit",
      map_path: "/tmp/map"
    });

    expect(graph.launchGraph.edges).toEqual([
      {
        id: "/ws/src/demo_pkg/launch/entry.launch.xml->/ws/src/child_pkg/launch/child.launch.xml",
        source: "/ws/src/demo_pkg/launch/entry.launch.xml",
        target: "/ws/src/child_pkg/launch/child.launch.xml"
      }
    ]);
    expect(graph.launchGraph.launches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/ws/src/demo_pkg/launch/entry.launch.xml",
          label: "entry.launch.xml",
          includePaths: ["/ws/src/child_pkg/launch/child.launch.xml"],
          nodeNames: ["psim_talker", "listener", "unused_node"],
          totalNodeCount: 4,
          argNames: ["vehicle_model", "sensor_model"],
          paramFiles: ["/ws/src/demo_pkg/config/demo.param.yaml"]
        }),
        expect.objectContaining({
          path: "/ws/src/child_pkg/launch/child.launch.xml",
          label: "child.launch.xml",
          nodeNames: ["child_node"],
          totalNodeCount: 1,
          argNames: ["param_file"],
          paramFiles: ["/ws/src/child_pkg/config/child.param.yaml"]
        })
      ])
    );
    expect(graph.launchGraph.launches.find((launch) => launch.path.endsWith("entry.launch.xml"))?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeName: "psim_talker", key: "gain", sourceFile: "/ws/src/demo_pkg/config/demo.param.yaml" })
      ])
    );
  });

  it("shows only expanded launch branches and lays them out from left to right", () => {
    const launchGraph = {
      launches: [
        { path: "entry", label: "entry", includePaths: ["a", "b"], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] },
        { path: "a", label: "a", includePaths: ["a1"], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] },
        { path: "a1", label: "a1", includePaths: [], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] },
        { path: "b", label: "b", includePaths: [], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] }
      ],
      edges: [
        { id: "entry->a", source: "entry", target: "a" },
        { id: "entry->b", source: "entry", target: "b" },
        { id: "a->a1", source: "a", target: "a1" }
      ]
    };

    const collapsed = visibleLaunchPaths(launchGraph, "entry", new Set());
    expect([...collapsed]).toEqual(["entry"]);

    const entryExpanded = visibleLaunchPaths(launchGraph, "entry", new Set(["entry"]));
    expect([...entryExpanded]).toEqual(["entry", "a", "b"]);
    expect(visibleLaunchEdges(launchGraph.edges, entryExpanded).map((edge) => edge.id)).toEqual(["entry->a", "entry->b"]);
    expect(launchGraphRenderKey(entryExpanded, visibleLaunchEdges(launchGraph.edges, entryExpanded))).toBe("a|b|entry::entry->a|entry->b");
    expect(launchGraphRenderKey(collapsed, visibleLaunchEdges(launchGraph.edges, collapsed))).toBe("entry::");
    expect(launchFlowEdges(visibleLaunchEdges(launchGraph.edges, entryExpanded), "entry").some((edge) => edge.animated)).toBe(false);

    const nodes = layoutLaunchGraph(
      launchGraph.launches.filter((launch) => entryExpanded.has(launch.path)),
      visibleLaunchEdges(launchGraph.edges, entryExpanded),
      null
    );
    const entry = nodes.find((node) => node.id === "entry");
    const child = nodes.find((node) => node.id === "a");
    expect(entry?.position.x).toBeLessThan(child?.position.x ?? 0);
  });

  it("estimates taller launch cards when ROS nodes are always visible", () => {
    expect(estimatedLaunchNodeHeight({ nodeNames: [] })).toBeLessThan(estimatedLaunchNodeHeight({ nodeNames: ["robot_state_publisher"] }));
    expect(estimatedLaunchNodeHeight({ nodeNames: ["a"] })).toBeLessThan(estimatedLaunchNodeHeight({ nodeNames: ["a", "b", "c", "d", "e"] }));
    expect(estimatedLaunchNodeHeight({ nodeNames: Array.from({ length: 20 }, (_, index) => `node_${index}`) })).toBe(
      estimatedLaunchNodeHeight({ nodeNames: Array.from({ length: 10 }, (_, index) => `node_${index}`) })
    );
  });

  it("places newly expanded child launches near the parent without moving existing launches", () => {
    const launches = new Map([
      ["parent", { path: "parent", label: "parent", includePaths: ["child_a", "child_b"], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] }],
      ["child_a", { path: "child_a", label: "child_a", includePaths: [], nodeNames: ["node_a"], totalNodeCount: 1, argNames: [], paramFiles: [], parameters: [] }],
      ["child_b", { path: "child_b", label: "child_b", includePaths: [], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] }]
    ]);
    const current = {
      parent: { x: 100, y: 200 },
      sibling: { x: 100, y: 500 }
    };
    const positioned = placeNewChildLaunchesNearParent(current, "parent", ["child_a", "child_b"], launches);

    expect(positioned.parent).toEqual(current.parent);
    expect(positioned.sibling).toEqual(current.sibling);
    expect(positioned.child_a.x).toBeGreaterThan(current.parent.x);
    expect(positioned.child_b.x).toBe(positioned.child_a.x);
    expect(positioned.child_b.y).toBeGreaterThan(positioned.child_a.y);
  });

  it("finds direct visible child launches and pushes overlapping measured launch nodes apart", () => {
    const visible = new Set(["parent", "child", "hidden"]);
    expect(
      directChildLaunchPaths(
        [
          { id: "parent->child", source: "parent", target: "child" },
          { id: "parent->missing", source: "parent", target: "missing" },
          { id: "hidden->parent", source: "hidden", target: "parent" }
        ],
        "parent",
        visible
      )
    ).toEqual(["child"]);

    const positioned = resolveLaunchNodeCollisions(
      [
        { id: "a", position: { x: 0, y: 0 }, data: { nodeNames: [] } },
        { id: "b", position: { x: 20, y: 80 }, data: { nodeNames: [] } }
      ],
      {
        a: { width: 300, height: 160 },
        b: { width: 300, height: 140 }
      },
      24
    );

    expect(positioned.find((node) => node.id === "a")?.position).toEqual({ x: 0, y: 0 });
    expect(positioned.find((node) => node.id === "b")?.position.y).toBe(184);
  });

  it("pushes a vertical chain of optimized launch nodes apart", () => {
    const positioned = resolveLaunchNodeCollisions(
      [
        { id: "a", position: { x: 0, y: 0 }, data: { nodeNames: [] } },
        { id: "b", position: { x: 0, y: 90 }, data: { nodeNames: [] } },
        { id: "c", position: { x: 0, y: 190 }, data: { nodeNames: [] } }
      ],
      {
        a: { width: 300, height: 150 },
        b: { width: 300, height: 170 },
        c: { width: 300, height: 140 }
      },
      20
    );

    const a = positioned.find((node) => node.id === "a");
    const b = positioned.find((node) => node.id === "b");
    const c = positioned.find((node) => node.id === "c");

    expect(b?.position.y).toBe((a?.position.y ?? 0) + 150 + 20);
    expect(c?.position.y).toBe((b?.position.y ?? 0) + 170 + 20);
  });

  it("merges resolved graph pub/sub types", () => {
    const graph = parseStaticGraph(files, "/ws/src/demo_pkg/launch/entry.launch.xml", {
      vehicle_model: "palta",
      sensor_model: "palta_sensor_kit",
      map_path: "/tmp/map"
    });
    const resolved: ResolvedGraph = {
      nodes: [
        {
          name: "psim_talker",
          publishers: { "/psim/state": "std_msgs/msg/String" },
          subscribers: {}
        },
        {
          name: "listener",
          publishers: {},
          subscribers: { "/psim/state": "std_msgs/msg/String" }
        }
      ]
    };
    const merged = mergeResolvedGraph(graph, resolved);
    expect(merged.edges[0].dataType).toBe("std_msgs/msg/String");
  });

  it("hides unused nodes by default and can classify selected edges", () => {
    const graph: GraphModel = {
      nodes: [
        { id: "used", name: "used", launchFile: "x", inputs: [], outputs: [{ id: "p", nodeId: "used", topicName: "/t", dataType: "known", kind: "output" }], params: [] },
        { id: "unused", name: "unused", launchFile: "x", inputs: [], outputs: [], params: [] }
      ],
      edges: buildEdges([
        { id: "a", name: "a", launchFile: "x", inputs: [], outputs: [{ id: "o", nodeId: "a", topicName: "/t", dataType: "known", kind: "output" }], params: [] },
        { id: "b", name: "b", launchFile: "x", inputs: [{ id: "i", nodeId: "b", topicName: "/t", dataType: "known", kind: "input" }], outputs: [], params: [] }
      ]),
      includes: [],
      launchGraph: { launches: [], edges: [] }
    };
    expect(visibleNodes(graph, false).map((node) => node.id)).toEqual(["used"]);
    expect(visibleNodes(graph, true)).toHaveLength(2);
    expect(edgeClass({ id: "e", source: "a", target: "b", topicName: "/t", dataType: "known" }, "a")).toBe("active");
    expect(edgeClass({ id: "e", source: "a", target: "b", topicName: "/t", dataType: "unknown" }, "a")).toBe("active");
    expect(edgeClass({ id: "e", source: "a", target: "b", topicName: "/t", dataType: "unknown" }, "other")).toBe("unknown");
  });

  it("keeps layout topology stable across parameter-only changes", () => {
    const baseNodes = [
      {
        id: "a",
        name: "a",
        launchFile: "x",
        inputs: [],
        outputs: [{ id: "o", nodeId: "a", topicName: "/t", dataType: "known", kind: "output" as const }],
        params: [{ nodeId: "a", nodeName: "a", key: "gain", value: "1", sourceFile: "x", dirty: false }]
      },
      {
        id: "b",
        name: "b",
        launchFile: "x",
        inputs: [{ id: "i", nodeId: "b", topicName: "/t", dataType: "known", kind: "input" as const }],
        outputs: [],
        params: []
      }
    ];
    const dirtyNodes = baseNodes.map((node) =>
      node.id === "a"
        ? { ...node, params: node.params.map((param) => ({ ...param, dirty: true, value: "2" })) }
        : node
    );
    const edges = buildEdges(baseNodes);

    expect(graphTopologyKey(baseNodes, edges)).toBe(graphTopologyKey(dirtyNodes, edges));
    expect(graphTopologyKey(baseNodes, edges, { compact: true })).not.toBe(graphTopologyKey(baseNodes, edges));
  });

  it("builds canvas edge geometry from node positions", () => {
    const canvasEdges = buildCanvasEdges(
      [
        { id: "a", position: { x: 10, y: 20 }, data: {} },
        { id: "b", position: { x: 400, y: 80 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/ab", dataType: "known" }],
      "a"
    );

    expect(canvasEdges).toEqual([
      expect.objectContaining({
        id: "ab",
        sourceX: 270,
        sourceY: 88,
        targetX: 400,
        targetY: 148,
        targetLabelX: 390,
        targetLabelY: 148,
        topicName: "/ab",
        kind: "active",
        dimmed: false
      })
    ]);
  });

  it("uses measured node sizes for canvas edge geometry", () => {
    const canvasEdges = buildCanvasEdges(
      [
        { id: "a", position: { x: 10, y: 20 }, data: {} },
        { id: "b", position: { x: 400, y: 80 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/ab", dataType: "known" }],
      "a",
      new Set(),
      new Map(),
      {
        a: { width: 300, height: 120 },
        b: { width: 280, height: 140 }
      }
    );

    expect(canvasEdges[0]).toEqual(
      expect.objectContaining({
        sourceX: 310,
        sourceY: 80,
        targetX: 400,
        targetY: 150
      })
    );
  });

  it("keeps canvas edge ports outside node rectangles in both directions", () => {
    const forward = buildCanvasEdges(
      [
        { id: "a", position: { x: 10, y: 20 }, data: {} },
        { id: "b", position: { x: 400, y: 20 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/ab", dataType: "known" }],
      "a"
    )[0];
    const backward = buildCanvasEdges(
      [
        { id: "a", position: { x: 400, y: 20 }, data: {} },
        { id: "b", position: { x: 10, y: 20 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/ab", dataType: "known" }],
      "a"
    )[0];

    expect(forward.sourceX).toBeGreaterThanOrEqual(10 + 260);
    expect(forward.targetX).toBeLessThanOrEqual(400);
    expect(backward.sourceX).toBeLessThanOrEqual(400);
    expect(backward.targetX).toBeGreaterThanOrEqual(10 + 260);
    expect(targetArrowAngleForCanvasEdge(forward)).toBe(0);
    expect(targetArrowAngleForCanvasEdge(backward)).toBe(Math.PI);
  });

  it("keeps arrow direction from the selected target side when edge endpoints cross", () => {
    const sameColumn = buildCanvasEdges(
      [
        { id: "a", position: { x: 100, y: 20 }, data: {} },
        { id: "b", position: { x: 100, y: 220 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/ab", dataType: "known" }],
      "a"
    )[0];

    expect(sameColumn.direction).toBe(1);
    expect(sameColumn.targetX).toBeLessThan(sameColumn.sourceX);
    expect(targetArrowAngleForCanvasEdge(sameColumn)).toBe(0);
  });

  it("separates active input and output ports that share the same node side", () => {
    const canvasEdges = buildCanvasEdges(
      [
        { id: "left_source", position: { x: 100, y: 20 }, data: {} },
        { id: "selected", position: { x: 400, y: 20 }, data: {} },
        { id: "left_target", position: { x: 100, y: 260 }, data: {} }
      ],
      [
        { id: "in", source: "left_source", target: "selected", topicName: "/input", dataType: "known" },
        { id: "out", source: "selected", target: "left_target", topicName: "/output", dataType: "known" }
      ],
      "selected"
    );
    const incoming = canvasEdges.find((edge) => edge.id === "in")!;
    const outgoing = canvasEdges.find((edge) => edge.id === "out")!;

    expect(incoming.targetX).toBe(outgoing.sourceX);
    expect(incoming.targetY).not.toBe(outgoing.sourceY);
  });

  it("shows unknown direct canvas edges as active", () => {
    const canvasEdges = buildCanvasEdges(
      [
        { id: "a", position: { x: 10, y: 20 }, data: {} },
        { id: "b", position: { x: 400, y: 80 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/unknown_direct", dataType: "unknown" }],
      "a"
    );

    expect(canvasEdges[0].kind).toBe("active");
    expect(canvasEdges[0].dimmed).toBe(false);
  });

  it("does not highlight indirect canvas edges that only share a selected topic", () => {
    const canvasEdges = buildCanvasEdges(
      [
        { id: "a", position: { x: 10, y: 20 }, data: {} },
        { id: "b", position: { x: 400, y: 80 }, data: {} }
      ],
      [{ id: "ab", source: "a", target: "b", topicName: "/selected_topic", dataType: "known" }],
      "other",
      new Set(["/selected_topic"])
    );

    expect(canvasEdges[0].kind).toBe("inactive");
    expect(canvasEdges[0].dimmed).toBe(false);
  });

  it("points canvas edge arrows into the target node side", () => {
    expect(targetArrowAngleForCanvasEdge({ sourceX: 10, targetX: 100 })).toBe(0);
    expect(targetArrowAngleForCanvasEdge({ sourceX: 100, targetX: 10 })).toBe(Math.PI);
  });

  it("keeps dragged node positions as overrides", () => {
    const nodes = [
      { id: "a", position: { x: 10, y: 20 }, data: {} },
      { id: "b", position: { x: 30, y: 40 }, data: {} }
    ];

    const positioned = applyPositionOverrides(nodes, { b: { x: 300, y: 400 } });

    expect(positioned[0].position).toEqual({ x: 10, y: 20 });
    expect(positioned[1].position).toEqual({ x: 300, y: 400 });
  });

  it("keeps dragged launch positions as overrides", () => {
    const launchNodes = layoutLaunchGraph(
      [
        { path: "entry", label: "entry", includePaths: ["child"], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] },
        { path: "child", label: "child", includePaths: [], nodeNames: [], totalNodeCount: 0, argNames: [], paramFiles: [], parameters: [] }
      ],
      [{ id: "entry->child", source: "entry", target: "child" }],
      null
    );

    const positioned = applyPositionOverrides(launchNodes, { child: { x: 520, y: 240 } });

    expect(positioned.find((node) => node.id === "child")?.position).toEqual({ x: 520, y: 240 });
  });

  it("can pin a clicked launch position before expanding or collapsing branches", () => {
    const pinned = withPositionOverride({ other: { x: 10, y: 20 } }, "entry", { x: 120, y: 80 });

    expect(pinned).toEqual({
      other: { x: 10, y: 20 },
      entry: { x: 120, y: 80 }
    });
  });

  it("classifies selected topics by input and output role", () => {
    const roles = selectedTopicRolesForNode(
      [
        {
          id: "selected",
          name: "selected",
          launchFile: "x",
          inputs: [
            { id: "selected:in", nodeId: "selected", topicName: "/input", dataType: "known", kind: "input" },
            { id: "selected:both_in", nodeId: "selected", topicName: "/both", dataType: "known", kind: "input" }
          ],
          outputs: [
            { id: "selected:out", nodeId: "selected", topicName: "/output", dataType: "known", kind: "output" },
            { id: "selected:both_out", nodeId: "selected", topicName: "/both", dataType: "known", kind: "output" }
          ],
          params: []
        }
      ],
      "selected"
    );

    expect(roles.get("/input")).toBe("input");
    expect(roles.get("/output")).toBe("output");
    expect(roles.get("/both")).toBe("both");
  });

  it("finds directly connected nodes for selected node highlighting", () => {
    const nodes = [
      {
        id: "selected",
        name: "selected",
        launchFile: "x",
        inputs: [],
        outputs: [{ id: "selected:out", nodeId: "selected", topicName: "/shared", dataType: "known", kind: "output" as const }],
        params: []
      },
      { id: "direct", name: "direct", launchFile: "x", inputs: [], outputs: [], params: [] },
      { id: "same_topic", name: "same_topic", launchFile: "x", inputs: [], outputs: [], params: [] }
    ];
    const topics = selectedTopicNamesForNode(nodes, "selected");
    const connected = connectedNodeIdsForSelection(
      [
        { id: "direct_edge", source: "selected", target: "direct", topicName: "/direct", dataType: "known" },
        { id: "topic_edge", source: "other_source", target: "same_topic", topicName: "/shared", dataType: "known" }
      ],
      "selected",
      topics
    );

    expect([...topics]).toEqual(["/shared"]);
    expect([...connected].sort()).toEqual(["direct", "selected"]);
  });

  it("clusters nodes by Autoware domain and expands selected clusters", () => {
    const nodes = [
      {
        id: "camera",
        name: "camera_driver",
        packageName: "autoware_camera",
        launchFile: "x",
        inputs: [],
        outputs: [{ id: "camera:out", nodeId: "camera", topicName: "/image", dataType: "known", kind: "output" as const }],
        params: []
      },
      {
        id: "detector",
        name: "object_detector",
        packageName: "autoware_perception",
        launchFile: "x",
        inputs: [{ id: "detector:in", nodeId: "detector", topicName: "/image", dataType: "known", kind: "input" as const }],
        outputs: [],
        params: []
      },
      {
        id: "planner",
        name: "behavior_path_planner",
        packageName: "autoware_planning",
        launchFile: "x",
        inputs: [],
        outputs: [],
        params: []
      }
    ];
    const edges = buildEdges(nodes);

    expect(classifyNode(nodes[0])).toBe("sensing");
    expect(classifyNode(nodes[1])).toBe("perception");
    expect(classifyNode(nodes[2])).toBe("planning");

    const collapsed = buildClusteredGraph(nodes, edges, new Set());
    expect(collapsed.nodes.map((node) => node.id)).toEqual(["cluster:sensing", "cluster:perception", "cluster:planning"]);
    expect(collapsed.edges[0]).toMatchObject({ source: "cluster:sensing", target: "cluster:perception" });

    const categoryExpanded = buildClusteredGraph(nodes, edges, new Set(["sensing"]));
    expect(categoryExpanded.nodes.map((node) => node.id)).toContain("camera");
    expect(categoryExpanded.nodes.map((node) => node.id)).toContain("cluster:perception");
    expect(categoryExpanded.nodes.map((node) => node.id).some((id) => id.startsWith("package:"))).toBe(false);
  });

  it("prioritizes planning keywords over earlier partial perception matches", () => {
    expect(
      classifyNode({
        id: "diffusion_planner_node",
        name: "diffusion_planner_node",
        packageName: "autoware_diffusion_planner",
        executable: "autoware_diffusion_planner_node",
        launchFile: "/ws/src/autoware_universe/planning/autoware_diffusion_planner/launch/diffusion_planner.launch.xml",
        inputs: [],
        outputs: [],
        params: []
      })
    ).toBe("planning");
  });

  it("groups an expanded category together and keeps every card non-overlapping at measured sizes", () => {
    const nodes = [
      {
        id: "behavior",
        name: "/planning/scenario_planning/behavior_path_planner",
        launchFile: "runtime",
        inputs: [],
        outputs: [{ id: "behavior:out", nodeId: "behavior", topicName: "/cmd", dataType: "known" as const, kind: "output" as const }],
        params: []
      },
      {
        id: "scenario",
        name: "/planning/scenario_planning/scenario_planner",
        launchFile: "runtime",
        inputs: [],
        outputs: [{ id: "scenario:out", nodeId: "scenario", topicName: "/route", dataType: "known" as const, kind: "output" as const }],
        params: []
      },
      {
        id: "mission",
        name: "/planning/mission_planning/mission_planner",
        launchFile: "runtime",
        inputs: [{ id: "mission:in", nodeId: "mission", topicName: "/route", dataType: "known" as const, kind: "input" as const }],
        outputs: [],
        params: []
      },
      {
        id: "controller",
        name: "/control/controller",
        launchFile: "runtime",
        inputs: [{ id: "controller:in", nodeId: "controller", topicName: "/cmd", dataType: "known" as const, kind: "input" as const }],
        outputs: [],
        params: []
      },
      {
        id: "ndt",
        name: "/localization/ndt_scan_matcher",
        launchFile: "runtime",
        inputs: [],
        outputs: [],
        params: []
      }
    ];
    const edges = buildEdges(nodes);
    const expanded = new Set<ClusterId>(["planning"]);
    const clustered = buildClusteredGraph(nodes, edges, expanded);

    // Simulate the real (large, varied) measured card sizes that React Flow reports.
    const sizes = Object.fromEntries(
      clustered.nodes.map((node, index) => [node.id, { width: 300 + (index % 3) * 40, height: 160 + (index % 4) * 60 }])
    );

    const laidOut = layoutGroupedGraph(clustered.nodes, clustered.edges, { nodeSizes: sizes });

    // Planning is expanded into individual cards; other categories stay collapsed.
    const ids = laidOut.map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining(["behavior", "scenario", "mission", "cluster:control", "cluster:localization"]));

    const rectOf = (node: (typeof laidOut)[number]) => {
      const size = sizeForFlowNode(node, sizes);
      return {
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + size.width,
        bottom: node.position.y + size.height
      };
    };
    const overlaps = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    // No two cards overlap at the measured sizes.
    for (let i = 0; i < laidOut.length; i += 1) {
      for (let j = i + 1; j < laidOut.length; j += 1) {
        expect(overlaps(rectOf(laidOut[i]), rectOf(laidOut[j]))).toBe(false);
      }
    }

    // Planning members are grouped: their bounding box contains no other category.
    const planningIds = new Set(["behavior", "scenario", "mission"]);
    const planningRects = laidOut.filter((node) => planningIds.has(node.id)).map(rectOf);
    const planningBox = {
      left: Math.min(...planningRects.map((rect) => rect.left)),
      top: Math.min(...planningRects.map((rect) => rect.top)),
      right: Math.max(...planningRects.map((rect) => rect.right)),
      bottom: Math.max(...planningRects.map((rect) => rect.bottom))
    };
    for (const node of laidOut.filter((node) => !planningIds.has(node.id))) {
      expect(overlaps(rectOf(node), planningBox)).toBe(false);
    }
  });

  it("packs disconnected expanded category members into multiple columns", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `planning_${index}`,
      name: `/planning/disconnected_${index}`,
      launchFile: "runtime",
      inputs: [],
      outputs: [],
      params: []
    }));
    const clustered = buildClusteredGraph(nodes, [], new Set<ClusterId>(["planning"]));
    const sizes = Object.fromEntries(clustered.nodes.map((node) => [node.id, { width: 260, height: 136 }]));
    const laidOut = layoutGroupedGraph(clustered.nodes, clustered.edges, { nodeSizes: sizes });
    const planningRects = laidOut.map((node) => {
      const size = sizeForFlowNode(node, sizes);
      return {
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + size.width,
        bottom: node.position.y + size.height
      };
    });
    const planningBox = {
      left: Math.min(...planningRects.map((rect) => rect.left)),
      top: Math.min(...planningRects.map((rect) => rect.top)),
      right: Math.max(...planningRects.map((rect) => rect.right)),
      bottom: Math.max(...planningRects.map((rect) => rect.bottom))
    };

    expect(planningBox.bottom - planningBox.top).toBeLessThan(920);
    expect(planningBox.right - planningBox.left).toBeGreaterThan(260);
  });

  it("uses a 1.3x layout size for collapsed category nodes before expansion", () => {
    const normalSize = defaultNodeSize(false);
    const categorySize = defaultNodeSize(true);

    expect(categorySize.width).toBe(Math.round(normalSize.width * 1.3));
    expect(categorySize.height).toBe(Math.round(normalSize.height * 1.3));
  });

  it("separates vertically overlapping topic cards in the same column", () => {
    const resolved = resolveTopicNodeCollisions([
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 10, y: 40 }, data: {} },
      { id: "c", position: { x: 600, y: 0 }, data: {} }
    ]);
    const a = resolved.find((node) => node.id === "a")!;
    const b = resolved.find((node) => node.id === "b")!;
    const c = resolved.find((node) => node.id === "c")!;
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(b.position.y).toBeGreaterThanOrEqual(124 + 28);
    expect(c.position).toEqual({ x: 600, y: 0 });
  });

  it("uses measured node heights when separating overlapping cards", () => {
    const resolved = resolveTopicNodeCollisions(
      [
        { id: "a", position: { x: 0, y: 0 }, data: {} },
        { id: "b", position: { x: 0, y: 130 }, data: {} }
      ],
      {
        a: { width: 300, height: 200 },
        b: { width: 300, height: 120 }
      }
    );
    const b = resolved.find((node) => node.id === "b")!;
    expect(b.position.y).toBeGreaterThanOrEqual(228);
  });

  it("moves category collision groups together", () => {
    const resolved = resolveTopicNodeCollisions(
      [
        { id: "control", position: { x: 0, y: 0 }, data: { clusterId: "control" } },
        { id: "planning_a", position: { x: 10, y: 40 }, data: { clusterId: "planning" } },
        { id: "planning_b", position: { x: 10, y: 220 }, data: { clusterId: "planning" } }
      ],
      {
        control: { width: 260, height: 136 },
        planning_a: { width: 260, height: 136 },
        planning_b: { width: 260, height: 136 }
      }
    );
    const planningA = resolved.find((node) => node.id === "planning_a")!;
    const planningB = resolved.find((node) => node.id === "planning_b")!;

    expect(planningA.position.y).toBeGreaterThan(40);
    expect(planningB.position.y - planningA.position.y).toBe(180);
  });

  it("splits category frames instead of spanning over another category", () => {
    const frames = buildCategoryFrameRects({
      expandedClusters: new Set<ClusterId>(["planning"]),
      nodes: [
        { id: "planning_left_a", position: { x: 0, y: 0 }, data: { clusterId: "planning" } },
        { id: "planning_left_b", position: { x: 0, y: 120 }, data: { clusterId: "planning" } },
        { id: "control_middle", position: { x: 130, y: 0 }, data: { clusterId: "control" } },
        { id: "planning_right_a", position: { x: 260, y: 0 }, data: { clusterId: "planning" } },
        { id: "planning_right_b", position: { x: 260, y: 120 }, data: { clusterId: "planning" } }
      ],
      edges: [
        { id: "left", source: "planning_left_a", target: "planning_left_b", topicName: "/left", dataType: "known" },
        { id: "right", source: "planning_right_a", target: "planning_right_b", topicName: "/right", dataType: "known" }
      ],
      nodeSizes: {
        planning_left_a: { width: 100, height: 80 },
        planning_left_b: { width: 100, height: 80 },
        control_middle: { width: 100, height: 80 },
        planning_right_a: { width: 100, height: 80 },
        planning_right_b: { width: 100, height: 80 }
      },
      paddingX: 0,
      paddingTop: 0,
      paddingBottom: 0
    });

    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      const frameRight = frame.x + frame.width;
      expect(frame.x < 230 && frameRight > 130).toBe(false);
    }
  });

  it("does not draw a category frame for a single isolated member", () => {
    const frames = buildCategoryFrameRects({
      expandedClusters: new Set<ClusterId>(["perception"]),
      nodes: [{ id: "perception_only", position: { x: 0, y: 0 }, data: { clusterId: "perception" } }],
      edges: [],
      nodeSizes: {
        perception_only: { width: 100, height: 80 }
      },
      paddingX: 26,
      paddingTop: 34,
      paddingBottom: 22
    });

    expect(frames).toEqual([]);
  });

  it("upserts parameter overrides by node and key", () => {
    const overrides = upsertParamOverride(
      upsertParamOverride([], { nodeName: "/psim", key: "gain", value: "2.0" }),
      { nodeName: "/psim", key: "gain", value: "3.0" }
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].value).toBe("3.0");
  });

  it("upserts topic overrides by node + pin + source topic", () => {
    const overrides = upsertTopicOverride(
      upsertTopicOverride([], { nodeName: "/listener", pinKind: "input", fromTopic: "/old", toTopic: "/new" }),
      { nodeName: "/listener", pinKind: "input", fromTopic: "/old", toTopic: "/new2" }
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].toTopic).toBe("/new2");
  });
});
