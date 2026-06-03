import { describe, expect, it } from "vitest";
import { reconcileRuntimeParameters, type RuntimeDeclaredParam } from "../lib/runtimeParams";
import type { GraphModel, GraphNode, Parameter } from "../lib/graphModel";

function staticParam(nodeName: string, key: string, value: Parameter["value"], sourceFile = "/common.param.yaml"): Parameter {
  return { nodeId: nodeName, nodeName, key, value, sourceFile, dirty: false };
}

function node(name: string, params: Parameter[]): GraphNode {
  return { id: name, name, launchFile: "x.launch.xml", inputs: [], outputs: [], params };
}

function graphOf(nodes: GraphNode[]): GraphModel {
  return { nodes, edges: [], includes: [], launchGraph: { launches: [], edges: [] } };
}

function declared(nodeName: string, names: string[]): RuntimeDeclaredParam[] {
  return names.map((paramName) => ({ nodeName, paramName, value: null, parameterType: "double", readOnly: false }));
}

describe("reconcileRuntimeParameters", () => {
  it("drops a /**-shared static param from a node that does not declare it", () => {
    // common.param.yaml's max_vel is over-attributed to behavior_velocity_planner
    // (loads the file) and velocity_smoother (loads it AND declares max_vel).
    const graph = graphOf([
      node("/bvp", [staticParam("/bvp", "max_vel", 0.28)]),
      node("/vs", [staticParam("/vs", "max_vel", 0.28)])
    ]);
    const runtime = [
      ...declared("/bvp", ["stop_distance", "max_jerk"]), // bvp does NOT declare max_vel
      ...declared("/vs", ["max_vel", "over_v_ratio"]) // vs DOES declare max_vel
    ];
    const out = reconcileRuntimeParameters(graph, runtime);

    const bvp = out.nodes.find((n) => n.name === "/bvp")!;
    const vs = out.nodes.find((n) => n.name === "/vs")!;
    expect(bvp.params.find((p) => p.key === "max_vel")).toBeUndefined();
    expect(vs.params.find((p) => p.key === "max_vel")).toBeDefined();
  });

  it("keeps the static param's yaml value and sourceFile (so save still writes the fork)", () => {
    const graph = graphOf([node("/vs", [staticParam("/vs", "max_vel", 0.28, "/cfg/common.param.yaml")])]);
    const out = reconcileRuntimeParameters(graph, declared("/vs", ["max_vel"]));
    const param = out.nodes[0].params.find((p) => p.key === "max_vel")!;
    expect(param.value).toBe(0.28);
    expect(param.sourceFile).toBe("/cfg/common.param.yaml");
    expect(param.dynamic).toBeFalsy(); // still a static (fork-written) param
  });

  it("does not duplicate a param that is both static and runtime-declared", () => {
    const graph = graphOf([node("/vs", [staticParam("/vs", "max_vel", 0.28)])]);
    const out = reconcileRuntimeParameters(graph, declared("/vs", ["max_vel"]));
    expect(out.nodes[0].params.filter((p) => p.key === "max_vel")).toHaveLength(1);
  });

  it("surfaces runtime-only params (not in any yaml) as dynamic entries", () => {
    const graph = graphOf([node("/vs", [staticParam("/vs", "max_vel", 0.28)])]);
    const out = reconcileRuntimeParameters(graph, declared("/vs", ["max_vel", "live_only_gain"]));
    const live = out.nodes[0].params.find((p) => p.key === "live_only_gain")!;
    expect(live).toBeDefined();
    expect(live.dynamic).toBe(true);
    expect(live.sourceFile).toBe("runtime");
  });

  it("never filters inline <param> entries (sourceFile is the launch XML, not a yaml)", () => {
    // static_gain is declared directly on the node; even if the runtime list does
    // not echo it back, it is unambiguously this node's own parameter.
    const inline = staticParam("/ctrl", "static_gain", 2.0, "/ws/entry.launch.xml");
    const graph = graphOf([node("/ctrl", [inline])]);
    const out = reconcileRuntimeParameters(graph, declared("/ctrl", ["gain"]));
    const keys = out.nodes[0].params.map((p) => p.key);
    expect(keys).toContain("static_gain"); // inline kept
    expect(keys).toContain("gain"); // runtime-only added
  });

  it("leaves static params untouched for nodes with no runtime data (avoids hiding when unsure)", () => {
    const graph = graphOf([node("/not_scanned", [staticParam("/not_scanned", "max_vel", 0.28)])]);
    const out = reconcileRuntimeParameters(graph, declared("/other", ["x"]));
    expect(out.nodes[0].params.find((p) => p.key === "max_vel")).toBeDefined();
  });

  it("enriches a kept static param's type from the runtime declaration", () => {
    const graph = graphOf([node("/vs", [staticParam("/vs", "max_vel", 0.28)])]);
    const runtime: RuntimeDeclaredParam[] = [
      { nodeName: "/vs", paramName: "max_vel", value: null, parameterType: "double", readOnly: false }
    ];
    const out = reconcileRuntimeParameters(graph, runtime);
    expect(out.nodes[0].params.find((p) => p.key === "max_vel")!.parameterType).toBe("double");
  });

  it("replaces stale dynamic params from a previous sync", () => {
    const stale: Parameter = {
      nodeId: "/vs",
      nodeName: "/vs",
      key: "old_live",
      value: 1,
      sourceFile: "runtime",
      dirty: false,
      dynamic: true
    };
    const graph = graphOf([node("/vs", [staticParam("/vs", "max_vel", 0.28), stale])]);
    const out = reconcileRuntimeParameters(graph, declared("/vs", ["max_vel"]));
    expect(out.nodes[0].params.find((p) => p.key === "old_live")).toBeUndefined();
  });
});
