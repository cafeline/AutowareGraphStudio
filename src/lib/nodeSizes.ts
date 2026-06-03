import type { Node } from "@xyflow/react";
import * as tokens from "./designTokens";

export type NodeSize = {
  width: number;
  height: number;
};

export type NodeSizeMap = Record<string, NodeSize>;

export const defaultNodeWidth = tokens.autowareNodeWidth;
export const defaultNodeHeight = tokens.autowareNodeMinHeight;
export const defaultAggregateNodeWidth = tokens.categoryNodeWidth;
export const defaultAggregateNodeHeight = tokens.categoryNodeMinHeight;

export function defaultNodeSize(isAggregate = false): NodeSize {
  return {
    width: isAggregate ? defaultAggregateNodeWidth : defaultNodeWidth,
    height: isAggregate ? defaultAggregateNodeHeight : defaultNodeHeight
  };
}

export function sizeForNodeId(nodeId: string, measuredSizes: NodeSizeMap | undefined, fallback = defaultNodeSize()): NodeSize {
  const measured = measuredSizes?.[nodeId];
  if (!measured || measured.width <= 0 || measured.height <= 0) return fallback;
  return measured;
}

export function sizeForFlowNode(node: Node, measuredSizes?: NodeSizeMap): NodeSize {
  const data = node.data as { isCluster?: boolean } | undefined;
  const fallback = defaultNodeSize(Boolean(data?.isCluster));
  return sizeForNodeId(node.id, measuredSizes, fallback);
}
