import styled from "@emotion/styled";
import { useEffect } from "react";
import { buildDraftChanges, draftSignature } from "../lib/draftChanges";
import * as tokens from "../lib/designTokens";
import { useGraphStore } from "../stores/graphStore";
import { px } from "../styles/theme";

const Toolbar = styled.header`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid ${tokens.borderSubtle};
  background: ${tokens.bgElevated};
`;

const ToolbarActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
`;

const ToolbarBrand = styled.div`
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  align-items: center;
  gap: 10px;
`;

const GraphSourceBadge = styled.span<{ $source: "static" | "runtime" }>`
  padding: 2px 10px;
  border-radius: ${px(tokens.radiusPill)};
  background: ${({ $source }) => ($source === "runtime" ? tokens.infoSoft : tokens.accentSoft)};
  color: ${({ $source }) => ($source === "runtime" ? tokens.infoText : tokens.accentText)};
  font-size: ${px(tokens.fontXs)};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const ToolbarActionGroup = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const ToolbarOptions = styled(ToolbarActionGroup)`
  margin-left: auto;

  @media (max-width: 900px) {
    margin-left: 0;
  }
`;

const ToolbarCheck = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${tokens.textSecondary};
  font-size: ${px(tokens.fontSm)};
  white-space: nowrap;

  input {
    margin: 0;
    accent-color: ${tokens.accent};
  }
`;

const OutputRootControl = styled.div`
  display: flex;
  flex: 1 1 340px;
  min-width: 260px;
  max-width: 560px;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusMd)};
  background: ${tokens.bgInset};
`;

const OutputRootLabel = styled.span`
  flex: 0 0 auto;
  color: ${tokens.textSecondary};
  font-size: ${px(tokens.fontSm)};
  font-weight: 600;
`;

const OutputRootPath = styled.span`
  flex: 1 1 auto;
  min-width: 80px;
  overflow: hidden;
  color: ${tokens.textMuted};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontXs)};
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CompactButton = styled.button`
  flex: 0 0 auto;
  min-height: 30px;
  padding: 5px 9px;
`;


const SyncRuntimeButton = styled.button<{ $active: boolean }>`
  border-color: ${({ $active }) => ($active ? tokens.warning : tokens.info)};
  background: ${({ $active }) => ($active ? tokens.warningSoft : tokens.infoSoft)};
  color: ${({ $active }) => ($active ? tokens.warningText : tokens.infoText)};
  font-weight: 600;

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? tokens.warningSoft : tokens.infoSoft)};
    border-color: ${({ $active }) => ($active ? tokens.warning : tokens.info)};
    filter: brightness(0.96);
  }
`;

const Status = styled.span`
  flex: 1 1 280px;
  min-width: 220px;
  color: ${tokens.textMuted};
  font-size: ${px(tokens.fontSm)};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DraftPanel = styled.section<{ $saved: boolean }>`
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid ${({ $saved }) => ($saved ? tokens.accentBorder : tokens.warningBorder)};
  border-radius: ${px(tokens.radiusMd)};
  background: ${({ $saved }) => ($saved ? tokens.accentSoft : tokens.warningSoft)};
`;

const DraftHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;

  strong {
    color: ${tokens.textPrimary};
    font-size: ${px(tokens.fontSm)};
  }

  span {
    color: ${tokens.textSecondary};
    font-size: ${px(tokens.fontSm)};
  }

  div {
    margin-left: auto;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
`;

const DraftList = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const DraftItem = styled.li`
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 8px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusPill)};
  background: ${tokens.bgElevated};
  color: ${tokens.textSecondary};
  font-size: ${px(tokens.fontXs)};

  strong {
    color: ${tokens.textPrimary};
    font-weight: 600;
  }
`;

function outputRootDisplay(outputRoot: string, defaultOutputRoot: string): string {
  return outputRoot || defaultOutputRoot || "Default output";
}

export function TopToolbar() {
  const {
    syncFromRuntime,
    disconnectRuntime,
    graphSource,
    advancedTopics,
    setAdvancedTopics,
    showUnusedNodes,
    setShowUnusedNodes,
    apply,
    pendingOverrides,
    pendingTopicOverrides,
    dynamicTuningSession,
    launchArgSpecs,
    launchArgValues,
    outputRoot,
    defaultOutputRoot,
    chooseOutputRoot,
    resetOutputRoot,
    loadDefaultOutputRoot,
    lastSavedDraftSignature,
    resetDraft,
    composition,
    status
  } = useGraphStore();
  const draftChanges = buildDraftChanges({
    launchArgSpecs,
    launchArgValues,
    composition,
    pendingOverrides,
    pendingTopicOverrides,
    dynamicTuningSession
  });
  const currentDraftSignature = draftSignature({
    launchArgSpecs,
    launchArgValues,
    composition,
    pendingOverrides,
    pendingTopicOverrides,
    dynamicTuningSession
  });
  const hasDraftChanges = draftChanges.length > 0;
  const hasUnsavedChanges = hasDraftChanges && currentDraftSignature !== lastSavedDraftSignature;
  const visibleDraftChanges = draftChanges.slice(0, 6);
  const isRuntime = graphSource === "runtime";
  const displayedOutputRoot = outputRootDisplay(outputRoot, defaultOutputRoot);

  useEffect(() => {
    void loadDefaultOutputRoot();
  }, [loadDefaultOutputRoot]);

  return (
    <Toolbar>
      <ToolbarActions>
        <ToolbarBrand>
          <GraphSourceBadge $source={graphSource}>{graphSource}</GraphSourceBadge>
        </ToolbarBrand>
        <ToolbarActionGroup>
          <SyncRuntimeButton
            type="button"
            $active={isRuntime}
            onClick={() => {
              if (isRuntime) {
                disconnectRuntime();
                return;
              }
              void syncFromRuntime();
            }}
          >
            {isRuntime ? "Disconnect runtime" : "Sync from running ROS"}
          </SyncRuntimeButton>
        </ToolbarActionGroup>
        <ToolbarOptions>
          <ToolbarCheck>
            <input
              type="checkbox"
              checked={advancedTopics}
              onChange={(event) => setAdvancedTopics(event.target.checked)}
            />
            Advanced Topics
          </ToolbarCheck>
          <ToolbarCheck>
            <input
              type="checkbox"
              checked={showUnusedNodes}
              onChange={(event) => setShowUnusedNodes(event.target.checked)}
            />
            Show Unused Nodes
          </ToolbarCheck>
        </ToolbarOptions>
        <OutputRootControl>
          <OutputRootLabel>Output</OutputRootLabel>
          <OutputRootPath title={displayedOutputRoot}>{displayedOutputRoot}</OutputRootPath>
          <CompactButton type="button" aria-label="Choose output folder" onClick={() => void chooseOutputRoot()}>
            Choose...
          </CompactButton>
          <CompactButton type="button" aria-label="Reset output folder" disabled={!outputRoot} onClick={() => resetOutputRoot()}>
            Reset
          </CompactButton>
        </OutputRootControl>
        <ToolbarActionGroup>
          <button disabled={!hasUnsavedChanges} onClick={() => void apply()}>
            Save
          </button>
        </ToolbarActionGroup>
        <Status>{status}</Status>
      </ToolbarActions>
      {hasDraftChanges ? (
        <DraftPanel $saved={!hasUnsavedChanges} aria-label="Draft changes">
          <DraftHeader>
            <strong>{hasUnsavedChanges ? "Unsaved changes" : "Saved changes"} ({draftChanges.length})</strong>
            <span>{hasUnsavedChanges ? "Save writes them to latest." : "Already saved to latest."}</span>
            <div>
              <button type="button" disabled={!hasUnsavedChanges} onClick={() => void apply()}>
                Save
              </button>
              <button type="button" disabled={isRuntime} onClick={() => resetDraft()}>
                Reset all
              </button>
            </div>
          </DraftHeader>
          <DraftList>
            {visibleDraftChanges.map((change) => (
              <DraftItem key={change.id} title={`${change.label}: ${change.detail}`}>
                <strong>{change.label}</strong>: {change.detail}
              </DraftItem>
            ))}
            {draftChanges.length > visibleDraftChanges.length ? (
              <DraftItem>+{draftChanges.length - visibleDraftChanges.length} more</DraftItem>
            ) : null}
          </DraftList>
        </DraftPanel>
      ) : null}
    </Toolbar>
  );
}
