import type { GraphEdge, GraphNode } from "./graphModel";

export type SelectedTopicRole = "input" | "output" | "both";

export function selectedTopicNamesForNode(nodes: GraphNode[], selectedNodeId: string | null): Set<string> {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  return new Set([...(selectedNode?.inputs ?? []), ...(selectedNode?.outputs ?? [])].map((pin) => pin.topicName));
}

export function selectedTopicRolesForNode(nodes: GraphNode[], selectedNodeId: string | null): Map<string, SelectedTopicRole> {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const roles = new Map<string, SelectedTopicRole>();
  for (const pin of selectedNode?.inputs ?? []) roles.set(pin.topicName, "input");
  for (const pin of selectedNode?.outputs ?? []) {
    roles.set(pin.topicName, roles.get(pin.topicName) === "input" ? "both" : "output");
  }
  return roles;
}

export function connectedNodeIdsForSelection(
  edges: GraphEdge[],
  selectedNodeId: string | null,
  _selectedTopicNames: Set<string>
): Set<string> {
  const connected = new Set<string>();
  if (selectedNodeId) connected.add(selectedNodeId);

  for (const edge of edges) {
    const isDirect = Boolean(selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId));
    if (!isDirect) continue;
    connected.add(edge.source);
    connected.add(edge.target);
  }

  return connected;
}
