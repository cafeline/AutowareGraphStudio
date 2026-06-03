import type { Node } from "@xyflow/react";
import { clusterColor, clusterLabel, type ClusterId } from "./clusters";
import type { GraphEdge } from "./graphModel";
import { sizeForFlowNode, type NodeSizeMap } from "./nodeSizes";

export type CategoryFrameRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
  memberCount: number;
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  memberIds: string[];
};

type BuildCategoryFrameRectsOptions = {
  expandedClusters: Set<ClusterId>;
  nodes: Node[];
  edges: GraphEdge[];
  nodeSizes?: NodeSizeMap;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
};

const maxMergeGapX = 220;
const maxMergeGapY = 90;
const minFrameMemberCount = 2;

function nodeData(node: Node): { clusterId?: ClusterId; isCluster?: boolean } {
  return node.data as { clusterId?: ClusterId; isCluster?: boolean };
}

function nodeRect(node: Node, nodeSizes?: NodeSizeMap): Rect {
  const size = sizeForFlowNode(node, nodeSizes);
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + size.width,
    bottom: node.position.y + size.height,
    memberIds: [node.id]
  };
}

function boundsFor(nodes: Node[], nodeSizes?: NodeSizeMap): Rect {
  const rects = nodes.map((node) => nodeRect(node, nodeSizes));
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
    memberIds: nodes.map((node) => node.id)
  };
}

function padded(rect: Rect, paddingX: number, paddingTop: number, paddingBottom: number): Rect {
  return {
    left: rect.left - paddingX,
    top: rect.top - paddingTop,
    right: rect.right + paddingX,
    bottom: rect.bottom + paddingBottom,
    memberIds: rect.memberIds
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function unionRect(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    memberIds: [...a.memberIds, ...b.memberIds]
  };
}

function rectGap(a: Rect, b: Rect) {
  const x = Math.max(0, Math.max(b.left - a.right, a.left - b.right));
  const y = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom));
  return { x, y };
}

function memberComponents(members: Node[], edges: GraphEdge[]): Node[][] {
  const memberById = new Map(members.map((node) => [node.id, node]));
  const adjacency = new Map(members.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!memberById.has(edge.source) || !memberById.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visited = new Set<string>();
  const components: Node[][] = [];
  for (const member of members) {
    if (visited.has(member.id)) continue;
    const component: Node[] = [];
    const stack = [member.id];
    visited.add(member.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = memberById.get(id);
      if (node) component.push(node);
      for (const next of adjacency.get(id) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function mergeFrameRects(
  rects: Rect[],
  foreignRects: Rect[],
  paddingX: number,
  paddingTop: number,
  paddingBottom: number
): Rect[] {
  const merged = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const gap = rectGap(merged[i], merged[j]);
        if (gap.x > maxMergeGapX || gap.y > maxMergeGapY) continue;
        const next = unionRect(merged[i], merged[j]);
        const nextPadded = padded(next, paddingX, paddingTop, paddingBottom);
        if (foreignRects.some((foreign) => intersects(nextPadded, foreign))) continue;
        merged.splice(j, 1);
        merged[i] = next;
        changed = true;
        break outer;
      }
    }
  }
  return merged;
}

export function buildCategoryFrameRects({
  expandedClusters,
  nodes,
  edges,
  nodeSizes,
  paddingX,
  paddingTop,
  paddingBottom
}: BuildCategoryFrameRectsOptions): CategoryFrameRect[] {
  if (expandedClusters.size === 0) return [];
  const frames: CategoryFrameRect[] = [];
  const rectByNodeId = new Map(nodes.map((node) => [node.id, nodeRect(node, nodeSizes)]));

  for (const clusterId of expandedClusters) {
    const members = nodes.filter((node) => {
      const data = nodeData(node);
      return data.clusterId === clusterId && !data.isCluster;
    });
    if (members.length === 0) continue;

    const memberIds = new Set(members.map((node) => node.id));
    const foreignRects = nodes
      .filter((node) => !memberIds.has(node.id))
      .map((node) => rectByNodeId.get(node.id))
      .filter((rect): rect is Rect => Boolean(rect));
    const componentRects = memberComponents(members, edges).map((component) => boundsFor(component, nodeSizes));
    const frameRects = mergeFrameRects(componentRects, foreignRects, paddingX, paddingTop, paddingBottom);

    frameRects.filter((rect) => rect.memberIds.length >= minFrameMemberCount).forEach((rect, index) => {
      const frame = padded(rect, paddingX, paddingTop, paddingBottom);
      frames.push({
        id: `frame:${clusterId}:${index}`,
        x: frame.left,
        y: frame.top,
        width: frame.right - frame.left,
        height: frame.bottom - frame.top,
        label: clusterLabel(clusterId),
        color: clusterColor(clusterId),
        memberCount: rect.memberIds.length
      });
    });
  }

  return frames;
}
