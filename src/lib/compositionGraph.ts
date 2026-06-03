import { buildEdges, isHiddenTopic } from "./parser";
import { isCompositionDirty, type AddedNodeSpec, type Composition } from "./composition";
import type { GraphModel, GraphNode, LaunchFileNode, LaunchGraphModel, LaunchStatus, Pin } from "./graphModel";

export function effectiveDisabledNodeNames(disabledNodeIds: string[]): Set<string> {
  return new Set(disabledNodeIds);
}

function nodeDisabled(node: GraphNode, disabled: Set<string>): boolean {
  return disabled.has(node.id) || disabled.has(node.name);
}

function disabledLaunchNodeNames(graph: GraphModel, disabled: Set<string>): Set<string> {
  const names = new Set(disabled);
  for (const node of graph.nodes) {
    if (!nodeDisabled(node, disabled)) continue;
    names.add(node.name);
    names.add(node.id);
  }
  return names;
}

function isSwappable(node: GraphNode, switchNames: Set<string>): boolean {
  return (node.gatedBy ?? []).some((name) => switchNames.has(name));
}

export function markSwappableNodes(graph: GraphModel, switchNames: Set<string>): GraphModel {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      swappable: isSwappable(node, switchNames)
    }))
  };
}

function pinsForAddedNode(spec: AddedNodeSpec): { inputs: Pin[]; outputs: Pin[] } {
  const inputs: Pin[] = [];
  const outputs: Pin[] = [];
  for (const remap of spec.remaps ?? []) {
    if (isHiddenTopic(remap.to)) continue;
    const kind = remap.from.includes("output") || remap.from.includes("pub") ? "output" : "input";
    const pin: Pin = {
      id: `${spec.name}:${kind}:${remap.to}`,
      nodeId: spec.name,
      topicName: remap.to,
      dataType: "unknown",
      kind
    };
    if (kind === "output") outputs.push(pin);
    else inputs.push(pin);
  }
  return { inputs, outputs };
}

function addedNodeToGraphNode(spec: AddedNodeSpec, launchFile: string): GraphNode {
  const { inputs, outputs } = pinsForAddedNode(spec);
  return {
    id: spec.name,
    name: spec.name,
    packageName: spec.packageName,
    executable: spec.executable,
    launchFile,
    inputs,
    outputs,
    params: [],
    isAdded: true
  };
}

export function applyCompositionToTopicGraph(
  graph: GraphModel,
  composition: Composition,
  switchNames: Set<string>,
  entryLaunch: string
): GraphModel {
  const disabled = effectiveDisabledNodeNames(composition.disabledNodeIds);
  const existing = graph.nodes.map((node) => ({
    ...node,
    disabled: nodeDisabled(node, disabled),
    swappable: isSwappable(node, switchNames)
  }));
  const added = composition.addedNodes.map((spec) => addedNodeToGraphNode(spec, entryLaunch));
  const nodes = [...existing, ...added];
  return { ...graph, nodes, edges: buildEdges(nodes) };
}

function statusForLaunch(
  launch: LaunchFileNode,
  disabled: Set<string>,
  entryLaunch: string,
  hasArgOverrides: boolean
): LaunchStatus {
  const launchedNodes = launch.nodeNames;
  if (launchedNodes.length > 0 && launchedNodes.every((name) => disabled.has(name))) return "ghost";
  if (launchedNodes.some((name) => disabled.has(name))) return "overridden";
  if (launch.path === entryLaunch && hasArgOverrides) return "overridden";
  return "original";
}

export function decorateLaunchGraphStatus(
  graph: GraphModel,
  composition: Composition,
  entryLaunch: string
): LaunchGraphModel {
  const base = graph.launchGraph;
  if (!isCompositionDirty(composition)) {
    return {
      launches: base.launches.map((launch) => ({ ...launch, status: "original" as LaunchStatus })),
      edges: base.edges
    };
  }
  const disabled = disabledLaunchNodeNames(graph, effectiveDisabledNodeNames(composition.disabledNodeIds));
  const hasArgOverrides = Object.keys(composition.argOverrides).length > 0;
  const launches: LaunchFileNode[] = base.launches.map((launch) => ({
    ...launch,
    status: statusForLaunch(launch, disabled, entryLaunch, hasArgOverrides)
  }));
  return { launches, edges: base.edges };
}
