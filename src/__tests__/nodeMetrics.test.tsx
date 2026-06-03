import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ComponentType } from "react";
import { AutowareNode } from "../components/AutowareNode";
import { buildClusteredGraph } from "../lib/clusters";
import { layoutGraph, type FlowNodeData } from "../lib/graphLayout";
import type { GraphNode } from "../lib/graphModel";

const node = (overrides: Partial<GraphNode>): GraphNode => ({
  id: "node",
  name: "/planning/node",
  launchFile: "runtime",
  inputs: [],
  outputs: [],
  params: [],
  ...overrides
});

describe("node metric counters", () => {
  it("renders swap, static parameter, and dynamic parameter counts without hover", () => {
    const MetricNode = AutowareNode as unknown as ComponentType<{ data: FlowNodeData; selected: boolean }>;
    render(
      <ReactFlowProvider>
        <MetricNode
          selected={false}
          data={{
            label: "/planning/node",
            inOut: "1 in / 2 out",
            connected: true,
            dirty: false,
            swappable: true,
            staticParamCount: 2,
            dynamicParamCount: 3
          }}
        />
      </ReactFlowProvider>
    );

    const metrics = screen.getByLabelText("node metrics: 1 swaps, 2 static parameters, 3 dynamic parameters");
    expect(within(metrics).getByText("SW")).toBeInTheDocument();
    expect(within(metrics).getByText("P")).toBeInTheDocument();
    expect(within(metrics).getByText("D")).toBeInTheDocument();
    expect(within(metrics).getByText("1")).toBeInTheDocument();
    expect(within(metrics).getByText("2")).toBeInTheDocument();
    expect(within(metrics).getByText("3")).toBeInTheDocument();
  });

  it("exposes swap, static parameter, and dynamic parameter counts on node cards", () => {
    const [flowNode] = layoutGraph([
      node({
        swappable: true,
        params: [
          { nodeId: "node", nodeName: "/planning/node", key: "static_gain", value: 1, sourceFile: "x", dirty: false },
          {
            nodeId: "node",
            nodeName: "/planning/node",
            key: "dynamic_gain",
            value: 2,
            sourceFile: "runtime",
            dirty: false,
            dynamic: true
          }
        ]
      })
    ], []);

    expect(flowNode.data as FlowNodeData).toMatchObject({
      swappable: true,
      staticParamCount: 1,
      dynamicParamCount: 1
    });
  });

  it("rolls metric counts up onto collapsed cluster cards", () => {
    const clustered = buildClusteredGraph(
      [
        node({
          id: "planner_a",
          name: "/planning/a",
          swappable: true,
          params: [{ nodeId: "planner_a", nodeName: "/planning/a", key: "gain", value: 1, sourceFile: "x", dirty: false }]
        }),
        node({
          id: "planner_b",
          name: "/planning/b",
          params: [
            {
              nodeId: "planner_b",
              nodeName: "/planning/b",
              key: "dynamic_gain",
              value: 2,
              sourceFile: "runtime",
              dirty: false,
              dynamic: true
            }
          ]
        })
      ],
      [],
      new Set()
    );
    const [cluster] = layoutGraph(clustered.nodes, clustered.edges);

    expect(cluster.data as FlowNodeData).toMatchObject({
      swappableCount: 1,
      staticParamCount: 1,
      dynamicParamCount: 1
    });
  });
});
