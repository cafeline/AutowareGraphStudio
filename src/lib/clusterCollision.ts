import type { Node } from "@xyflow/react";
import { sizeForFlowNode, type NodeSizeMap } from "./nodeSizes";

const collideGap = 28;

type CollisionGroup = {
  key: string;
  nodes: Node[];
};

function collisionGroupKey(node: Node): string {
  const data = node.data as { clusterId?: string } | undefined;
  return data?.clusterId ? `cluster:${data.clusterId}` : node.id;
}

function collisionGroups(nodes: Node[]): CollisionGroup[] {
  const byKey = new Map<string, Node[]>();
  for (const node of nodes) {
    const key = collisionGroupKey(node);
    const group = byKey.get(key);
    if (group) group.push(node);
    else byKey.set(key, [node]);
  }
  return [...byKey.entries()].map(([key, groupNodes]) => ({ key, nodes: groupNodes }));
}

// Dagre underestimates card heights, so cards in the same column can still overlap.
// Push lower groups down until no two cards overlap. Real topic nodes are grouped
// by category so a cross-category collision cannot pull one member far away from
// its frame.
export function resolveTopicNodeCollisions(
  nodes: Node[],
  nodeSizes: NodeSizeMap = {}
): Node[] {
  const next = nodes.map((node) => ({ ...node, position: { ...node.position } }));
  const nodeWidth = (node: Node) => sizeForFlowNode(node, nodeSizes).width;
  const nodeHeight = (node: Node) => sizeForFlowNode(node, nodeSizes).height;
  const groupRect = (group: CollisionGroup) => ({
    left: Math.min(...group.nodes.map((node) => node.position.x)),
    right: Math.max(...group.nodes.map((node) => node.position.x + nodeWidth(node))),
    top: Math.min(...group.nodes.map((node) => node.position.y)),
    bottom: Math.max(...group.nodes.map((node) => node.position.y + nodeHeight(node)))
  });
  const moveGroupY = (group: CollisionGroup, deltaY: number) => {
    for (const node of group.nodes) {
      node.position.y += deltaY;
    }
  };

  for (let pass = 0; pass < next.length; pass += 1) {
    let moved = false;
    const ordered = collisionGroups(next).sort((a, b) => {
      const rectA = groupRect(a);
      const rectB = groupRect(b);
      return rectA.left - rectB.left || rectA.top - rectB.top || a.key.localeCompare(b.key);
    });

    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const currentRect = groupRect(current);

      for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
        const other = ordered[otherIndex];
        const otherRect = groupRect(other);
        const overlapsX =
          currentRect.left < otherRect.right && currentRect.right > otherRect.left;
        const overlapsY = currentRect.bottom + collideGap > otherRect.top && currentRect.top < otherRect.bottom;
        if (!overlapsX || !overlapsY || otherRect.top < currentRect.top) continue;
        const nextY = currentRect.bottom + collideGap;
        if (otherRect.top < nextY) {
          moveGroupY(other, nextY - otherRect.top);
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return next;
}
