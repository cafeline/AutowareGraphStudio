import { useRef } from "react";
import styled from "@emotion/styled";
import * as tokens from "../lib/designTokens";
import { useGraphStore } from "../stores/graphStore";
import { px } from "../styles/theme";

const LaunchSidePanel = styled.aside`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  border-right: 1px solid ${tokens.borderSubtle};
  background: ${tokens.bgElevated};
`;

const LaunchSidePanelScroll = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 16px;

  h2,
  h3 {
    margin: 0;
  }

  h2 {
    font-size: ${px(tokens.fontLg)};
  }

  h3 {
    color: ${tokens.textSecondary};
    font-size: ${px(tokens.fontSm)};
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;

const LaunchCollapseTab = styled.button`
  position: absolute;
  z-index: 12;
  top: 50%;
  right: -14px;
  width: 28px;
  height: 56px;
  padding: 0;
  transform: translateY(-50%);
  border: 1px solid ${tokens.borderDefault};
  border-left-color: ${tokens.borderSubtle};
  border-radius: 0 ${px(tokens.radiusMd)} ${px(tokens.radiusMd)} 0;
  background: ${tokens.bgElevated};
  box-shadow: ${tokens.shadowMd};
  color: ${tokens.textSecondary};
  font-size: 22px;
  font-weight: 600;
  line-height: 1;

  &:hover:not(:disabled) {
    background: ${tokens.bgHover};
    color: ${tokens.textPrimary};
  }

  &:focus-visible {
    outline: 2px solid ${tokens.accent};
    outline-offset: 2px;
  }
`;

const LaunchSidePanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;

  span {
    color: ${tokens.textMuted};
    font-size: ${px(tokens.fontSm)};
  }
`;

const LaunchPanelSection = styled.section`
  display: grid;
  min-width: 0;
  gap: 10px;
  padding-bottom: 16px;
  border-bottom: 1px solid ${tokens.borderSubtle};

  &:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
`;

const LaunchFilePicker = styled.div`
  display: grid;
  gap: 8px;
  width: 100%;
`;

const LaunchFileInput = styled.input`
  display: none;
`;

const LaunchFileSummary = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;
  color: ${tokens.textPrimary};

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: ${tokens.textMuted};
    font-size: ${px(tokens.fontSm)};
  }
`;

const LaunchArgs = styled.div`
  display: grid;
  gap: 10px;
`;

const RuntimeLockNotice = styled.div`
  padding: 8px 10px;
  border: 1px solid ${tokens.infoBorder};
  border-radius: ${px(tokens.radiusMd)};
  background: ${tokens.infoSoft};
  color: ${tokens.infoText};
  font-size: ${px(tokens.fontSm)};
  line-height: 1.35;
`;

const ArgField = styled.label`
  display: grid;
  min-width: 0;
  gap: 5px;
  color: ${tokens.textSecondary};
  font-size: ${px(tokens.fontSm)};

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    min-height: 36px;
  }
`;

function inferredLaunchRoot(path: string): string {
  const absolute = path.startsWith("/");
  const segments = path.split("/").filter(Boolean);
  const srcIndex = segments.lastIndexOf("src");
  if (srcIndex >= 0) return `${absolute ? "/" : ""}${segments.slice(0, srcIndex + 1).join("/")}`;
  const installIndex = segments.lastIndexOf("install");
  if (installIndex >= 0) return `${absolute ? "/" : ""}${segments.slice(0, installIndex + 1).join("/")}`;
  return "";
}

function splitLaunchPath(path: string, sourceRoot: string) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? "No launch selected";
  const dir = path.slice(0, Math.max(0, path.length - fileName.length - 1));
  const displayRoot = sourceRoot && dir.startsWith(sourceRoot) ? sourceRoot : inferredLaunchRoot(path);
  const relativeDir = displayRoot && dir.startsWith(displayRoot)
    ? dir.slice(displayRoot.length).replace(/^\/+/, "")
    : dir;
  return { fileName, dir: relativeDir || dir || "No directory" };
}

type LaunchSetupPanelProps = {
  onSelectLaunch: (path: string | null) => void;
  onHide: () => void;
};

export function LaunchSetupPanel({ onSelectLaunch, onHide }: LaunchSetupPanelProps) {
  const {
    sourceRoot,
    entryLaunch,
    graphSource,
    setEntryLaunch,
    launchArgSpecs,
    launchArgValues,
    setLaunchArgValue,
    loadGraph,
    reloadWithComposition
  } = useGraphStore();
  const launchInputRef = useRef<HTMLInputElement | null>(null);
  const safeLaunchArgSpecs = launchArgSpecs ?? [];
  const safeLaunchArgValues = launchArgValues ?? {};
  const launchArgsLocked = graphSource === "runtime";
  const launchDisplay = splitLaunchPath(entryLaunch, sourceRoot);
  const selectLaunchPath = async (path: string) => {
    await setEntryLaunch(path);
    onSelectLaunch(null);
    await loadGraph();
  };

  return (
    <LaunchSidePanel>
      <LaunchCollapseTab type="button" aria-label="Hide launch setup" title="Hide launch setup" onClick={onHide}>
        ‹
      </LaunchCollapseTab>
      <LaunchSidePanelScroll>
        <LaunchSidePanelHeader>
          <div>
            <h2>Launch Setup</h2>
            <span>launch arguments</span>
          </div>
        </LaunchSidePanelHeader>

        <LaunchPanelSection>
          <h3>Selected Launch</h3>
          <LaunchFilePicker>
            <button type="button" aria-label="Choose Launch..." onClick={() => launchInputRef.current?.click()}>
              Choose Launch...
            </button>
            <LaunchFileInput
              ref={launchInputRef}
              aria-label="launch_file_picker"
              type="file"
              accept=".xml"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                const path = window.api.pathForFile(file);
                if (path) void selectLaunchPath(path);
                else void useGraphStore.getState().chooseEntryLaunch();
                event.currentTarget.value = "";
              }}
            />
            <LaunchFileSummary title={entryLaunch}>
              <strong>{launchDisplay.fileName}</strong>
              <span>{launchDisplay.dir}</span>
            </LaunchFileSummary>
          </LaunchFilePicker>
        </LaunchPanelSection>

        {safeLaunchArgSpecs.length > 0 ? (
          <LaunchPanelSection>
            <h3>Launch Args</h3>
            {launchArgsLocked ? (
              <RuntimeLockNotice>
                Launch args are locked while synced from running ROS. Disconnect runtime before changing them.
              </RuntimeLockNotice>
            ) : null}
            <LaunchArgs>
              {safeLaunchArgSpecs.map((arg) => (
                <ArgField key={arg.name}>
                  <span>{arg.name}</span>
                  {arg.inputKind === "select" ? (
                    <select
                      aria-label={`arg:${arg.name}`}
                      value={safeLaunchArgValues[arg.name] ?? arg.defaultValue}
                      disabled={launchArgsLocked}
                      onChange={(event) => {
                        // Discrete choice: re-evaluate the launch immediately.
                        setLaunchArgValue(arg.name, event.target.value);
                        void reloadWithComposition();
                      }}
                    >
                      {arg.choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                      {!arg.choices.includes(safeLaunchArgValues[arg.name] ?? arg.defaultValue) ? (
                        <option value={safeLaunchArgValues[arg.name] ?? arg.defaultValue}>
                          {safeLaunchArgValues[arg.name] ?? arg.defaultValue}
                        </option>
                      ) : null}
                    </select>
                  ) : (
                    <input
                      aria-label={`arg:${arg.name}`}
                      value={safeLaunchArgValues[arg.name] ?? arg.defaultValue}
                      disabled={launchArgsLocked}
                      onChange={(event) => setLaunchArgValue(arg.name, event.target.value)}
                      // Free text: re-evaluate on commit (blur / Enter), not per keystroke.
                      onBlur={() => void reloadWithComposition()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  )}
                </ArgField>
              ))}
            </LaunchArgs>
          </LaunchPanelSection>
        ) : null}
      </LaunchSidePanelScroll>
    </LaunchSidePanel>
  );
}
