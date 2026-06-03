import { describe, expect, it } from "vitest";
import {
  addComposedNode,
  composedLaunchArgs,
  emptyComposition,
  isCompositionDirty,
  setArgOverride,
  setNodeDisabled
} from "../lib/composition";
import {
  applyCompositionToTopicGraph,
  decorateLaunchGraphStatus,
  effectiveDisabledNodeNames,
  markSwappableNodes
} from "../lib/compositionGraph";
import { buildClusteredGraph } from "../lib/clusters";
import type { GraphModel } from "../lib/graphModel";

function sampleGraph(): GraphModel {
  return {
    nodes: [
      {
        id: "ndt_scan_matcher",
        name: "ndt_scan_matcher",
        launchFile: "/L/ndt.launch.xml",
        inputs: [],
        outputs: [{ id: "ndt:out", nodeId: "ndt_scan_matcher", topicName: "/pose", dataType: "known", kind: "output" }],
        params: [],
        gatedBy: ["pose_source"]
      },
      {
        id: "listener",
        name: "listener",
        launchFile: "/L/entry.launch.xml",
        inputs: [{ id: "listener:in", nodeId: "listener", topicName: "/pose", dataType: "known", kind: "input" }],
        outputs: [],
        params: []
      }
    ],
    edges: [],
    includes: [],
    launchGraph: {
      launches: [
        {
          path: "/L/entry.launch.xml",
          label: "entry.launch.xml",
          includePaths: ["/L/ndt.launch.xml"],
          nodeNames: ["listener"],
          totalNodeCount: 2,
          argNames: ["pose_source"],
          paramFiles: [],
          parameters: []
        },
        {
          path: "/L/ndt.launch.xml",
          label: "ndt.launch.xml",
          includePaths: [],
          nodeNames: ["ndt_scan_matcher"],
          totalNodeCount: 1,
          argNames: [],
          paramFiles: [],
          parameters: []
        }
      ],
      edges: [{ id: "/L/entry.launch.xml->/L/ndt.launch.xml", source: "/L/entry.launch.xml", target: "/L/ndt.launch.xml" }]
    }
  };
}

const ENTRY = "/L/entry.launch.xml";
const switchNames = new Set(["pose_source"]);

describe("composition reflected onto the graphs", () => {
  it("collects explicitly disabled node names", () => {
    const disabled = effectiveDisabledNodeNames(["listener"]);
    expect(disabled.has("listener")).toBe(true);
    expect(disabled.has("ndt_scan_matcher")).toBe(false);
  });

  it("flags disabled and added nodes on the topic graph", () => {
    const composition = addComposedNode(setNodeDisabled(emptyComposition(), "ndt_scan_matcher", true), {
      name: "extra_node",
      packageName: "demo_pkg",
      executable: "talker"
    });
    const edited = applyCompositionToTopicGraph(sampleGraph(), composition, switchNames, ENTRY);
    expect(edited.nodes.find((node) => node.id === "ndt_scan_matcher")?.disabled).toBe(true);
    expect(edited.nodes.find((node) => node.id === "listener")?.disabled).toBe(false);
    const added = edited.nodes.find((node) => node.id === "extra_node");
    expect(added?.isAdded).toBe(true);
    expect(added?.launchFile).toBe(ENTRY);
  });

  it("decorates the launch graph with ghost/overridden statuses when composition is dirty", () => {
    const composition = setArgOverride(setNodeDisabled(emptyComposition(), "ndt_scan_matcher", true), "pose_source", "yabloc");
    const launchGraph = decorateLaunchGraphStatus(sampleGraph(), composition, ENTRY);
    const ndt = launchGraph.launches.find((launch) => launch.path === "/L/ndt.launch.xml");
    const entry = launchGraph.launches.find((launch) => launch.path === ENTRY);
    expect(ndt?.status).toBe("ghost");
    expect(entry?.status).toBe("overridden");
  });

  it("marks nodes gated by a discovered switch as swappable", () => {
    const edited = applyCompositionToTopicGraph(sampleGraph(), emptyComposition(), switchNames, ENTRY);
    expect(edited.nodes.find((node) => node.id === "ndt_scan_matcher")?.swappable).toBe(true);
    expect(edited.nodes.find((node) => node.id === "listener")?.swappable).toBe(false);
  });

  it("marks swappable nodes even outside edit mode", () => {
    const graph = markSwappableNodes(sampleGraph(), switchNames);
    expect(graph.nodes.find((node) => node.id === "ndt_scan_matcher")?.swappable).toBe(true);
    expect(graph.nodes.find((node) => node.id === "listener")?.swappable).toBe(false);
  });

  it("rolls up the swappable node count onto collapsed cluster cards", () => {
    const nodes = [
      {
        id: "ndt_scan_matcher",
        name: "ndt_scan_matcher",
        packageName: "autoware_ndt_scan_matcher",
        launchFile: "x",
        inputs: [],
        outputs: [],
        params: [],
        swappable: true
      },
      {
        id: "ekf_localizer",
        name: "ekf_localizer",
        packageName: "autoware_ekf_localizer",
        launchFile: "x",
        inputs: [],
        outputs: [],
        params: [],
        swappable: false
      }
    ];

    const collapsed = buildClusteredGraph(nodes, [], new Set());
    const cluster = collapsed.nodes.find((node) => node.id === "cluster:localization");
    expect((cluster as { swappableCount?: number }).swappableCount).toBe(1);

    const expanded = buildClusteredGraph(nodes, [], new Set(["localization"]));
    expect(expanded.nodes.map((node) => node.id)).toEqual(["ekf_localizer", "ndt_scan_matcher"]);
    expect(expanded.nodes.some((node) => node.id.startsWith("package:"))).toBe(false);
  });

  it("leaves the launch graph statuses untouched when the composition is clean", () => {
    const launchGraph = decorateLaunchGraphStatus(sampleGraph(), emptyComposition(), ENTRY);
    expect(launchGraph.launches.every((launch) => launch.status === "original")).toBe(true);
  });
});

describe("composition changeset", () => {
  it("starts clean and becomes dirty after any edit", () => {
    const empty = emptyComposition();
    expect(isCompositionDirty(empty)).toBe(false);
    expect(isCompositionDirty(setArgOverride(empty, "pose_source", "yabloc"))).toBe(true);
    expect(isCompositionDirty(setNodeDisabled(empty, "listener", true))).toBe(true);
    expect(
      isCompositionDirty(addComposedNode(empty, { name: "extra", packageName: "demo_pkg", executable: "talker" }))
    ).toBe(true);
  });

  it("toggles a node disabled and back to enabled", () => {
    const disabled = setNodeDisabled(emptyComposition(), "listener", true);
    expect(disabled.disabledNodeIds).toEqual(["listener"]);
    const enabled = setNodeDisabled(disabled, "listener", false);
    expect(enabled.disabledNodeIds).toEqual([]);
  });

  it("upserts added nodes by name", () => {
    const once = addComposedNode(emptyComposition(), { name: "extra", packageName: "demo_pkg", executable: "talker" });
    const twice = addComposedNode(once, { name: "extra", packageName: "demo_pkg", executable: "listener" });
    expect(twice.addedNodes).toHaveLength(1);
    expect(twice.addedNodes[0].executable).toBe("listener");
  });

  it("merges base launch args with composition overrides", () => {
    const composition = setArgOverride(emptyComposition(), "pose_source", "yabloc");
    expect(
      composedLaunchArgs({ vehicle_model: "palta", pose_source: "ndt" }, composition)
    ).toEqual({ vehicle_model: "palta", pose_source: "yabloc" });
  });
});
