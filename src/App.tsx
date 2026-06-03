import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { GraphView } from "./components/GraphView";
import { LaunchSetupPanel } from "./components/LaunchSetupPanel";
import { LaunchGraphView } from "./components/LaunchGraphView";
import { PropertyPanel } from "./components/PropertyPanel";
import { TopToolbar } from "./components/TopToolbar";
import * as tokens from "./lib/designTokens";
import { useGraphStore } from "./stores/graphStore";
import { GlobalStyles } from "./styles/GlobalStyles";
import { px } from "./styles/theme";

type GraphMode = "topic" | "launch";

const AppShell = styled.div`
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: ${tokens.bgSubtle};
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
`;

const MainLayout = styled.main<{ $launchPanelOpen: boolean; $detailsOpen: boolean }>`
  position: relative;
  min-height: 0;
  display: grid;
  grid-template-columns: ${({ $launchPanelOpen, $detailsOpen }) => {
    if (!$launchPanelOpen && !$detailsOpen) return "minmax(0, 1fr)";
    if (!$launchPanelOpen) return "minmax(0, 70%) minmax(360px, 30%)";
    if (!$detailsOpen) return "320px minmax(0, 1fr)";
    return "320px minmax(0, 1fr) minmax(360px, 30%)";
  }};
`;

const GraphShell = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  background: ${tokens.bgSubtle};

  > section {
    grid-area: 1 / 1;
  }
`;

const GraphModeToggle = styled.div`
  position: absolute;
  z-index: 9;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusMd)};
  background: ${tokens.bgElevated};
  box-shadow: ${tokens.shadowMd};
`;

const GraphModeButton = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  font-size: ${px(tokens.fontSm)};
  border-color: ${({ $active }) => ($active ? tokens.accent : "transparent")};
  background: ${({ $active }) => ($active ? tokens.accentSoft : "transparent")};
  color: ${({ $active }) => ($active ? tokens.accentText : tokens.textPrimary)};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? tokens.accentSoft : tokens.bgHover)};
  }
`;

const LaunchExpandTab = styled.button`
  position: absolute;
  z-index: 12;
  top: 50%;
  left: 0;
  width: 28px;
  height: 56px;
  padding: 0;
  transform: translateY(-50%);
  border: 1px solid ${tokens.borderDefault};
  border-left: 0;
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

const DetailsExpandTab = styled.button`
  position: absolute;
  z-index: 12;
  top: 50%;
  right: 0;
  width: 28px;
  height: 56px;
  padding: 0;
  transform: translateY(-50%);
  border: 1px solid ${tokens.borderDefault};
  border-right: 0;
  border-radius: ${px(tokens.radiusMd)} 0 0 ${px(tokens.radiusMd)};
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

export function App() {
  const [launchPanelOpen, setLaunchPanelOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [graphMode, setGraphMode] = useState<GraphMode>("topic");
  const [selectedLaunchPath, setSelectedLaunchPath] = useState<string | null>(null);
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    const { entryLaunch, graphSource, setEntryLaunch, loadGraph } = useGraphStore.getState();
    if (graphSource === "runtime") return;
    if (!entryLaunch.trim()) return;
    autoLoadedRef.current = true;
    void (async () => {
      await setEntryLaunch(entryLaunch);
      await loadGraph();
    })();
  }, []);
  return (
    <AppShell>
      <GlobalStyles />
      <TopToolbar />
      <MainLayout $launchPanelOpen={launchPanelOpen} $detailsOpen={detailsOpen}>
        {launchPanelOpen ? (
          <LaunchSetupPanel
            onSelectLaunch={setSelectedLaunchPath}
            onHide={() => setLaunchPanelOpen(false)}
          />
        ) : null}
        <GraphShell>
          <GraphModeToggle aria-label="Graph mode">
            <GraphModeButton
              type="button"
              $active={graphMode === "topic"}
              onClick={() => setGraphMode("topic")}
            >
              Topic Graph
            </GraphModeButton>
            <GraphModeButton
              type="button"
              $active={graphMode === "launch"}
              onClick={() => setGraphMode("launch")}
            >
              Launch Graph
            </GraphModeButton>
          </GraphModeToggle>
          {graphMode === "topic" ? (
            <GraphView />
          ) : (
            <LaunchGraphView selectedLaunchPath={selectedLaunchPath} onSelectLaunch={setSelectedLaunchPath} />
          )}
        </GraphShell>
        {detailsOpen ? (
          <PropertyPanel
            mode={graphMode}
            selectedLaunchPath={selectedLaunchPath}
            onHide={() => setDetailsOpen(false)}
          />
        ) : null}
        {!launchPanelOpen ? (
          <LaunchExpandTab
            type="button"
            aria-label="Show launch setup"
            title="Show launch setup"
            onClick={() => setLaunchPanelOpen(true)}
          >
            ›
          </LaunchExpandTab>
        ) : null}
        {!detailsOpen ? (
          <DetailsExpandTab
            type="button"
            aria-label="Show details"
            title="Show details"
            onClick={() => setDetailsOpen(true)}
          >
            ‹
          </DetailsExpandTab>
        ) : null}
      </MainLayout>
    </AppShell>
  );
}
