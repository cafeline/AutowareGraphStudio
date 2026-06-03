import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import styled from "@emotion/styled";
import * as tokens from "../lib/designTokens";
import { isCompositionDirty } from "../lib/composition";
import type { Parameter, Pin } from "../lib/graphModel";
import { isHiddenTopic } from "../lib/parser";
import { useGraphStore } from "../stores/graphStore";
import { px } from "../styles/theme";

const PropertyPanelRoot = styled.aside`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  background: ${tokens.bgElevated};
  border-left: 1px solid ${tokens.borderSubtle};

  h2 {
    margin: 0 0 6px;
    font-size: ${px(tokens.fontXl)};
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  h3 {
    margin: 20px 0 10px;
    font-size: ${px(tokens.fontSm)};
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${tokens.textSecondary};
  }
`;

const PropertyPanelScroll = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 18px 20px;
`;

const DetailsCollapseTab = styled.button`
  position: absolute;
  z-index: 12;
  top: 50%;
  left: -14px;
  width: 28px;
  height: 56px;
  padding: 0;
  transform: translateY(-50%);
  border: 1px solid ${tokens.borderDefault};
  border-right-color: ${tokens.borderSubtle};
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

const Subtle = styled.div`
  color: ${tokens.textMuted};
  font-size: ${px(tokens.fontSm)};
  overflow-wrap: anywhere;
`;

const DetailLine = styled.div`
  padding: 5px 0;
  color: ${tokens.textPrimary};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
  overflow-wrap: anywhere;
`;

const TabBar = styled.div`
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid ${tokens.borderSubtle};
`;

const TabButton = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 8px 10px;
  border: 0;
  border-bottom: 2px solid ${({ $active }) => ($active ? tokens.accent : "transparent")};
  border-radius: 0;
  background: transparent;
  color: ${({ $active }) => ($active ? tokens.accentText : tokens.textSecondary)};
  font-size: ${px(tokens.fontSm)};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};

  &:hover:not(:disabled) {
    color: ${tokens.textPrimary};
    background: ${tokens.bgHover};
  }
`;

const PanelTitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;

  h2,
  h3 {
    min-width: 0;
  }
`;

const CountBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusPill)};
  background: ${tokens.bgInset};
  color: ${tokens.textSecondary};
  font-size: ${px(tokens.fontXs)};
  font-weight: 600;
  white-space: nowrap;
`;

const StickyTools = styled.div`
  position: sticky;
  z-index: 4;
  top: -18px;
  margin: 0 -20px 12px;
  padding: 0 20px 12px;
  background: linear-gradient(${tokens.bgElevated} 78%, rgba(255, 255, 255, 0));
`;

const SectionHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 18px 0 8px;

  h3 {
    margin: 0;
  }
`;

const CompositionActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
`;

const CompositionBox = styled.section`
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusMd)};
  padding: 12px;
  margin-bottom: 12px;
  background: ${tokens.bgInset};

  h3 {
    margin-top: 0;
  }
`;

const SwitchBox = styled.section<{ $embedded?: boolean }>`
  border: ${({ $embedded }) => ($embedded ? "0" : `1px solid ${tokens.borderSubtle}`)};
  border-radius: ${px(tokens.radiusMd)};
  padding: ${({ $embedded }) => ($embedded ? "0" : "12px")};
  margin: ${({ $embedded }) => ($embedded ? "12px 0 0" : "0 0 12px")};
  background: ${({ $embedded }) => ($embedded ? "transparent" : tokens.bgInset)};

  h3 {
    margin: ${({ $embedded }) => ($embedded ? "10px 0" : "0 0 10px")};
  }
`;

const SwapField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
`;

const CompositionAdd = styled(CompositionBox)`
  input {
    width: 100%;
    margin-bottom: 8px;
  }
`;

const NodeToggleButton = styled.button<{ $nodeDisabled: boolean }>`
  width: 100%;
  margin-bottom: 8px;
  background: ${({ $nodeDisabled }) => ($nodeDisabled ? tokens.dangerSoft : tokens.bgElevated)};
  color: ${({ $nodeDisabled }) => ($nodeDisabled ? tokens.dangerText : tokens.textPrimary)};
  border-color: ${({ $nodeDisabled }) => ($nodeDisabled ? tokens.dangerBorder : tokens.borderDefault)};
`;

const AddedList = styled.div``;

const CollapsibleSectionRoot = styled.section`
  margin-top: 18px;
`;

const SectionToggle = styled.button`
  width: 100%;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-color: transparent;
  background: transparent;
  text-align: left;

  &:hover:not(:disabled) {
    border-color: ${tokens.borderSubtle};
    background: ${tokens.bgHover};
  }

  strong {
    color: ${tokens.textPrimary};
    font-size: ${px(tokens.fontMd)};
    font-weight: 600;
  }

  span,
  em {
    color: ${tokens.textMuted};
    font-style: normal;
    font-size: ${px(tokens.fontSm)};
  }
`;

const SectionContent = styled.div`
  margin-top: 8px;
`;

const TopicRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 7px 0;
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
  color: ${tokens.textPrimary};
  overflow-wrap: anywhere;

  input {
    width: 100%;
    font-family: ${tokens.fontFamilyMono};
  }

  span {
    color: ${tokens.textMuted};
  }
`;

const TopicNameButton = styled.button`
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: ${tokens.textPrimary};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
  text-align: left;
  overflow-wrap: anywhere;

  &:hover:not(:disabled) {
    background: transparent;
    color: ${tokens.accentText};
  }
`;

const InlineTextButton = styled.button`
  padding: 4px 8px;
  border-color: ${tokens.borderSubtle};
  background: ${tokens.bgElevated};
  color: ${tokens.textSecondary};
  font-size: ${px(tokens.fontXs)};
`;

const OverrideLine = styled.div`
  padding: 6px 0;
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
  color: ${tokens.textPrimary};
  overflow-wrap: anywhere;
`;

const ParamTable = styled.table`
  width: 100%;
  min-width: 0;
  table-layout: fixed;
  border-collapse: collapse;
`;

const ParamCell = styled.td`
  border-bottom: 1px solid ${tokens.borderSubtle};
  padding: 8px 6px;
  font-size: ${px(tokens.fontSm)};
  vertical-align: middle;
  overflow-wrap: anywhere;

  input {
    width: 100%;
    min-width: 0;
  }
`;

const ParamKeyCell = styled(ParamCell)<{ $dirty?: boolean }>`
  font-family: ${tokens.fontFamilyMono};
  color: ${({ $dirty }) => ($dirty ? tokens.warningText : tokens.textPrimary)};
  font-weight: ${({ $dirty }) => ($dirty ? 600 : 400)};
`;

const FilterInput = styled.input`
  width: 100%;
`;

const ParamBadge = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  margin: 0 6px 4px 0;
  padding: 2px 8px;
  border-radius: ${px(tokens.radiusPill)};
  border: 1px solid ${tokens.borderDefault};
  color: ${tokens.textSecondary};
  background: ${tokens.bgInset};
  font-size: ${px(tokens.fontXs)};
  font-weight: 500;
`;

type ApplyMode = "dynamic" | "restart" | "launch";

const ParamModeBadge = styled(ParamBadge)<{ $mode: ApplyMode }>`
  border-color: ${({ $mode }) => {
    if ($mode === "dynamic") return tokens.accentBorder;
    if ($mode === "restart") return tokens.warningBorder;
    return tokens.infoBorder;
  }};
  background: ${({ $mode }) => {
    if ($mode === "dynamic") return tokens.accentSoft;
    if ($mode === "restart") return tokens.warningSoft;
    return tokens.infoSoft;
  }};
  color: ${({ $mode }) => {
    if ($mode === "dynamic") return tokens.accentText;
    if ($mode === "restart") return tokens.warningText;
    return tokens.infoText;
  }};
`;

const ParamList = styled.div`
  container-type: inline-size;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
`;

const ParamSectionMeta = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`;

const ParamGroup = styled.details`
  min-width: 0;
  border: 1px solid ${tokens.borderSubtle};
  border-radius: ${px(tokens.radiusMd)};
  background: ${tokens.bgElevated};
  overflow: hidden;

  &[open] summary {
    border-bottom: 1px solid ${tokens.borderSubtle};
  }

  summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    cursor: pointer;
    color: ${tokens.textPrimary};
    font-weight: 600;
  }
`;

const ParamGroupMeta = styled.div`
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;

  span {
    margin: 0;
  }
`;

const ParamRowRoot = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) max-content;
  grid-template-areas: "key value actions";
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
  padding: 10px;
  border-bottom: 1px solid ${tokens.borderSubtle};

  &:last-child {
    border-bottom: 0;
  }

  @container (max-width: 300px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "key"
      "value"
      "actions";
  }
`;

const ParamKey = styled.div<{ $dirty?: boolean }>`
  grid-area: key;
  min-width: 0;
  max-width: min(34ch, 42cqw);
  color: ${({ $dirty }) => ($dirty ? tokens.warningText : tokens.textPrimary)};
  font-family: ${tokens.fontFamilyMono};
  font-size: ${px(tokens.fontSm)};
  font-weight: ${({ $dirty }) => ($dirty ? 600 : 400)};
`;

const ParamKeyText = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ParamMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
`;

const ParamValue = styled.div`
  grid-area: value;
  min-width: 0;

  input {
    width: 100%;
    min-width: 0;
    height: ${px(tokens.controlMinHeight)};
    font-family: ${tokens.fontFamilyMono};
  }
`;

const ParamActions = styled.div`
  grid-area: actions;
  display: grid;
  align-content: center;
  gap: 4px;
  min-width: 0;

  &:empty {
    display: none;
  }

  span {
    justify-content: center;
    width: 100%;
    margin: 0;
    padding: 2px 6px;
    text-align: center;
    line-height: 1.15;
    white-space: normal;
  }

  button {
    min-width: 88px;
    min-height: 32px;
    padding: 6px 8px;
  }

  @container (max-width: 360px) {
    justify-content: stretch;

    button {
      width: 100%;
    }
  }
`;

const MutedBadge = styled(ParamBadge)`
  border-color: ${tokens.borderSubtle};
  background: ${tokens.bgInset};
  color: ${tokens.textMuted};
`;

function LaunchSwitches({
  onlyNames,
  excludeNames,
  labelPrefix = "switch",
  embedded = false
}: {
  onlyNames?: string[];
  excludeNames?: string[];
  labelPrefix?: string;
  embedded?: boolean;
}) {
  const switchArgs = useGraphStore((state) => state.switchArgs);
  const composition = useGraphStore((state) => state.composition);
  const setSwitchValue = useGraphStore((state) => state.setSwitchValue);
  let items = switchArgs;
  if (onlyNames) items = items.filter((item) => onlyNames.includes(item.name));
  if (excludeNames) items = items.filter((item) => !excludeNames.includes(item.name));
  if (items.length === 0) return null;
  return (
    <SwitchBox $embedded={embedded}>
      <h3>{onlyNames ? "Swap (controls this node)" : "Switchable Options"}</h3>
      {items.map((item) => {
        const value = composition.argOverrides[item.name] ?? item.defaultValue ?? "";
        const options = item.candidates.includes(value) ? item.candidates : [...item.candidates, value];
        return (
          <SwapField key={item.name}>
            <span title={item.description}>{item.name}</span>
            <select
              aria-label={`${labelPrefix}:${item.name}`}
              value={value}
              onChange={(event) => setSwitchValue(item.name, event.target.value)}
            >
              {options.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate === "" ? "(default)" : candidate}
                </option>
              ))}
            </select>
          </SwapField>
        );
      })}
    </SwitchBox>
  );
}

function AddNodeForm() {
  const addComposedNode = useGraphStore((state) => state.addComposedNode);
  const [name, setName] = useState("");
  const [packageName, setPackageName] = useState("");
  const [executable, setExecutable] = useState("");
  const canAdd = name.trim() !== "" && packageName.trim() !== "" && executable.trim() !== "";
  return (
    <CompositionAdd>
      <h3>Add Node</h3>
      <input aria-label="add-node-name" placeholder="node name" value={name} onChange={(event) => setName(event.target.value)} />
      <input aria-label="add-node-package" placeholder="package" value={packageName} onChange={(event) => setPackageName(event.target.value)} />
      <input aria-label="add-node-executable" placeholder="executable" value={executable} onChange={(event) => setExecutable(event.target.value)} />
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          addComposedNode({ name: name.trim(), packageName: packageName.trim(), executable: executable.trim() });
          setName("");
          setPackageName("");
          setExecutable("");
        }}
      >
        Add Node
      </button>
    </CompositionAdd>
  );
}

function applyModeForParameter(parameter: Parameter, graphSource: "static" | "runtime"): ApplyMode {
  if (parameter.dynamic) return "dynamic";
  if (graphSource === "runtime") return "restart";
  return "launch";
}

function labelForApplyMode(mode: ApplyMode) {
  if (mode === "dynamic") return "now";
  if (mode === "restart") return "on restart";
  return "on relaunch";
}

function commonApplyModeForParameters(parameters: Parameter[], graphSource: "static" | "runtime"): ApplyMode | null {
  if (parameters.length === 0) return null;
  const firstMode = applyModeForParameter(parameters[0], graphSource);
  return parameters.every((parameter) => applyModeForParameter(parameter, graphSource) === firstMode) ? firstMode : null;
}

function shouldShowInlineApplyMode(parameter: Parameter, graphSource: "static" | "runtime", sectionApplyMode: ApplyMode | null) {
  if (sectionApplyMode) return false;
  return applyModeForParameter(parameter, graphSource) !== "launch";
}

function parameterValueText(parameter: Parameter) {
  return String(parameter.value ?? "");
}

function ParamRow({ parameter, showApplyMode = true }: { parameter: Parameter; showApplyMode?: boolean }) {
  const [value, setValue] = useState(parameterValueText(parameter));
  const updateParameter = useGraphStore((state) => state.updateParameter);
  const graphSource = useGraphStore((state) => state.graphSource);
  const canTune = !parameter.readOnly;
  const applyMode = applyModeForParameter(parameter, graphSource);
  const applyModeLabel = labelForApplyMode(applyMode);
  const committedValue = parameterValueText(parameter);
  const changed = value !== committedValue;
  const showQueued = Boolean(parameter.dirty && !changed);
  const hasMeta = showApplyMode || Boolean(parameter.parameterType) || showQueued || Boolean(parameter.readOnly);
  useEffect(() => {
    setValue(parameterValueText(parameter));
  }, [parameter.value]);
  return (
    <ParamRowRoot>
      <ParamKey $dirty={parameter.dirty}>
        <ParamKeyText title={parameter.key}>{parameter.key}:</ParamKeyText>
        {hasMeta ? (
          <ParamMeta>
            {showApplyMode ? <ParamModeBadge $mode={applyMode}>{applyModeLabel}</ParamModeBadge> : null}
            {parameter.parameterType ? <ParamBadge>{parameter.parameterType}</ParamBadge> : null}
            {showQueued ? <MutedBadge>queued</MutedBadge> : null}
            {parameter.readOnly ? <MutedBadge>read only</MutedBadge> : null}
          </ParamMeta>
        ) : null}
      </ParamKey>
      <ParamValue>
        <input value={value} disabled={!canTune} onChange={(event) => setValue(event.target.value)} />
      </ParamValue>
      <ParamActions>
        {changed && canTune ? (
          <>
            <button type="button" onClick={() => void updateParameter(parameter, value)}>
              Apply
            </button>
            <InlineTextButton type="button" onClick={() => setValue(committedValue)}>
              Reset
            </InlineTextButton>
          </>
        ) : null}
      </ParamActions>
    </ParamRowRoot>
  );
}

function TopicNameField({
  nodeId,
  pin,
  onCommit
}: {
  nodeId: string;
  pin: Pin;
  onCommit: (nodeId: string, pinId: string, toTopic: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pin.topicName);

  useEffect(() => {
    setValue(pin.topicName);
  }, [pin.topicName]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === pin.topicName) return;
    onCommit(nodeId, pin.id, trimmed);
  };

  if (!editing) {
    return (
      <TopicNameButton type="button" title={pin.topicName} onClick={() => setEditing(true)}>
        {pin.topicName}
      </TopicNameButton>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        commit();
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(pin.topicName);
          setEditing(false);
        }
      }}
    />
  );
}

const topicPreviewLimit = 5;

function TopicSection({
  title,
  pins,
  filtered,
  nodeId,
  onCommit
}: {
  title: string;
  pins: Pin[];
  filtered: boolean;
  nodeId: string;
  onCommit: (nodeId: string, pinId: string, toTopic: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (pins.length === 0) return null;
  const visiblePins = expanded || filtered ? pins : pins.slice(0, topicPreviewLimit);
  return (
    <section>
      <SectionHeaderRow>
        <h3>{title}</h3>
        <CountBadge>{pins.length}</CountBadge>
      </SectionHeaderRow>
      {visiblePins.length > 0 ? (
        visiblePins.map((pin) => (
          <TopicRow key={pin.id}>
            <TopicNameField nodeId={nodeId} pin={pin} onCommit={onCommit} />
            <span>{pin.dataType}</span>
          </TopicRow>
        ))
      ) : (
        <Subtle>No topics.</Subtle>
      )}
      {!filtered && pins.length > topicPreviewLimit ? (
        <InlineTextButton type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : `Show all ${pins.length}`}
        </InlineTextButton>
      ) : null}
    </section>
  );
}

function groupNameForParameter(key: string) {
  const dotIndex = key.indexOf(".");
  if (dotIndex > 0) return key.slice(0, dotIndex);
  const underscoreIndex = key.indexOf("_");
  if (underscoreIndex > 0) return key.slice(0, underscoreIndex);
  return "General";
}

function groupParameters(parameters: Parameter[]) {
  const groups = new Map<string, Parameter[]>();
  for (const parameter of parameters) {
    const groupName = groupNameForParameter(parameter.key);
    groups.set(groupName, [...(groups.get(groupName) ?? []), parameter]);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <CollapsibleSectionRoot>
      <SectionToggle type="button" aria-expanded={open} onClick={onToggle}>
        <span>{open ? "v" : ">"}</span>
        <strong>{title}</strong>
        {typeof count === "number" && count > 0 ? <em>{count}</em> : null}
      </SectionToggle>
      {open ? <SectionContent>{children}</SectionContent> : null}
    </CollapsibleSectionRoot>
  );
}

type PropertyPanelProps = {
  mode: "topic" | "launch";
  selectedLaunchPath: string | null;
  onHide: () => void;
};

export function PropertyPanel({ mode, selectedLaunchPath, onHide }: PropertyPanelProps) {
  const [launchArgsOpen, setLaunchArgsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"node" | "composition">("node");
  const [nodeSectionsOpen, setNodeSectionsOpen] = useState({
    io: false,
    parameters: false
  });
  const [topicFilter, setTopicFilter] = useState("");
  const graph = useGraphStore((state) => state.graph);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const pendingOverrides = useGraphStore((state) => state.pendingOverrides);
  const pendingTopicOverrides = useGraphStore((state) => state.pendingTopicOverrides);
  const dynamicTuningSession = useGraphStore((state) => state.dynamicTuningSession);
  const graphSource = useGraphStore((state) => state.graphSource);
  const updateTopicName = useGraphStore((state) => state.updateTopicName);
  const composition = useGraphStore((state) => state.composition);
  const switchArgs = useGraphStore((state) => state.switchArgs);
  const toggleNodeDisabled = useGraphStore((state) => state.toggleNodeDisabled);
  const removeComposedNode = useGraphStore((state) => state.removeComposedNode);
  const resetComposition = useGraphStore((state) => state.resetComposition);
  const compositionDirty =
    isCompositionDirty(composition) ||
    pendingTopicOverrides.length > 0 ||
    pendingOverrides.length > 0 ||
    dynamicTuningSession.length > 0;

  // A fresh graph selection starts on the summary tab.
  useEffect(() => {
    if (selectedNodeId) setActiveTab("node");
  }, [selectedNodeId]);

  const launch = graph.launchGraph.launches.find((item) => item.path === selectedLaunchPath);
  const node = graph.nodes.find((item) => item.id === selectedNodeId);
  const params = node?.params ?? [];
  const paramGroups = useMemo(() => groupParameters(params), [params]);
  const groupedParamGroups = useMemo(() => paramGroups.filter((group) => group.items.length > 1), [paramGroups]);
  const singleParams = useMemo(() => paramGroups.flatMap((group) => (group.items.length === 1 ? group.items : [])), [paramGroups]);
  const sectionApplyMode = commonApplyModeForParameters(params, graphSource);
  const renderPanel = (children: ReactNode) => (
    <PropertyPanelRoot>
      <DetailsCollapseTab type="button" aria-label="Hide details" title="Hide details" onClick={onHide}>
        ›
      </DetailsCollapseTab>
      <PropertyPanelScroll>{children}</PropertyPanelScroll>
    </PropertyPanelRoot>
  );

  if (mode === "launch") {
    if (!launch) {
      return renderPanel(<div>Select a launch.</div>);
    }
    const launchParams = launch.parameters;
    return renderPanel(
      <>
        <h2>{launch.label}</h2>
        <Subtle>{launch.path}</Subtle>
        <section>
          <h3>Nodes Started Here</h3>
          {launch.nodeNames.map((name) => (
            <DetailLine key={name}>
              {name}
            </DetailLine>
          ))}
        </section>
        <CollapsibleSection
          title="Args"
          count={launch.argNames.length}
          open={launchArgsOpen}
          onToggle={() => setLaunchArgsOpen((value) => !value)}
        >
          {launch.argNames.length > 0 ? (
            launch.argNames.map((name) => (
              <DetailLine key={name}>
                {name}
              </DetailLine>
            ))
          ) : (
            <Subtle>No args.</Subtle>
          )}
        </CollapsibleSection>
        {launch.paramFiles.length > 0 ? (
          <section>
            <h3>Parameter Files</h3>
            {launch.paramFiles.map((path) => (
              <DetailLine key={path}>
                {path}
              </DetailLine>
            ))}
          </section>
        ) : null}
        {launchParams.length > 0 ? (
          <section>
            <h3>Resolved Parameters</h3>
            <ParamTable>
              <tbody>
                {launchParams.map((param) => (
                  <tr key={`${param.nodeId}:${param.key}:${param.sourceFile}`}>
                    <ParamKeyCell>{param.nodeName}.{param.key}</ParamKeyCell>
                    <ParamCell>{String(param.value ?? "")}</ParamCell>
                  </tr>
                ))}
              </tbody>
            </ParamTable>
          </section>
        ) : null}
      </>
    );
  }

  // Composition (graph-wide edits) is selection-independent, so it lives in its own
  // tab rather than inside the selected node's panel.
  const tabBar = (
    <TabBar role="tablist" aria-label="Details tabs">
      <TabButton
        type="button"
        role="tab"
        aria-selected={activeTab === "node"}
        $active={activeTab === "node"}
        onClick={() => setActiveTab("node")}
      >
        Node
      </TabButton>
      <TabButton
        type="button"
        role="tab"
        aria-selected={activeTab === "composition"}
        $active={activeTab === "composition"}
        onClick={() => setActiveTab("composition")}
      >
        Composition
      </TabButton>
    </TabBar>
  );

  if (activeTab === "composition") {
    return renderPanel(
      <>
        {tabBar}
        <h2>Composition</h2>
        <CompositionActions>
          <button type="button" disabled={!compositionDirty} onClick={() => resetComposition()}>
            Reset Composition
          </button>
        </CompositionActions>
        <LaunchSwitches />
        <AddNodeForm />
        {composition.addedNodes.length > 0 ? (
          <AddedList>
            <h3>Added Nodes</h3>
            {composition.addedNodes.map((added) => (
              <OverrideLine key={added.name}>
                {added.name} ({added.packageName}/{added.executable})
                <button type="button" onClick={() => removeComposedNode(added.name)}>
                  remove
                </button>
              </OverrideLine>
            ))}
          </AddedList>
        ) : null}
      </>
    );
  }

  if (!node) {
    return renderPanel(
      <>
        {tabBar}
        <div>Select a node.</div>
      </>
    );
  }

  const nodeDisabled = composition.disabledNodeIds.includes(node.id);
  const nodeSwitchNames = (node.gatedBy ?? []).filter((name) => switchArgs.some((item) => item.name === name));
  const rawInputs = node.inputs.filter((pin) => !isHiddenTopic(pin.topicName));
  const rawOutputs = node.outputs.filter((pin) => !isHiddenTopic(pin.topicName));
  const topicQuery = topicFilter.trim().toLowerCase();
  const topicMatches = (pin: Pin) => {
    if (!topicQuery) return true;
    return `${pin.topicName} ${pin.dataType}`.toLowerCase().includes(topicQuery);
  };
  const visibleInputs = rawInputs.filter(topicMatches);
  const visibleOutputs = rawOutputs.filter(topicMatches);
  const topicFilterActive = topicQuery.length > 0;
  const toggleNodeSection = (section: keyof typeof nodeSectionsOpen) => {
    setNodeSectionsOpen((current) => ({ ...current, [section]: !current[section] }));
  };

  return renderPanel(
    <>
      {tabBar}
      <PanelTitleRow>
        <h2>{node.name}</h2>
      </PanelTitleRow>
      {node.launchFile !== "runtime" ? <Subtle title={node.launchFile}>{basename(node.launchFile)}</Subtle> : null}
      <CompositionBox>
        <h3>Recompose</h3>
        <NodeToggleButton type="button" $nodeDisabled={nodeDisabled} onClick={() => toggleNodeDisabled(node.id)}>
          {nodeDisabled ? "Enable node" : "Disable node"}
        </NodeToggleButton>
        <LaunchSwitches onlyNames={nodeSwitchNames} labelPrefix="node-switch" embedded />
      </CompositionBox>
      {rawInputs.length + rawOutputs.length > 0 ? (
        <CollapsibleSection
          title="I/O"
          count={rawInputs.length + rawOutputs.length}
          open={nodeSectionsOpen.io}
          onToggle={() => toggleNodeSection("io")}
        >
          <StickyTools>
            <FilterInput
              aria-label="topic filter"
              placeholder="Filter topics"
              value={topicFilter}
              onChange={(event) => setTopicFilter(event.target.value)}
            />
          </StickyTools>
          <TopicSection title="Subscribers" pins={visibleInputs} filtered={topicFilterActive} nodeId={node.id} onCommit={updateTopicName} />
          <TopicSection title="Publishers" pins={visibleOutputs} filtered={topicFilterActive} nodeId={node.id} onCommit={updateTopicName} />
        </CollapsibleSection>
      ) : null}
      {node.params.length > 0 ? (
        <CollapsibleSection
          title="Parameters"
          count={node.params.length}
          open={nodeSectionsOpen.parameters}
          onToggle={() => toggleNodeSection("parameters")}
        >
          <ParamList>
            {sectionApplyMode ? (
              <ParamSectionMeta>
                <ParamModeBadge $mode={sectionApplyMode}>Applied {labelForApplyMode(sectionApplyMode)}</ParamModeBadge>
              </ParamSectionMeta>
            ) : null}
            {groupedParamGroups.map((group) => {
              const commonApplyMode = commonApplyModeForParameters(group.items, graphSource);
              const groupApplyMode = !sectionApplyMode && commonApplyMode && commonApplyMode !== "launch" ? commonApplyMode : null;
              return (
                <ParamGroup key={group.name} open={group.name === "General" || group.items.some((param) => param.dirty)}>
                  <summary>
                    <span>{group.name}</span>
                    <ParamGroupMeta>
                      {groupApplyMode ? <ParamModeBadge $mode={groupApplyMode}>{labelForApplyMode(groupApplyMode)}</ParamModeBadge> : null}
                      <CountBadge>{group.items.length}</CountBadge>
                    </ParamGroupMeta>
                  </summary>
                  {group.items.map((param) => (
                    <ParamRow
                      parameter={param}
                      showApplyMode={!commonApplyMode && shouldShowInlineApplyMode(param, graphSource, sectionApplyMode)}
                      key={`${param.nodeId}:${param.key}`}
                    />
                  ))}
                </ParamGroup>
              );
            })}
            {singleParams.map((param) => (
              <ParamRow
                parameter={param}
                showApplyMode={shouldShowInlineApplyMode(param, graphSource, sectionApplyMode)}
                key={`${param.nodeId}:${param.key}`}
              />
            ))}
          </ParamList>
        </CollapsibleSection>
      ) : null}
    </>
  );
}
