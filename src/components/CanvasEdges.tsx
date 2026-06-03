import { useEffect, useMemo, useRef } from "react";
import styled from "@emotion/styled";
import { useViewport, type Node } from "@xyflow/react";
import {
  buildCanvasEdges,
  canvasEdgeDirection,
  targetArrowAngleForCanvasEdge,
  type CanvasEdge
} from "../lib/canvasEdges";
import type { CategoryFrameRect } from "../lib/categoryFrames";
import {
  arrowDotSize,
  arrowSize,
  canvasEdgesActiveZIndex,
  canvasEdgesBaseZIndex,
  canvasEdgesLabelZIndex,
  canvasFramesZIndex,
  clusterFrameBorderDash,
  clusterFrameBorderWidth,
  clusterFrameFillAlpha,
  clusterFrameLabelFontSize,
  clusterFrameLabelHeight,
  clusterFrameLabelPaddingX,
  clusterFrameRadius,
  edgeBezierControlMin,
  edgeBezierControlRatio,
  edgeColorActiveBoth,
  edgeColorActiveInput,
  edgeColorActiveOutput,
  edgeColorInactiveAlpha,
  edgeColorInactiveRgb,
  edgeColorUnknownAlpha,
  edgeDimmedAlpha,
  edgeHoverHitTolerance,
  edgeLabelBg,
  edgeLabelBorderAlpha,
  edgeLabelCollisionGap,
  edgeLabelFontSize,
  edgeLabelGap,
  edgeLabelHeight,
  edgeLabelPaddingX,
  edgeLabelText,
  edgeWidthActive,
  edgeWidthDefault,
  edgeWidthUnknown,
  fontFamilyMono
} from "../lib/designTokens";
import type { GraphEdge } from "../lib/graphModel";
import type { NodeSizeMap } from "../lib/nodeSizes";
import type { SelectedTopicRole } from "../lib/selection";

type CanvasEdgesProps = {
  nodes: Node[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  selectedTopicNames?: Set<string>;
  selectedTopicRoles?: Map<string, SelectedTopicRole>;
  nodeSizes?: NodeSizeMap;
  frames?: CategoryFrameRect[];
};

const CanvasLayer = styled.canvas<{ $zIndex: number }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: ${({ $zIndex }) => $zIndex};
`;

function colorWithAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function edgeStrokeColor(edge: CanvasEdge) {
  if (edge.kind === "active") return activeTopicColor(edge.topicRole);
  if (edge.kind === "unknown") return `rgba(${edgeColorInactiveRgb}, ${edgeColorUnknownAlpha})`;
  return `rgba(${edgeColorInactiveRgb}, ${edgeColorInactiveAlpha})`;
}

function activeTopicColor(role?: SelectedTopicRole) {
  if (role === "input") return edgeColorActiveInput;
  if (role === "output") return edgeColorActiveOutput;
  return edgeColorActiveBoth;
}

function drawArrow(context: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  const size = arrowSize;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - size * Math.cos(angle - Math.PI / 7), y - size * Math.sin(angle - Math.PI / 7));
  context.lineTo(x - size * Math.cos(angle + Math.PI / 7), y - size * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

type EdgeLabelLayout = {
  edge: CanvasEdge;
  topic: string;
  text: string;
  count: number;
  labelLeft: number;
  labelY: number;
  width: number;
  height: number;
  textX: number;
};

function labelRectsOverlap(a: EdgeLabelLayout, b: EdgeLabelLayout) {
  const aLeft = a.labelLeft;
  const aRight = a.labelLeft + a.width;
  const aTop = a.labelY - a.height / 2;
  const aBottom = a.labelY + a.height / 2;
  const bLeft = b.labelLeft;
  const bRight = b.labelLeft + b.width;
  const bTop = b.labelY - b.height / 2;
  const bBottom = b.labelY + b.height / 2;

  return (
    aLeft < bRight + edgeLabelCollisionGap &&
    aRight + edgeLabelCollisionGap > bLeft &&
    aTop < bBottom + edgeLabelCollisionGap &&
    aBottom + edgeLabelCollisionGap > bTop
  );
}

// C-1: 同名トピックが「同じ接続先ノード」に複数刺さっているときだけ 1 ラベルに集約し、`×N` を付ける。
// ラベルは矢印先端（target 側）に描くため、接続先が違う同名トピックは別ラベルにしないとラベルが宙に浮く。
function arrangeEdgeLabels(context: CanvasRenderingContext2D, edges: CanvasEdge[]): EdgeLabelLayout[] {
  const groups = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== "active") continue;
    const key = `${edge.target}\0${edge.topicName}`;
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }

  const layouts = [...groups.values()]
    .map((group) => {
      const rep = group[0];
      const count = group.length;
      const text = count > 1 ? `${rep.topicName}  ×${count}` : rep.topicName;
      const direction = canvasEdgeDirection(rep);
      const width = context.measureText(text).width + edgeLabelPaddingX;
      const height = edgeLabelHeight;
      // 重複が複数ポートに分散しているときはラベルをそれらの中間に置く。
      const labelY = group.reduce((sum, edge) => sum + edge.targetLabelY, 0) / count;
      const labelLeft = direction === 1 ? rep.targetX - edgeLabelGap - width : rep.targetX + edgeLabelGap;
      return {
        edge: rep,
        topic: rep.topicName,
        text,
        count,
        labelLeft,
        labelY,
        width,
        height,
        textX: labelLeft + edgeLabelPaddingX / 2
      };
    })
    .sort((a, b) => a.labelY - b.labelY || a.labelLeft - b.labelLeft || a.topic.localeCompare(b.topic));

  const placed: EdgeLabelLayout[] = [];
  for (const layout of layouts) {
    let labelY = layout.labelY;
    let moved = true;
    while (moved) {
      moved = false;
      const candidate = { ...layout, labelY };
      for (const previous of placed) {
        if (!labelRectsOverlap(candidate, previous)) continue;
        labelY = previous.labelY + previous.height / 2 + layout.height / 2 + edgeLabelCollisionGap;
        moved = true;
      }
    }
    placed.push({ ...layout, labelY });
  }

  return placed;
}

function prepareCanvas(canvas: HTMLCanvasElement, parent: HTMLElement) {
  const rect = parent.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  return { context, rect, ratio };
}

function bezierControlOffset(edge: CanvasEdge) {
  return Math.max(edgeBezierControlMin, Math.abs(edge.targetX - edge.sourceX) * edgeBezierControlRatio);
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// B-1 のホバー判定: ベジェ曲線をポリラインで近似して点との最短距離を測る（world unit）。
function distanceToEdge(edge: CanvasEdge, px: number, py: number) {
  const direction = canvasEdgeDirection(edge);
  const offset = bezierControlOffset(edge);
  const x0 = edge.sourceX;
  const y0 = edge.sourceY;
  const x1 = edge.sourceX + offset * direction;
  const y1 = edge.sourceY;
  const x2 = edge.targetX - offset * direction;
  const y2 = edge.targetY;
  const x3 = edge.targetX;
  const y3 = edge.targetY;

  const segments = 24;
  let prevX = x0;
  let prevY = y0;
  let min = Infinity;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
    const y = mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
    min = Math.min(min, distanceToSegment(px, py, prevX, prevY, x, y));
    prevX = x;
    prevY = y;
  }
  return min;
}

export function CanvasEdges({
  nodes,
  edges,
  selectedNodeId,
  selectedTopicNames = new Set(),
  selectedTopicRoles = new Map(),
  nodeSizes = {},
  frames = []
}: CanvasEdgesProps) {
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewport = useViewport();
  const canvasEdges = useMemo(
    () => buildCanvasEdges(nodes, edges, selectedNodeId, selectedTopicNames, selectedTopicRoles, nodeSizes),
    [nodes, edges, selectedNodeId, selectedTopicNames, selectedTopicRoles, nodeSizes]
  );

  // ホバー中のトピック名と、ヒットテスト用に最後に描いたラベル矩形 / アクティブエッジを保持する。
  const hoverTopicRef = useRef<string | null>(null);
  const labelLayoutRef = useRef<EdgeLabelLayout[]>([]);
  const activeEdgesRef = useRef<CanvasEdge[]>([]);

  // 選択が変わったらホバー状態をリセットする。
  useEffect(() => {
    hoverTopicRef.current = null;
  }, [selectedNodeId]);

  useEffect(() => {
    const frameCanvas = frameCanvasRef.current;
    const baseCanvas = baseCanvasRef.current;
    const activeCanvas = activeCanvasRef.current;
    const labelCanvas = labelCanvasRef.current;
    const parent = baseCanvas?.parentElement;
    if (!frameCanvas || !baseCanvas || !activeCanvas || !labelCanvas || !parent) return;

    let frame = 0;
    const draw = () => {
      const preparedFrames = prepareCanvas(frameCanvas, parent);
      const preparedBase = prepareCanvas(baseCanvas, parent);
      const preparedActive = prepareCanvas(activeCanvas, parent);
      const preparedLabels = prepareCanvas(labelCanvas, parent);
      if (!preparedFrames || !preparedBase || !preparedActive || !preparedLabels) return;

      // Category backdrops, drawn on the lowest canvas so topic lines run over the
      // frame fill but still pass behind the node cards.
      const framesContext = preparedFrames.context;
      framesContext.save();
      framesContext.translate(viewport.x, viewport.y);
      framesContext.scale(viewport.zoom, viewport.zoom);
      framesContext.font = `700 ${clusterFrameLabelFontSize}px ${fontFamilyMono}`;
      framesContext.textAlign = "left";
      framesContext.textBaseline = "middle";
      for (const frameRect of frames) {
        framesContext.beginPath();
        framesContext.roundRect(frameRect.x, frameRect.y, frameRect.width, frameRect.height, clusterFrameRadius);
        framesContext.fillStyle = colorWithAlpha(frameRect.color, clusterFrameFillAlpha);
        framesContext.fill();
        framesContext.setLineDash([clusterFrameBorderDash, clusterFrameBorderDash * 0.67]);
        framesContext.lineWidth = clusterFrameBorderWidth;
        framesContext.strokeStyle = frameRect.color;
        framesContext.stroke();
        framesContext.setLineDash([]);

        const labelText = `${frameRect.label} · ${frameRect.memberCount}`;
        const pillWidth = framesContext.measureText(labelText).width + clusterFrameLabelPaddingX * 2;
        const pillX = frameRect.x + clusterFrameRadius;
        const pillY = frameRect.y - clusterFrameLabelHeight / 2;
        framesContext.beginPath();
        framesContext.roundRect(pillX, pillY, pillWidth, clusterFrameLabelHeight, clusterFrameLabelHeight / 2);
        framesContext.fillStyle = frameRect.color;
        framesContext.fill();
        framesContext.fillStyle = "#ffffff";
        framesContext.fillText(labelText, pillX + clusterFrameLabelPaddingX, pillY + clusterFrameLabelHeight / 2);
      }
      framesContext.restore();

      const hoverTopic = hoverTopicRef.current;
      const isDimmed = (topic: string) => hoverTopic !== null && topic !== hoverTopic;

      const traceEdgePath = (context: CanvasRenderingContext2D, edge: CanvasEdge) => {
        const direction = canvasEdgeDirection(edge);
        const controlOffset = bezierControlOffset(edge);
        context.beginPath();
        context.moveTo(edge.sourceX, edge.sourceY);
        context.bezierCurveTo(
          edge.sourceX + controlOffset * direction,
          edge.sourceY,
          edge.targetX - controlOffset * direction,
          edge.targetY,
          edge.targetX,
          edge.targetY
        );
      };

      const drawEdgePath = (context: CanvasRenderingContext2D, edge: CanvasEdge) => {
        traceEdgePath(context, edge);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.setLineDash([]);
        context.lineDashOffset = 0;
        context.strokeStyle = edgeStrokeColor(edge);
        context.lineWidth =
          edge.kind === "active" ? edgeWidthActive : edge.kind === "unknown" ? edgeWidthUnknown : edgeWidthDefault;
        context.stroke();
      };

      const baseContext = preparedBase.context;
      baseContext.translate(viewport.x, viewport.y);
      baseContext.scale(viewport.zoom, viewport.zoom);
      for (const edge of canvasEdges) {
        if (edge.kind === "active") continue;
        drawEdgePath(baseContext, edge);
      }

      const activeContext = preparedActive.context;
      activeContext.translate(viewport.x, viewport.y);
      activeContext.scale(viewport.zoom, viewport.zoom);
      for (const edge of canvasEdges) {
        if (edge.kind !== "active") continue;
        activeContext.globalAlpha = isDimmed(edge.topicName) ? edgeDimmedAlpha : 1;
        drawEdgePath(activeContext, edge);
        const activeColor = activeTopicColor(edge.topicRole);
        activeContext.setLineDash([]);
        activeContext.fillStyle = activeColor;
        activeContext.beginPath();
        activeContext.arc(edge.sourceX, edge.sourceY, arrowDotSize, 0, Math.PI * 2);
        activeContext.fill();
        drawArrow(activeContext, edge.targetX, edge.targetY, targetArrowAngleForCanvasEdge(edge));
      }
      activeContext.globalAlpha = 1;

      const labelsContext = preparedLabels.context;
      labelsContext.save();
      labelsContext.translate(viewport.x, viewport.y);
      labelsContext.scale(viewport.zoom, viewport.zoom);
      labelsContext.font = `${edgeLabelFontSize}px ${fontFamilyMono}`;
      labelsContext.textAlign = "left";
      labelsContext.textBaseline = "middle";
      const labelLayouts = arrangeEdgeLabels(labelsContext, canvasEdges);
      for (const label of labelLayouts) {
        const { edge, height, labelLeft, labelY, text, textX, width } = label;
        labelsContext.globalAlpha = isDimmed(label.topic) ? edgeDimmedAlpha : 1;
        labelsContext.fillStyle = edgeLabelBg;
        labelsContext.fillRect(labelLeft, labelY - height / 2, width, height);
        labelsContext.strokeStyle = colorWithAlpha(activeTopicColor(edge.topicRole), edgeLabelBorderAlpha);
        labelsContext.lineWidth = label.topic === hoverTopic ? 2 : 1;
        labelsContext.strokeRect(labelLeft, labelY - height / 2, width, height);
        labelsContext.fillStyle = edgeLabelText;
        labelsContext.fillText(text, textX, labelY);
      }
      labelsContext.globalAlpha = 1;
      labelsContext.restore();

      // ヒットテスト用に最新のレイアウトを保存する。
      labelLayoutRef.current = labelLayouts;
      activeEdgesRef.current = canvasEdges.filter((edge) => edge.kind === "active");
    };

    const scheduleDraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };

    // B-1: マウス座標を world 座標に逆変換し、ラベル → エッジの順でヒットテストする。
    const resolveHoverTopic = (clientX: number, clientY: number): string | null => {
      const rect = parent.getBoundingClientRect();
      const worldX = (clientX - rect.left - viewport.x) / viewport.zoom;
      const worldY = (clientY - rect.top - viewport.y) / viewport.zoom;

      for (const label of labelLayoutRef.current) {
        const top = label.labelY - label.height / 2;
        const bottom = label.labelY + label.height / 2;
        if (worldX >= label.labelLeft && worldX <= label.labelLeft + label.width && worldY >= top && worldY <= bottom) {
          return label.topic;
        }
      }

      const tolerance = edgeHoverHitTolerance / viewport.zoom;
      let nearestTopic: string | null = null;
      let nearest = tolerance;
      for (const edge of activeEdgesRef.current) {
        const distance = distanceToEdge(edge, worldX, worldY);
        if (distance <= nearest) {
          nearest = distance;
          nearestTopic = edge.topicName;
        }
      }
      return nearestTopic;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activeEdgesRef.current.length === 0) {
        if (hoverTopicRef.current !== null) {
          hoverTopicRef.current = null;
          scheduleDraw();
        }
        return;
      }
      const next = resolveHoverTopic(event.clientX, event.clientY);
      if (next !== hoverTopicRef.current) {
        hoverTopicRef.current = next;
        scheduleDraw();
      }
    };

    const handlePointerLeave = () => {
      if (hoverTopicRef.current !== null) {
        hoverTopicRef.current = null;
        scheduleDraw();
      }
    };

    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(parent);
    parent.addEventListener("pointermove", handlePointerMove);
    parent.addEventListener("pointerleave", handlePointerLeave);
    scheduleDraw();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      parent.removeEventListener("pointermove", handlePointerMove);
      parent.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [canvasEdges, frames, viewport.x, viewport.y, viewport.zoom]);

  return (
    <>
      <CanvasLayer ref={frameCanvasRef} $zIndex={canvasFramesZIndex} />
      <CanvasLayer ref={baseCanvasRef} $zIndex={canvasEdgesBaseZIndex} />
      <CanvasLayer ref={activeCanvasRef} $zIndex={canvasEdgesActiveZIndex} />
      <CanvasLayer ref={labelCanvasRef} $zIndex={canvasEdgesLabelZIndex} />
    </>
  );
}
