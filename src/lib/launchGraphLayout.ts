import dagre from "dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { LaunchFileNode, LaunchGraphEdge, LaunchGraphModel } from "./graphModel";
import type { LaunchNodeData } from "../components/LaunchNode";

const launchNodeWidth = 300;
const launchNodeBaseHeight = 146;
const launchNodeListChromeHeight = 42;
const launchNodeListItemHeight = 22;
const launchNodeMaxListHeight = 132;
const launchChildXGap = 380;
const launchSiblingYGap = 28;

export type LaunchNodeSizeMap = Record<string, { width: number; height: number }>;
export type LaunchPositionMap = Record<string, { x: number; y: number }>;

export function visibleLaunchPaths(launchGraph: LaunchGraphModel, entryLaunch: string, expandedLaunches: Set<string>) {
  const knownLaunches = new Set(launchGraph.launches.map((launch) => launch.path));
  const root = knownLaunches.has(entryLaunch) ? entryLaunch : launchGraph.launches[0]?.path;
  if (!root) return new Set<string>();
  const visible = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of launchGraph.edges) {
      if (!visible.has(edge.source) || !expandedLaunches.has(edge.source) || visible.has(edge.target)) continue;
      visible.add(edge.target);
      changed = true;
    }
  }
  return visible;
}

export function visibleLaunchEdges(edges: LaunchGraphEdge[], visiblePaths: Set<string>) {
  return edges.filter((edge) => visiblePaths.has(edge.source) && visiblePaths.has(edge.target));
}

export function launchGraphRenderKey(visiblePaths: Set<string>, edges: LaunchGraphEdge[]) {
  const pathKey = [...visiblePaths].sort().join("|");
  const edgeKey = edges.map((edge) => edge.id).sort().join("|");
  return `${pathKey}::${edgeKey}`;
}

export function estimatedLaunchNodeHeight(launch: Pick<LaunchFileNode, "nodeNames">) {
  if (launch.nodeNames.length === 0) return launchNodeBaseHeight;
  const listHeight = Math.min(launchNodeMaxListHeight, launchNodeListChromeHeight + launch.nodeNames.length * launchNodeListItemHeight);
  return launchNodeBaseHeight + listHeight;
}

export function directChildLaunchPaths(edges: LaunchGraphEdge[], parentPath: string, visiblePaths: Set<string>) {
  return edges.filter((edge) => edge.source === parentPath && visiblePaths.has(edge.target)).map((edge) => edge.target);
}

export function placeNewChildLaunchesNearParent(
  currentPositions: LaunchPositionMap,
  parentPath: string,
  childPaths: string[],
  launchesByPath: Map<string, LaunchFileNode>
) {
  const parentPosition = currentPositions[parentPath];
  if (!parentPosition) return currentPositions;

  const newChildren = childPaths.filter((childPath) => !currentPositions[childPath]);
  if (newChildren.length === 0) return currentPositions;

  const next = { ...currentPositions };
  const childHeights = newChildren.map((childPath) => estimatedLaunchNodeHeight(launchesByPath.get(childPath) ?? { nodeNames: [] }));
  const totalHeight =
    childHeights.reduce((total, height) => total + height, 0) + Math.max(0, childHeights.length - 1) * launchSiblingYGap;
  let y = parentPosition.y - totalHeight / 2;

  for (let index = 0; index < newChildren.length; index += 1) {
    const childPath = newChildren[index];
    next[childPath] = {
      x: parentPosition.x + launchChildXGap,
      y
    };
    y += childHeights[index] + launchSiblingYGap;
  }

  return next;
}

export function resolveLaunchNodeCollisions<NodeType extends Node>(
  nodes: NodeType[],
  sizes: LaunchNodeSizeMap,
  gap = launchSiblingYGap
): NodeType[] {
  const next = nodes.map((node) => ({ ...node, position: { ...node.position } }));

  for (let pass = 0; pass < next.length; pass += 1) {
    let moved = false;
    const ordered = [...next].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const currentSize = sizes[current.id] ?? { width: launchNodeWidth, height: estimatedLaunchNodeHeight(current.data as Pick<LaunchFileNode, "nodeNames">) };
      const currentBottom = current.position.y + currentSize.height;

      for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
        const other = ordered[otherIndex];
        const otherSize = sizes[other.id] ?? { width: launchNodeWidth, height: estimatedLaunchNodeHeight(other.data as Pick<LaunchFileNode, "nodeNames">) };
        const overlapsX = current.position.x < other.position.x + otherSize.width && current.position.x + currentSize.width > other.position.x;
        const overlapsY = currentBottom + gap > other.position.y && current.position.y < other.position.y + otherSize.height;
        if (!overlapsX || !overlapsY || other.position.y < current.position.y) continue;
        const nextY = currentBottom + gap;
        if (other.position.y < nextY) {
          other.position.y = nextY;
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return next;
}

export function layoutLaunchGraph(
  launches: LaunchFileNode[],
  edges: LaunchGraphEdge[],
  selectedLaunchPath: string | null
): Node<LaunchNodeData>[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 120,
    nodesep: 46,
    marginx: 24,
    marginy: 24
  });

  for (const launch of launches) {
    graph.setNode(launch.path, { width: launchNodeWidth, height: estimatedLaunchNodeHeight(launch) });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return launches.map((launch) => {
    const launchNodeHeight = estimatedLaunchNodeHeight(launch);
    const position = graph.node(launch.path) ?? { x: launchNodeWidth / 2, y: launchNodeHeight / 2 };
    return {
      id: launch.path,
      type: "launchNode",
      position: {
        x: position.x - launchNodeWidth / 2,
        y: position.y - launchNodeHeight / 2
      },
      data: {
        ...launch,
        selected: launch.path === selectedLaunchPath
      }
    };
  });
}

export function launchFlowEdges(edges: LaunchGraphEdge[], selectedLaunchPath: string | null): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: edge.source === selectedLaunchPath || edge.target === selectedLaunchPath ? "#5ce6d0" : "#6f7d8c",
      strokeWidth: edge.source === selectedLaunchPath || edge.target === selectedLaunchPath ? 2.4 : 1.3
    }
  }));
}
