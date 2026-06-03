import type { GraphEdge, GraphModel, GraphNode } from "./graphModel";

export function isUnusedNode(node: GraphNode): boolean {
  return node.inputs.length === 0 && node.outputs.length === 0;
}

export function visibleNodes(graph: GraphModel, showUnusedNodes: boolean): GraphNode[] {
  if (showUnusedNodes) return graph.nodes;
  return graph.nodes.filter((node) => !isUnusedNode(node));
}

export function visibleEdges(graph: GraphModel, nodes: GraphNode[]): GraphEdge[] {
  const visibleIds = new Set(nodes.map((node) => node.id));
  return graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
}

export function edgeClass(edge: GraphEdge, selectedNodeId: string | null): "active" | "inactive" | "unknown" {
  if (selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)) return "active";
  if (edge.dataType === "unknown") return "unknown";
  return "inactive";
}
