import { memo } from "react";
import styled from "@emotion/styled";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import * as tokens from "../lib/designTokens";
import type { FlowNodeData } from "../lib/graphLayout";
import { px } from "../styles/theme";

const fallbackClusterColor = tokens.clusterColors.other;

const AutowareNodeRoot = styled.div<{
  $isCluster: boolean;
  $connected: boolean;
  $selected: boolean;
  $dirty: boolean;
  $disabled: boolean;
  $added: boolean;
}>`
  width: ${({ $isCluster }) => px($isCluster ? tokens.categoryNodeWidth : tokens.autowareNodeWidth)};
  min-height: ${({ $isCluster }) => px($isCluster ? tokens.categoryNodeMinHeight : tokens.autowareNodeMinHeight)};
  position: relative;
  border-radius: ${px(tokens.radiusMd)};
  border: 1px solid ${tokens.borderDefault};
  background: ${tokens.bgElevated};
  box-shadow: ${tokens.shadowSm};
  overflow: hidden;
  transition:
    box-shadow 120ms ease,
    border-color 120ms ease;
  opacity: ${({ $disabled }) => ($disabled ? 0.45 : 1)};
  filter: ${({ $disabled }) => ($disabled ? "grayscale(0.5)" : "none")};

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

  ${({ $connected, $selected }) =>
    $connected && !$selected
      ? `
        border-color: ${tokens.accentBorder};
        box-shadow: 0 0 0 2px ${tokens.accentSoft}, ${tokens.shadowSm};
      `
      : ""}

  ${({ $dirty }) => ($dirty ? `border-color: ${tokens.warningBorder};` : "")}

  ${({ $disabled }) => ($disabled ? "border-style: dashed;" : "")}

  ${({ $added }) =>
    $added
      ? `
        border-color: ${tokens.accent};
        box-shadow: 0 0 0 3px ${tokens.accentSoft};
      `
      : ""}
`;

const NodeTitle = styled.div<{
  $split: boolean;
  $isCluster: boolean;
  $clusterColor?: string;
}>`
  min-height: ${({ $split }) => ($split ? "50px" : "32px")};
  padding: ${({ $split }) => ($split ? "8px 12px" : "9px 12px")};
  background: ${({ $isCluster, $clusterColor }) => {
    const mixAlpha = $isCluster ? tokens.clusterNodeTitleColorMixAlpha : tokens.nodeTitleCategoryColorMixAlpha;
    return `color-mix(in srgb, ${$clusterColor ?? fallbackClusterColor} ${mixAlpha}%, #ffffff)`;
  }};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${({ $isCluster }) => px($isCluster ? tokens.fontMd : tokens.fontSm)};
  font-weight: ${tokens.fontWeightBold};
  color: ${tokens.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: ${({ $split }) => ($split ? "normal" : "nowrap")};
  display: ${({ $split }) => ($split ? "flex" : "block")};
  flex-direction: ${({ $split }) => ($split ? "column" : "row")};
  gap: ${({ $split }) => ($split ? "3px" : 0)};
  border-bottom: 1px solid ${tokens.borderSubtle};
`;

const NodeNamespace = styled.span`
  color: ${tokens.textMuted};
  font-size: 10px;
  font-weight: ${tokens.fontWeightSemiBold};
  line-height: 1.3;
  overflow-wrap: anywhere;
`;

const NodeLeaf = styled.span`
  color: ${tokens.textPrimary};
  font-size: ${px(tokens.fontSm)};
  font-weight: ${tokens.fontWeightBold};
  line-height: 1.3;
  overflow-wrap: anywhere;
`;

const NodeMeta = styled.div`
  padding: 8px 12px 4px;
  color: ${tokens.textSecondary};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
`;

const NodeMetrics = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 10px 9px;
  border-top: 1px solid ${tokens.borderSubtle};
`;

const NodeMetric = styled.span<{ $active: boolean; $variant?: "swap" | "static" | "dynamic" }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  height: 22px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusSm)};
  background: ${tokens.bgInset};
  color: ${({ $active }) => ($active ? tokens.textPrimary : tokens.textMuted)};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;

  strong {
    color: ${tokens.textPrimary};
    font-size: ${px(tokens.fontSm)};
    line-height: 1;
  }

  ${({ $active, $variant }) => {
    if (!$active || !$variant) return "";
    if ($variant === "swap") {
      return `
        border-color: ${tokens.infoBorder};
        background: ${tokens.infoSoft};
        color: ${tokens.infoText};

        strong {
          color: ${tokens.infoText};
        }
      `;
    }
    if ($variant === "static") {
      return `
        border-color: ${tokens.warningBorder};
        background: ${tokens.warningSoft};
        color: ${tokens.warningText};

        strong {
          color: ${tokens.warningText};
        }
      `;
    }
    return `
      border-color: ${tokens.accentBorder};
      background: ${tokens.accentSoft};
      color: ${tokens.accentText};

      strong {
        color: ${tokens.accentText};
      }
    `;
  }}
`;

const NodeHint = styled.div`
  padding: 4px 12px 10px;
  color: ${tokens.textMuted};
  font-size: ${px(tokens.fontXs)};
`;

const NodeDirty = styled.div`
  padding: 0 12px 10px;
  color: ${tokens.warningText};
  font-size: ${px(tokens.fontXs)};
  font-weight: 600;
`;

const NodeBadge = styled.div<{ $variant: "disabled" | "added" }>`
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: ${px(tokens.radiusPill)};
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: ${({ $variant }) => ($variant === "disabled" ? tokens.dangerSoft : tokens.accentSoft)};
  color: ${({ $variant }) => ($variant === "disabled" ? tokens.dangerText : tokens.accentText)};
`;

function splitNodeName(label: string): { namespace: string; leaf: string } {
  const parts = label.split("/").filter(Boolean);
  if (parts.length <= 1) return { namespace: "", leaf: label };
  return {
    namespace: `/${parts.slice(0, -1).join("/")}`,
    leaf: parts.at(-1) ?? label
  };
}

function AutowareNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const splitName = splitNodeName(nodeData.label);
  const showSplitName = !nodeData.isCluster && splitName.namespace;
  const swapCount = nodeData.swappableCount ?? (nodeData.swappable ? 1 : 0);
  const staticParamCount = nodeData.staticParamCount ?? 0;
  const dynamicParamCount = nodeData.dynamicParamCount ?? 0;

  return (
    <AutowareNodeRoot
      $isCluster={Boolean(nodeData.isCluster)}
      $connected={Boolean(nodeData.connected)}
      $selected={selected}
      $dirty={Boolean(nodeData.dirty)}
      $disabled={Boolean(nodeData.disabled)}
      $added={Boolean(nodeData.isAdded)}
    >
      <Handle type="target" position={Position.Left} />
      <NodeTitle
        $split={Boolean(showSplitName)}
        $isCluster={Boolean(nodeData.isCluster)}
        $clusterColor={nodeData.clusterColor}
      >
        {showSplitName ? (
          <>
            <NodeNamespace>{splitName.namespace}</NodeNamespace>
            <NodeLeaf>{splitName.leaf}</NodeLeaf>
          </>
        ) : (
          nodeData.label
        )}
      </NodeTitle>
      <NodeMeta>{nodeData.isCluster ? `${nodeData.memberCount ?? 0} nodes` : nodeData.inOut}</NodeMeta>
      <NodeMetrics aria-label={`node metrics: ${swapCount} swaps, ${staticParamCount} static parameters, ${dynamicParamCount} dynamic parameters`}>
        <NodeMetric $active={swapCount > 0} $variant="swap">
          SW <strong>{swapCount}</strong>
        </NodeMetric>
        <NodeMetric $active={staticParamCount > 0} $variant="static">
          P <strong>{staticParamCount}</strong>
        </NodeMetric>
        <NodeMetric $active={dynamicParamCount > 0} $variant="dynamic">
          D <strong>{dynamicParamCount}</strong>
        </NodeMetric>
      </NodeMetrics>
      {nodeData.isCluster ? <NodeHint>click to show nodes</NodeHint> : null}
      {nodeData.dirty ? <NodeDirty>param override</NodeDirty> : null}
      {nodeData.disabled ? <NodeBadge $variant="disabled">disabled</NodeBadge> : null}
      {nodeData.isAdded ? <NodeBadge $variant="added">added</NodeBadge> : null}
      <Handle type="source" position={Position.Right} />
    </AutowareNodeRoot>
  );
}

export const AutowareNode = memo(AutowareNodeComponent);
