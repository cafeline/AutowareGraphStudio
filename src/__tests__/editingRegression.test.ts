import { beforeEach, describe, expect, it } from "vitest";
import { setNodeDisabled } from "../lib/composition";
import { applyCompositionToTopicGraph, decorateLaunchGraphStatus } from "../lib/compositionGraph";
import type { GraphModel } from "../lib/graphModel";
import { buildEdges } from "../lib/parser";
import { useGraphStore } from "../stores/graphStore";

const ENTRY = "/ws/src/demo_pkg/launch/entry.launch.xml";

function topicGraph(): GraphModel {
  const nodes: GraphModel["nodes"] = [
    {
      id: "talker",
      name: "talker",
      launchFile: ENTRY,
      inputs: [],
      outputs: [{ id: "talker:output:/pose", nodeId: "talker", topicName: "/pose", dataType: "Pose", kind: "output" }],
      params: []
    },
    {
      id: "listener",
      name: "listener",
      launchFile: ENTRY,
      inputs: [{ id: "listener:input:/pose", nodeId: "listener", topicName: "/pose", dataType: "Pose", kind: "input" }],
      outputs: [],
      params: []
    }
  ];
  return {
    nodes,
    edges: buildEdges(nodes),
    includes: [],
    launchGraph: { launches: [], edges: [] }
  };
}

function namespacedGraph(): GraphModel {
  return {
    nodes: [
      {
        id: "/vehicle/controller",
        name: "controller",
        launchFile: ENTRY,
        inputs: [],
        outputs: [],
        params: []
      }
    ],
    edges: [],
    includes: [],
    launchGraph: {
      launches: [
        {
          path: ENTRY,
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
  };
}

beforeEach(() => {
  useGraphStore.setState({
    sourceRoot: "/ws/src",
    entryLaunch: ENTRY,
    graphSource: "static",
    graph: topicGraph(),
    pendingTopicOverrides: []
  });
});

describe("editing regression coverage", () => {
  it("recomputes graph edges immediately after a topic remap edit", () => {
    expect(useGraphStore.getState().graph.edges).toHaveLength(1);

    useGraphStore.getState().updateTopicName("listener", "listener:input:/pose", "/pose_remapped");

    expect(useGraphStore.getState().graph.nodes.find((node) => node.id === "listener")?.inputs[0].topicName).toBe(
      "/pose_remapped"
    );
    expect(useGraphStore.getState().graph.edges).toHaveLength(0);

    useGraphStore.getState().updateTopicName("talker", "talker:output:/pose", "/pose_remapped");

    expect(useGraphStore.getState().graph.edges).toEqual([
      expect.objectContaining({ source: "talker", target: "listener", topicName: "/pose_remapped" })
    ]);
  });

  it("marks namespaced nodes disabled when the stored disabled id is the runtime node id", () => {
    const graph = namespacedGraph();
    const composition = setNodeDisabled({ argOverrides: {}, disabledNodeIds: [], addedNodes: [] }, "/vehicle/controller", true);

    const topic = applyCompositionToTopicGraph(graph, composition, new Set(), ENTRY);
    const launch = decorateLaunchGraphStatus(graph, composition, ENTRY);

    expect(topic.nodes[0].disabled).toBe(true);
    expect(launch.launches[0].status).toBe("ghost");
  });
});
