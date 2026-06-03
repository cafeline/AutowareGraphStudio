import type { Node } from "@xyflow/react";
import {
  edgeLabelTargetYOffset,
  edgeParallelSpacing,
  edgePortGap,
  edgePortSpreadMarginMax,
  edgePortSpreadMarginRatio
} from "./designTokens";
import { edgeClass } from "./filters";
import type { GraphEdge } from "./graphModel";
import { sizeForFlowNode, type NodeSizeMap } from "./nodeSizes";
import type { SelectedTopicRole } from "./selection";

const portGap = edgePortGap;

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  direction: 1 | -1;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  labelX: number;
  labelY: number;
  targetLabelX: number;
  targetLabelY: number;
  topicName: string;
  dataType: string;
  topicRole?: SelectedTopicRole;
  kind: "active" | "inactive" | "unknown";
  dimmed: boolean;
};

export function canvasEdgeDirection(edge: Pick<CanvasEdge, "sourceX" | "targetX"> & { direction?: 1 | -1 }) {
  return edge.direction ?? (edge.targetX >= edge.sourceX ? 1 : -1);
}

export function targetArrowAngleForCanvasEdge(edge: Pick<CanvasEdge, "sourceX" | "targetX"> & { direction?: 1 | -1 }) {
  return canvasEdgeDirection(edge) === 1 ? 0 : Math.PI;
}

const parallelEdgeSpacing = edgeParallelSpacing;

// 同じノードの縦辺に count 個のポートを等間隔で割り当てた Y 座標を返す。
// 1 個ならノード中心に置き（従来挙動）、複数なら上下に余白を残して分散する。
function spreadPortYs(count: number, nodeTop: number, nodeHeight: number): number[] {
  const center = nodeTop + nodeHeight / 2;
  if (count <= 1) return [center];
  const margin = Math.min(nodeHeight * edgePortSpreadMarginRatio, edgePortSpreadMarginMax);
  const top = nodeTop + margin;
  const bottom = nodeTop + nodeHeight - margin;
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, i) => top + step * i);
}

export function buildCanvasEdges(
  nodes: Node[],
  edges: GraphEdge[],
  selectedNodeId: string | null,
  _selectedTopicNames: Set<string> = new Set(),
  selectedTopicRoles: Map<string, SelectedTopicRole> = new Map(),
  nodeSizes: NodeSizeMap = {}
): CanvasEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const pairKey = (source: string, target: string) => `${source}\0${target}`;
  const pairTotals = new Map<string, number>();
  for (const edge of edges) {
    const key = pairKey(edge.source, edge.target);
    pairTotals.set(key, (pairTotals.get(key) ?? 0) + 1);
  }
  const pairIndices = new Map<string, number>();

  type Record = {
    edge: GraphEdge;
    sourceNode: Node;
    targetNode: Node;
    sourceSize: { width: number; height: number };
    targetSize: { width: number; height: number };
    kind: "active" | "inactive" | "unknown";
    direction: 1 | -1;
    sourceCenterY: number;
    targetCenterY: number;
    sourcePortY: number;
    targetPortY: number;
  };

  const records: Record[] = [];
  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const sourceSize = sizeForFlowNode(sourceNode, nodeSizes);
    const targetSize = sizeForFlowNode(targetNode, nodeSizes);
    const sourceCenterX = sourceNode.position.x + sourceSize.width / 2;
    const targetCenterX = targetNode.position.x + targetSize.width / 2;
    const sourceCenterY = sourceNode.position.y + sourceSize.height / 2;
    const targetCenterY = targetNode.position.y + targetSize.height / 2;
    records.push({
      edge,
      sourceNode,
      targetNode,
      sourceSize,
      targetSize,
      kind: edgeClass(edge, selectedNodeId),
      direction: targetCenterX >= sourceCenterX ? 1 : -1,
      sourceCenterY,
      targetCenterY,
      sourcePortY: sourceCenterY,
      targetPortY: targetCenterY
    });
  }

  // A-2: アクティブエッジは、ノードの同じ縦辺ごとに等間隔でポートを割り当てる。
  // source/target を別々に分散すると、同じノードの同じ側に入出力が混在したときに重なるため、
  // 左辺/右辺単位で入出力をまとめてから分散する。
  type ActiveEndpoint = {
    record: Record;
    end: "source" | "target";
    node: Node;
    size: { width: number; height: number };
    peerCenterY: number;
    side: "left" | "right";
  };
  const activeByNodeSide = new Map<string, ActiveEndpoint[]>();
  const pushEndpoint = (endpoint: ActiveEndpoint) => {
    const key = `${endpoint.node.id}:${endpoint.side}`;
    const group = activeByNodeSide.get(key);
    if (group) group.push(endpoint);
    else activeByNodeSide.set(key, [endpoint]);
  };
  for (const record of records) {
    if (record.kind !== "active") continue;
    pushEndpoint({
      record,
      end: "source",
      node: record.sourceNode,
      size: record.sourceSize,
      peerCenterY: record.targetCenterY,
      side: record.direction === 1 ? "right" : "left"
    });
    pushEndpoint({
      record,
      end: "target",
      node: record.targetNode,
      size: record.targetSize,
      peerCenterY: record.sourceCenterY,
      side: record.direction === 1 ? "left" : "right"
    });
  }
  for (const group of activeByNodeSide.values()) {
    group.sort(
      (a, b) =>
        a.peerCenterY - b.peerCenterY ||
        a.end.localeCompare(b.end) ||
        a.record.edge.topicName.localeCompare(b.record.edge.topicName) ||
        a.record.edge.id.localeCompare(b.record.edge.id)
    );
    const ys = spreadPortYs(group.length, group[0].node.position.y, group[0].size.height);
    group.forEach((endpoint, i) => {
      if (endpoint.end === "source") endpoint.record.sourcePortY = ys[i];
      else endpoint.record.targetPortY = ys[i];
    });
  }

  return records.map((record) => {
    const { edge, sourceNode, targetNode, sourceSize, targetSize, kind, direction } = record;
    const source = sourceNode.position;
    const target = targetNode.position;

    const key = pairKey(edge.source, edge.target);
    const total = pairTotals.get(key) ?? 1;
    const idx = pairIndices.get(key) ?? 0;
    pairIndices.set(key, idx + 1);
    // 非アクティブエッジは従来どおり同一ペアを縦に少しずらすだけ。アクティブはポート分散済みの Y を使う。
    const parallelOffset = total > 1 ? (idx - (total - 1) / 2) * parallelEdgeSpacing : 0;

    const sourceX = direction === 1 ? source.x + sourceSize.width + portGap : source.x - portGap;
    const targetX = direction === 1 ? target.x - portGap : target.x + targetSize.width + portGap;
    const sourceY = kind === "active" ? record.sourcePortY : source.y + sourceSize.height / 2 + parallelOffset;
    const targetY = kind === "active" ? record.targetPortY : target.y + targetSize.height / 2 + parallelOffset;

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      direction,
      sourceX,
      sourceY,
      targetX,
      targetY,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2,
      targetLabelX: targetX - 10,
      targetLabelY: targetY - edgeLabelTargetYOffset,
      topicName: edge.topicName,
      dataType: edge.dataType,
      topicRole: selectedTopicRoles.get(edge.topicName),
      kind,
      dimmed: false
    };
  });
}
