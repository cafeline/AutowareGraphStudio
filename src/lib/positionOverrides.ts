import type { Node } from "@xyflow/react";

export type PositionOverrides = Record<string, { x: number; y: number }>;

export function applyPositionOverrides(nodes: Node[], overrides: PositionOverrides) {
  return nodes.map((node) => {
    const position = overrides[node.id];
    return position ? { ...node, position } : node;
  });
}

export function withPositionOverride(overrides: PositionOverrides, nodeId: string, position: { x: number; y: number }) {
  return {
    ...overrides,
    [nodeId]: { ...position }
  };
}
