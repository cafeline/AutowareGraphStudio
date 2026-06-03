import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "@emotion/styled";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
  ReactFlowProvider
} from "@xyflow/react";
import { buildClusteredGraph, clusterColor, clusterLabel, type ClusterId } from "../lib/clusters";
import { resolveTopicNodeCollisions } from "../lib/clusterCollision";
import * as tokens from "../lib/designTokens";
import { visibleEdges, visibleNodes } from "../lib/filters";
import { clearLayoutCache, layoutGroupedGraph } from "../lib/graphLayout";
import { applyCompositionToTopicGraph } from "../lib/compositionGraph";
import { buildCategoryFrameRects } from "../lib/categoryFrames";
import type { NodeSizeMap } from "../lib/nodeSizes";
import { applyPositionOverrides, type PositionOverrides } from "../lib/positionOverrides";
import { connectedNodeIdsForSelection, selectedTopicNamesForNode, selectedTopicRolesForNode } from "../lib/selection";
import { useGraphStore } from "../stores/graphStore";
import { px } from "../styles/theme";
import { AutowareNode } from "./AutowareNode";
import { CanvasEdges } from "./CanvasEdges";

const nodeTypes = { autowareNode: AutowareNode };

// Padding around an expanded category's member bounding box for its backdrop frame.
const framePadX = 26;
const framePadTop = 34;
const framePadBottom = 22;

const GraphViewFrame = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid ${tokens.borderSubtle};
  background: ${tokens.bgSubtle};
`;

const GraphOptimizeButton = styled.button`
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

const ClusterReset = styled.div`
  position: absolute;
  z-index: 8;
  top: 62px;
  left: 12px;
  background: ${tokens.bgElevated};
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusMd)};
  padding: 10px;
  box-shadow: ${tokens.shadowMd};
`;

const ClusterResetTitle = styled.div`
  margin: 0 0 6px;
  color: ${tokens.textMuted};
  font-size: ${px(tokens.fontXs)};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1;
`;

const ClusterResetActions = styled.div`
  display: flex;
  max-width: min(620px, calc(100vw - 440px));
  flex-wrap: wrap;
  gap: 6px;

  button {
    padding: 5px 10px;
    font-size: ${px(tokens.fontSm)};
    line-height: 1.2;
  }
`;

export function GraphView() {
  const graph = useGraphStore((state) => state.graph);
  const showUnusedNodes = useGraphStore((state) => state.showUnusedNodes);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useGraphStore((state) => state.setSelectedNodeId);
  const composition = useGraphStore((state) => state.composition);
  const switchArgs = useGraphStore((state) => state.switchArgs);
  const entryLaunch = useGraphStore((state) => state.entryLaunch);
  const [expandedClusters, setExpandedClusters] = useState<Set<ClusterId>>(new Set());
  const [positionOverrides, setPositionOverrides] = useState<PositionOverrides>({});
  const [measuredNodeSizes, setMeasuredNodeSizes] = useState<NodeSizeMap>({});
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const expandedClusterList = useMemo(() => [...expandedClusters], [expandedClusters]);
  // Re-fit only when a new graph is loaded, not when re-arranging (Optimize) or expanding.
  const fitKey = useMemo(() => `${graph.nodes.length}:${graph.edges.length}:${graph.nodes[0]?.id ?? ""}`, [graph]);
  useEffect(() => {
    setViewport(null);
    setMeasuredNodeSizes({});
  }, [fitKey]);

  const effectiveGraph = useMemo(() => {
    const switchNames = new Set(switchArgs.map((item) => item.name));
    return applyCompositionToTopicGraph(graph, composition, switchNames, entryLaunch);
  }, [composition, entryLaunch, graph, switchArgs]);

  const baseNodes = useMemo(() => visibleNodes(effectiveGraph, showUnusedNodes), [effectiveGraph, showUnusedNodes]);
  const baseEdges = useMemo(() => visibleEdges(effectiveGraph, baseNodes), [effectiveGraph, baseNodes]);
  const clusteredGraph = useMemo(
    () => buildClusteredGraph(baseNodes, baseEdges, expandedClusters),
    [baseNodes, baseEdges, expandedClusters]
  );
  // Two-level (block) dagre over the visible graph: each category is laid out as
  // its own block and the blocks are then placed against each other. Members of a
  // category stay grouped, and dagre guarantees no two cards overlap once the
  // measured sizes arrive. resolveTopicNodeCollisions is only a first-frame
  // safety net, before React Flow reports measured sizes.
  const laidOutNodes = useMemo<Node[]>(
    () => layoutGroupedGraph(clusteredGraph.nodes, clusteredGraph.edges, { nodeSizes: measuredNodeSizes }),
    [clusteredGraph, measuredNodeSizes]
  );
  const positionedNodes = useMemo<Node[]>(
    () => resolveTopicNodeCollisions(applyPositionOverrides(laidOutNodes, positionOverrides), measuredNodeSizes),
    [laidOutNodes, positionOverrides, measuredNodeSizes]
  );
  const selectedTopicNames = useMemo(() => selectedTopicNamesForNode(baseNodes, selectedNodeId), [baseNodes, selectedNodeId]);
  const selectedTopicRoles = useMemo(() => selectedTopicRolesForNode(baseNodes, selectedNodeId), [baseNodes, selectedNodeId]);
  const connectedNodeIds = useMemo(
    () => connectedNodeIdsForSelection(clusteredGraph.edges, selectedNodeId, selectedTopicNames),
    [clusteredGraph.edges, selectedNodeId, selectedTopicNames]
  );
  const highlightedNodes = useMemo<Node[]>(
    () =>
      positionedNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          connected: connectedNodeIds.has(node.id)
        }
      })),
    [positionedNodes, connectedNodeIds]
  );
  // Backdrop frame behind each expanded category, sized to its members' bounds.
  // Drawn by CanvasEdges on the lowest canvas (below the topic lines) so the
  // frame never hides edges, and never sits in front of the node cards.
  const frameRects = useMemo(
    () =>
      buildCategoryFrameRects({
        expandedClusters,
        nodes: positionedNodes,
        edges: clusteredGraph.edges,
        nodeSizes: measuredNodeSizes,
        paddingX: framePadX,
        paddingTop: framePadTop,
        paddingBottom: framePadBottom
      }),
    [clusteredGraph.edges, expandedClusters, measuredNodeSizes, positionedNodes]
  );
  const flowNodes = highlightedNodes;
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
    clearLayoutCache();
    setPositionOverrides({});
  };
  const handleNodesChange = useCallback<OnNodesChange>((changes) => {
    setMeasuredNodeSizes((current) => {
      let next: NodeSizeMap | null = null;

      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        const width = Math.ceil(change.dimensions.width);
        const height = Math.ceil(change.dimensions.height);
        if (width <= 0 || height <= 0) continue;
        const previous = current[change.id];
        if (previous?.width === width && previous.height === height) continue;
        next ??= { ...current };
        next[change.id] = { width, height };
      }

      return next ?? current;
    });
  }, []);
  const collapseCluster = (clusterId: ClusterId) => {
    setExpandedClusters((current) => {
      const next = new Set(current);
      next.delete(clusterId);
      return next;
    });
    setSelectedNodeId(null);
  };
  const handleNodeClick: NodeMouseHandler = (_, node) => {
    const nodeData = node.data as { clusterId?: ClusterId; isCluster?: boolean };
    if (nodeData.isCluster && nodeData.clusterId) {
      const clusterId = nodeData.clusterId;
      setExpandedClusters((current) => {
        const next = new Set(current);
        if (next.has(clusterId)) next.delete(clusterId);
        else next.add(clusterId);
        return next;
      });
      setSelectedNodeId(null);
      return;
    }
    setSelectedNodeId(node.id);
  };

  return (
    <GraphViewFrame>
      <GraphOptimizeButton type="button" onClick={handleOptimizeLayout}>
        Optimize Layout
      </GraphOptimizeButton>
      {expandedClusterList.length > 0 ? (
        <ClusterReset aria-label="Expanded categories">
          <ClusterResetTitle>Collapse category</ClusterResetTitle>
          <ClusterResetActions>
            {expandedClusterList.map((clusterId) => {
              const color = clusterColor(clusterId);
              return (
                <button
                  key={clusterId}
                  type="button"
                  onClick={() => collapseCluster(clusterId)}
                  style={{ borderColor: color, color }}
                >
                  {clusterLabel(clusterId)}
                </button>
              );
            })}
            {expandedClusterList.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  setExpandedClusters(new Set());
                  setSelectedNodeId(null);
                }}
              >
                All
              </button>
            ) : null}
          </ClusterResetActions>
        </ClusterReset>
      ) : null}
      <ReactFlowProvider>
        <ReactFlow
          key={fitKey}
          nodes={flowNodes}
          edges={[]}
          nodeTypes={nodeTypes}
          fitView={viewport === null}
          defaultViewport={viewport ?? undefined}
          onMove={(_, nextViewport) => setViewport(nextViewport)}
          elevateEdgesOnSelect={false}
          elevateNodesOnSelect={false}
          minZoom={0.1}
          maxZoom={1.5}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDrag}
          onNodesChange={handleNodesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedNodeId(null)}
        >
          <Background />
          <CanvasEdges
            nodes={positionedNodes}
            edges={clusteredGraph.edges}
            selectedNodeId={selectedNodeId}
            selectedTopicNames={selectedTopicNames}
            selectedTopicRoles={selectedTopicRoles}
            nodeSizes={measuredNodeSizes}
            frames={frameRects}
          />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </GraphViewFrame>
  );
}
