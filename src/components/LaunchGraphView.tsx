import { useCallback, useMemo, useState } from "react";
import styled from "@emotion/styled";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport
} from "@xyflow/react";
import {
  directChildLaunchPaths,
  launchFlowEdges,
  launchGraphRenderKey,
  layoutLaunchGraph,
  placeNewChildLaunchesNearParent,
  resolveLaunchNodeCollisions,
  visibleLaunchEdges,
  visibleLaunchPaths,
  type LaunchNodeSizeMap,
  type LaunchPositionMap
} from "../lib/launchGraphLayout";
import * as tokens from "../lib/designTokens";
import { applyPositionOverrides, type PositionOverrides, withPositionOverride } from "../lib/positionOverrides";
import { decorateLaunchGraphStatus } from "../lib/compositionGraph";
import { useGraphStore } from "../stores/graphStore";
import { px } from "../styles/theme";
import { LaunchNode } from "./LaunchNode";

const nodeTypes = { launchNode: LaunchNode };

type LaunchGraphViewProps = {
  selectedLaunchPath: string | null;
  onSelectLaunch: (path: string | null) => void;
};

const GraphViewFrame = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid ${tokens.borderSubtle};
  background: ${tokens.bgSubtle};
`;

const LaunchGraphOptimizeButton = styled.button`
  position: absolute;
  z-index: 8;
  top: 10px;
  right: 12px;
  padding: 8px 12px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusMd)};
  background: ${tokens.bgElevated};
  color: ${tokens.textPrimary};
  font-size: ${px(tokens.fontSm)};
  box-shadow: ${tokens.shadowMd};

  &:hover:not(:disabled) {
    border-color: ${tokens.accent};
    color: ${tokens.accentText};
    background: ${tokens.accentSoft};
  }
`;

export function LaunchGraphView({ selectedLaunchPath, onSelectLaunch }: LaunchGraphViewProps) {
  const [expandedLaunches, setExpandedLaunches] = useState<Set<string>>(new Set());
  const [positionOverrides, setPositionOverrides] = useState<PositionOverrides>({});
  const [nodeSizes, setNodeSizes] = useState<LaunchNodeSizeMap>({});
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const graph = useGraphStore((state) => state.graph);
  const entryLaunch = useGraphStore((state) => state.entryLaunch);
  const composition = useGraphStore((state) => state.composition);
  const launchGraph = useMemo(
    () => decorateLaunchGraphStatus(graph, composition, entryLaunch),
    [composition, entryLaunch, graph]
  );
  const rootLaunch = entryLaunch;
  const launchesByPath = useMemo(
    () => new Map(launchGraph.launches.map((launch) => [launch.path, launch])),
    [launchGraph.launches]
  );
  const handleNodeMeasure = useCallback((path: string, size: { width: number; height: number }) => {
    setNodeSizes((current) => {
      const previous = current[path];
      if (previous && Math.abs(previous.width - size.width) < 1 && Math.abs(previous.height - size.height) < 1) return current;
      return { ...current, [path]: size };
    });
  }, []);
  const visiblePaths = useMemo(
    () => visibleLaunchPaths(launchGraph, rootLaunch, expandedLaunches),
    [expandedLaunches, launchGraph, rootLaunch]
  );
  const visibleModelEdges = useMemo(
    () => visibleLaunchEdges(launchGraph.edges, visiblePaths),
    [launchGraph.edges, visiblePaths]
  );
  const nodes = useMemo(
    () => {
      const positioned = applyPositionOverrides(
        layoutLaunchGraph(
          launchGraph.launches.filter((launch) => visiblePaths.has(launch.path)),
          visibleModelEdges,
          selectedLaunchPath
        ),
        positionOverrides
      );
      return resolveLaunchNodeCollisions(positioned, nodeSizes).map((node) => ({
        ...node,
        data: {
          ...node.data,
          onMeasure: handleNodeMeasure
        }
      }));
    },
    [launchGraph.launches, handleNodeMeasure, nodeSizes, positionOverrides, selectedLaunchPath, visibleModelEdges, visiblePaths]
  );
  const edges = useMemo(() => launchFlowEdges(visibleModelEdges, selectedLaunchPath), [selectedLaunchPath, visibleModelEdges]);
  const renderKey = useMemo(() => launchGraphRenderKey(visiblePaths, visibleModelEdges), [visibleModelEdges, visiblePaths]);
  const handleNodeDrag: OnNodeDrag = (_, _node, draggedNodes) => {
    setPositionOverrides((current) => {
      const next = { ...current };
      for (const draggedNode of draggedNodes) {
        next[draggedNode.id] = { ...draggedNode.position };
      }
      return next;
    });
  };
  const handleOptimizeLayout = () => {
    setPositionOverrides({});
  };
  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectLaunch(node.id);
    const nextExpandedLaunches = new Set(expandedLaunches);
    const willExpand = !nextExpandedLaunches.has(node.id);
    if (willExpand) nextExpandedLaunches.add(node.id);
    else nextExpandedLaunches.delete(node.id);

    setPositionOverrides((currentPositions) => {
      const visiblePositions: LaunchPositionMap = { ...currentPositions };
      for (const visibleNode of nodes) {
        visiblePositions[visibleNode.id] = { ...visibleNode.position };
      }
      let nextPositions = withPositionOverride(visiblePositions, node.id, node.position);
      if (willExpand) {
        const nextVisiblePaths = visibleLaunchPaths(launchGraph, rootLaunch, nextExpandedLaunches);
        nextPositions = placeNewChildLaunchesNearParent(
          nextPositions,
          node.id,
          directChildLaunchPaths(launchGraph.edges, node.id, nextVisiblePaths),
          launchesByPath
        );
      }
      return nextPositions;
    });
    setExpandedLaunches(nextExpandedLaunches);
  };

  return (
    <GraphViewFrame>
      <LaunchGraphOptimizeButton type="button" onClick={handleOptimizeLayout}>
        Optimize Layout
      </LaunchGraphOptimizeButton>
      <ReactFlowProvider>
        <ReactFlow
          key={renderKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView={viewport === null}
          defaultViewport={viewport ?? undefined}
          minZoom={0.2}
          maxZoom={1.5}
          onMove={(_, nextViewport) => setViewport(nextViewport)}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDrag}
          onNodeClick={handleNodeClick}
          onPaneClick={() => onSelectLaunch(null)}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </GraphViewFrame>
  );
}
