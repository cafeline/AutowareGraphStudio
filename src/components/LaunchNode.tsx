import { memo, useLayoutEffect, useRef } from "react";
import styled from "@emotion/styled";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import * as tokens from "../lib/designTokens";
import type { LaunchFileNode, LaunchStatus } from "../lib/graphModel";
import { px } from "../styles/theme";

export type LaunchNodeData = LaunchFileNode & {
  selected?: boolean;
  onMeasure?: (path: string, size: { width: number; height: number }) => void;
};

const LaunchNodeRoot = styled.div<{
  $hasRosNodes: boolean;
  $selected: boolean;
  $status?: LaunchStatus;
}>`
  width: 300px;
  min-height: 136px;
  border: 1px solid ${({ $hasRosNodes }) => ($hasRosNodes ? tokens.accentBorder : tokens.borderDefault)};
  border-radius: ${px(tokens.radiusMd)};
  background: ${({ $hasRosNodes }) => ($hasRosNodes ? tokens.bgElevated : tokens.bgSubtle)};
  box-shadow: ${tokens.shadowSm};
  overflow: hidden;
  transition:
    box-shadow 120ms ease,
    border-color 120ms ease;
  opacity: ${({ $status }) => ($status === "ghost" ? 0.45 : 1)};
  border-style: ${({ $status }) => ($status === "ghost" ? "dashed" : "solid")};
  filter: ${({ $status }) => ($status === "ghost" ? "grayscale(0.6)" : "none")};

  &:hover {
    box-shadow: ${tokens.shadowMd};
  }

  ${({ $selected }) =>
    $selected
      ? `
        border-color: ${tokens.accent};
        box-shadow: 0 0 0 3px ${tokens.accentSoft}, ${tokens.shadowMd};
      `
      : ""}

  ${({ $status }) =>
    $status === "provisional"
      ? `
        border-color: ${tokens.accent};
        box-shadow: 0 0 0 3px ${tokens.accentSoft};
      `
      : ""}

  ${({ $status }) => ($status === "overridden" ? `border-color: ${tokens.warning};` : "")}
`;

const LaunchNodeTitle = styled.div<{ $hasRosNodes: boolean }>`
  min-height: 36px;
  padding: 10px 12px;
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
  font-weight: ${tokens.fontWeightBold};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid ${tokens.borderSubtle};
  background: ${({ $hasRosNodes }) => ($hasRosNodes ? tokens.accentSoft : tokens.bgInset)};
  color: ${({ $hasRosNodes }) => ($hasRosNodes ? tokens.accentText : tokens.textSecondary)};

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const LaunchStatusBadge = styled.span<{ $status: LaunchStatus }>`
  font-size: 10px;
  padding: 2px 8px;
  border-radius: ${px(tokens.radiusPill)};
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin-left: 6px;
  background: ${({ $status }) => {
    if ($status === "provisional") return tokens.accentSoft;
    if ($status === "overridden") return tokens.warningSoft;
    return tokens.bgInset;
  }};
  color: ${({ $status }) => {
    if ($status === "provisional") return tokens.accentText;
    if ($status === "overridden") return tokens.warningText;
    return tokens.textMuted;
  }};
`;

const LaunchNodeCountBadge = styled.div`
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid ${tokens.accentBorder};
  border-radius: ${px(tokens.radiusPill)};
  background: ${tokens.bgElevated};
  color: ${tokens.accentText};

  strong {
    font-size: ${px(tokens.fontSm)};
    font-weight: 700;
  }

  small {
    color: ${tokens.textMuted};
    font-size: 9px;
  }
`;

const LaunchNodeMeta = styled.div`
  padding: 10px 12px 0;
  color: ${tokens.textSecondary};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
`;

const LaunchNodeCounts = styled.div`
  display: flex;
  gap: 8px;
  padding: 10px 12px 0;
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
`;

const CountPill = styled.span<{ $active: boolean; $variant: "direct" | "total" }>`
  padding: 4px 8px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusSm)};
  color: ${tokens.textMuted};
  background: ${tokens.bgInset};

  ${({ $active, $variant }) => {
    if (!$active) return "";
    if ($variant === "direct") {
      return `
        border-color: ${tokens.infoBorder};
        color: ${tokens.infoText};
        background: ${tokens.infoSoft};
      `;
    }
    return `
      border-color: ${tokens.accentBorder};
      color: ${tokens.accentText};
      background: ${tokens.accentSoft};
    `;
  }}
`;

const LaunchNodeSection = styled.div`
  padding: 10px 12px 12px;
`;

const LaunchNodeList = styled.div`
  max-height: 132px;
  padding: 6px 8px;
  overflow: auto;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusSm)};
  background: ${tokens.bgInset};
`;

const LaunchNodeListItem = styled.div`
  padding: 3px 0;
  color: ${tokens.textPrimary};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontXs)};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

function LaunchNodeComponent({ data, selected }: NodeProps) {
  const launch = data as unknown as LaunchNodeData;
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const hasRosNodes = launch.totalNodeCount > 0;
  const hasDirectRosNodes = launch.nodeNames.length > 0;

  useLayoutEffect(() => {
    const element = nodeRef.current;
    if (!element || !launch.onMeasure) return;

    const reportSize = () => {
      launch.onMeasure?.(launch.path, { width: element.offsetWidth, height: element.offsetHeight });
    };
    reportSize();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [launch.onMeasure, launch.path, launch.nodeNames.length]);

  return (
    <LaunchNodeRoot
      ref={nodeRef}
      className={`launch-node ${hasRosNodes ? "has-ros-nodes" : "no-ros-nodes"} ${selected || launch.selected ? "selected" : ""} ${launch.status ? `launch-status-${launch.status}` : ""}`}
      $hasRosNodes={hasRosNodes}
      $selected={selected || Boolean(launch.selected)}
      $status={launch.status}
    >
      <Handle type="target" position={Position.Left} />
      <LaunchNodeTitle className={`launch-node ${hasRosNodes ? "has-ros-nodes" : "no-ros-nodes"}`} $hasRosNodes={hasRosNodes}>
        <span>{launch.label}</span>
        {launch.status && launch.status !== "original" ? (
          <LaunchStatusBadge $status={launch.status}>{launch.status}</LaunchStatusBadge>
        ) : null}
        <LaunchNodeCountBadge aria-label={`${launch.totalNodeCount} total nodes`}>
          <strong>{launch.totalNodeCount}</strong>
          <small>total</small>
        </LaunchNodeCountBadge>
      </LaunchNodeTitle>
      <LaunchNodeMeta>
        {launch.includePaths.length} includes
      </LaunchNodeMeta>
      <LaunchNodeCounts>
        <CountPill $active={hasDirectRosNodes} $variant="direct">direct {launch.nodeNames.length}</CountPill>
        <CountPill $active={hasRosNodes} $variant="total">total {launch.totalNodeCount}</CountPill>
      </LaunchNodeCounts>
      <LaunchNodeMeta>
        {launch.argNames.length} args / {launch.paramFiles.length} param files
      </LaunchNodeMeta>
      {hasDirectRosNodes ? (
        <LaunchNodeSection className="nodrag nopan">
          <LaunchNodeList aria-label={`ROS nodes in ${launch.label}`}>
            {launch.nodeNames.map((nodeName) => (
              <LaunchNodeListItem key={nodeName}>
                {nodeName}
              </LaunchNodeListItem>
            ))}
          </LaunchNodeList>
        </LaunchNodeSection>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </LaunchNodeRoot>
  );
}

export const LaunchNode = memo(LaunchNodeComponent);
