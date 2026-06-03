import dagre from "dagre";
import type { Node } from "@xyflow/react";
import { classifyNode, clusterColor, isClusterNode } from "./clusters";
import type { GraphEdge, GraphNode } from "./graphModel";
import { defaultNodeSize, sizeForNodeId, type NodeSize, type NodeSizeMap } from "./nodeSizes";

export type FlowNodeData = {
  label: string;
  inOut: string;
  dirty: boolean;
  isCluster?: boolean;
  clusterId?: string;
  clusterColor?: string;
  memberCount?: number;
  connected?: boolean;
  disabled?: boolean;
  isAdded?: boolean;
  swappable?: boolean;
  swappableCount?: number;
  staticParamCount?: number;
  dynamicParamCount?: number;
};

export type LayoutOptions = {
  compact?: boolean;
  nodeSizes?: NodeSizeMap;
};

export function graphTopologyKey(nodes: GraphNode[], edges: GraphEdge[], options: LayoutOptions = {}) {
  const nodePart = nodes.map((node) => node.id).join("|");
  const edgePart = edges.map((edge) => `${edge.source}>${edge.target}`).join("|");
  const sizePart = nodes
    .map((node) => {
      const measured = options.nodeSizes?.[node.id];
      return measured ? `${node.id}:${Math.ceil(measured.width)}x${Math.ceil(measured.height)}` : "";
    })
    .filter(Boolean)
    .join("|");
  return `${options.compact ? "compact" : "normal"}::${nodePart}::${edgePart}::${sizePart}`;
}

const layoutCache = new Map<string, Map<string, { x: number; y: number }>>();
const groupedLayoutCache = new Map<string, Map<string, { x: number; y: number }>>();

export function clearLayoutCache() {
  layoutCache.clear();
  groupedLayoutCache.clear();
}

function graphNodeSize(node: GraphNode, measuredSizes?: NodeSizeMap): NodeSize {
  const isAggregate = isClusterNode(node);
  return sizeForNodeId(node.id, measuredSizes, defaultNodeSize(isAggregate));
}

function buildLayout(nodes: GraphNode[], edges: GraphEdge[], options: LayoutOptions) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: options.compact ? 82 : 140,
    nodesep: options.compact ? 24 : 52
  });

  for (const node of nodes) {
    graph.setNode(node.id, graphNodeSize(node, options.nodeSizes));
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const position = graph.node(node.id);
    const size = graphNodeSize(node, options.nodeSizes);
    positions.set(node.id, {
      x: position.x - size.width / 2,
      y: position.y - size.height / 2
    });
  }
  return positions;
}

function toFlowNode(node: GraphNode, position: { x: number; y: number }): Node {
  const isAggregate = isClusterNode(node);
  const clusterId = isAggregate ? node.clusterId : classifyNode(node);
  const dynamicParamCount = isAggregate ? node.dynamicParamCount ?? 0 : node.params.filter((param) => param.dynamic).length;
  const staticParamCount = isAggregate ? node.staticParamCount ?? 0 : node.params.filter((param) => !param.dynamic).length;
  return {
    id: node.id,
    type: "autowareNode",
    position,
    zIndex: 2,
    data: {
      label: node.name,
      inOut: `${node.inputs.length} in / ${node.outputs.length} out`,
      dirty: node.params.some((param) => param.dirty),
      isCluster: isClusterNode(node),
      clusterId,
      clusterColor: clusterColor(clusterId),
      memberCount: isAggregate ? node.memberIds.length : undefined,
      disabled: isAggregate ? undefined : node.disabled,
      isAdded: isAggregate ? undefined : node.isAdded,
      swappable: isAggregate ? undefined : node.swappable,
      swappableCount: isAggregate ? node.swappableCount : undefined,
      staticParamCount,
      dynamicParamCount
    } satisfies FlowNodeData
  };
}

export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], options: LayoutOptions = {}): Node[] {
  const key = graphTopologyKey(nodes, edges, options);
  let positions = layoutCache.get(key);
  if (!positions) {
    positions = buildLayout(nodes, edges, options);
    layoutCache.set(key, positions);
  }

  return nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    return toFlowNode(node, position);
  });
}

// === Grouped (block) layout ============================================
// Two-level dagre so categories stay visually clustered AND never overlap:
//   1. Lay out each category's members internally (tight spacing) → a block box.
//   2. Lay out the blocks against each other (loose spacing) using the edges
//      that cross category boundaries.
// A collapsed category is simply a one-node block, so this generalises the plain
// layout: when nothing is expanded the result matches layoutGraph.

type Separation = { ranksep: number; nodesep: number };
const memberSeparation: Separation = { ranksep: 70, nodesep: 30 };
const blockSeparation: Separation = { ranksep: 150, nodesep: 90 };
const blockBoundaryPaddingX = 72;
const blockBoundaryPaddingY = 72;
const componentPackGapX = 92;
const componentPackGapY = 32;

function blockIdOf(node: GraphNode): string {
  return isClusterNode(node) ? node.clusterId : classifyNode(node);
}

// Lay out a set of ids with dagre and return positions normalised to (0, 0)
// plus the bounding-box size of the result.
function dagreBlock(
  ids: string[],
  links: Array<{ source: string; target: string }>,
  sizeOf: (id: string) => NodeSize,
  separation: Separation
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  if (ids.length === 0) return { positions: new Map(), width: 0, height: 0 };

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: separation.ranksep, nodesep: separation.nodesep });

  const idSet = new Set(ids);
  for (const id of ids) graph.setNode(id, sizeOf(id));
  for (const link of links) {
    if (idSet.has(link.source) && idSet.has(link.target)) graph.setEdge(link.source, link.target);
  }
  dagre.layout(graph);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const raw = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const point = graph.node(id);
    const size = sizeOf(id);
    const x = point.x - size.width / 2;
    const y = point.y - size.height / 2;
    raw.set(id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, point] of raw) positions.set(id, { x: point.x - minX, y: point.y - minY });
  return { positions, width: maxX - minX, height: maxY - minY };
}

function weakComponents(ids: string[], links: Array<{ source: string; target: string }>): string[][] {
  const idSet = new Set(ids);
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const link of links) {
    if (!idSet.has(link.source) || !idSet.has(link.target)) continue;
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const stack = [id];
    visited.add(id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function componentEdgeCount(componentIds: string[], links: Array<{ source: string; target: string }>): number {
  const ids = new Set(componentIds);
  return links.filter((link) => ids.has(link.source) && ids.has(link.target)).length;
}

function packedDagreBlock(
  ids: string[],
  links: Array<{ source: string; target: string }>,
  sizeOf: (id: string) => NodeSize,
  separation: Separation
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const components = weakComponents(ids, links);
  if (components.length <= 1) return dagreBlock(ids, links, sizeOf, separation);

  const order = new Map(ids.map((id, index) => [id, index]));
  const componentLayouts = components
    .map((component) => {
      const layout = dagreBlock(component, links, sizeOf, separation);
      return {
        ids: component,
        ...layout,
        firstIndex: Math.min(...component.map((id) => order.get(id) ?? 0)),
        edgeCount: componentEdgeCount(component, links)
      };
    })
    .sort((a, b) => {
      const aLinked = a.edgeCount > 0 ? 1 : 0;
      const bLinked = b.edgeCount > 0 ? 1 : 0;
      return bLinked - aLinked || a.firstIndex - b.firstIndex;
    });

  const totalArea = componentLayouts.reduce((sum, component) => sum + component.width * component.height, 0);
  const targetColumnHeight = Math.max(560, Math.min(920, Math.sqrt(totalArea) * 1.25));
  const columns: Array<{ components: typeof componentLayouts; width: number; height: number }> = [];
  let currentColumn: { components: typeof componentLayouts; width: number; height: number } | null = null;

  for (const component of componentLayouts) {
    const nextHeight = currentColumn
      ? currentColumn.height + componentPackGapY + component.height
      : component.height;
    if (currentColumn && currentColumn.components.length > 0 && nextHeight > targetColumnHeight) {
      columns.push(currentColumn);
      currentColumn = null;
    }
    currentColumn ??= { components: [], width: 0, height: 0 };
    const yGap = currentColumn.components.length === 0 ? 0 : componentPackGapY;
    currentColumn.components.push(component);
    currentColumn.width = Math.max(currentColumn.width, component.width);
    currentColumn.height += yGap + component.height;
  }
  if (currentColumn) columns.push(currentColumn);

  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  let height = 0;
  for (const column of columns) {
    let y = 0;
    for (const component of column.components) {
      const centeredX = x + (column.width - component.width) / 2;
      for (const [id, point] of component.positions) {
        positions.set(id, { x: centeredX + point.x, y: y + point.y });
      }
      y += component.height + componentPackGapY;
    }
    height = Math.max(height, column.height);
    x += column.width + componentPackGapX;
  }
  const width = columns.reduce((sum, column, index) => sum + column.width + (index === 0 ? 0 : componentPackGapX), 0);
  return { positions, width, height };
}

function buildGroupedLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeSizes?: NodeSizeMap
): Map<string, { x: number; y: number }> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const memberSizeOf = (id: string) => graphNodeSize(nodeById.get(id)!, nodeSizes);
  const links = edges.map((edge) => ({ source: edge.source, target: edge.target }));

  // Group visible nodes by category block.
  const blocks = new Map<string, string[]>();
  for (const node of nodes) {
    const block = blockIdOf(node);
    blocks.set(block, [...(blocks.get(block) ?? []), node.id]);
  }

  // 1. Internal layout of each block (members + intra-category edges).
  const blockLayouts = new Map<string, { rel: Map<string, { x: number; y: number }>; width: number; height: number }>();
  for (const [block, memberIds] of blocks) {
    const { positions, width, height } = packedDagreBlock(memberIds, links, memberSizeOf, memberSeparation);
    blockLayouts.set(block, { rel: positions, width, height });
  }

  // 2. Layout of the blocks against each other (inter-category edges only).
  const blockOf = new Map(nodes.map((node) => [node.id, blockIdOf(node)]));
  const seenSuperLink = new Set<string>();
  const superLinks: Array<{ source: string; target: string }> = [];
  for (const edge of edges) {
    const source = blockOf.get(edge.source);
    const target = blockOf.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}>${target}`;
    if (seenSuperLink.has(key)) continue;
    seenSuperLink.add(key);
    superLinks.push({ source, target });
  }
  const blockSizeOf = (id: string) => {
    const layout = blockLayouts.get(id);
    return layout
      ? {
          width: layout.width + blockBoundaryPaddingX * 2,
          height: layout.height + blockBoundaryPaddingY * 2
        }
      : defaultNodeSize();
  };
  const { positions: blockTopLeft } = dagreBlock([...blockLayouts.keys()], superLinks, blockSizeOf, blockSeparation);

  // Compose: block origin + member offset within the block.
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const block = blockIdOf(node);
    const origin = blockTopLeft.get(block) ?? { x: 0, y: 0 };
    const offset = blockLayouts.get(block)?.rel.get(node.id) ?? { x: 0, y: 0 };
    positions.set(node.id, {
      x: origin.x + blockBoundaryPaddingX + offset.x,
      y: origin.y + blockBoundaryPaddingY + offset.y
    });
  }
  return positions;
}

export function layoutGroupedGraph(nodes: GraphNode[], edges: GraphEdge[], options: LayoutOptions = {}): Node[] {
  const key = `grouped::${graphTopologyKey(nodes, edges, options)}`;
  let positions = groupedLayoutCache.get(key);
  if (!positions) {
    positions = buildGroupedLayout(nodes, edges, options.nodeSizes);
    groupedLayoutCache.set(key, positions);
  }

  return nodes.map((node) => toFlowNode(node, positions.get(node.id) ?? { x: 0, y: 0 }));
}
