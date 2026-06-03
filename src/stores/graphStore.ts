import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { GraphModel, GraphNode, Parameter } from "../lib/graphModel";
import { visibleEdges, visibleNodes } from "../lib/filters";
import { buildLaunchArgs, buildLaunchOverrideArgs, parseLaunchArgSpecs, type LaunchArgSpec } from "../lib/launchArgs";
import { parameterToOverride, type ParamOverride, type TopicOverride, upsertParamOverride, upsertTopicOverride } from "../lib/overlays";
import {
  describeRestartTarget,
  restartRequestForTarget,
  restartTargetForNode,
  type RestartCommandRequest
} from "../lib/rosRuntime";
import {
  type AddedNodeSpec,
  type Composition,
  addComposedNode as addComposedNodeToComposition,
  composedLaunchArgs,
  emptyComposition,
  isCompositionDirty,
  removeComposedNode,
  setArgOverride,
  setNodeDisabled
} from "../lib/composition";
import { buildForkSet } from "../lib/forkChain";
import {
  buildGeneratedEntryLaunchPy,
  upsertDynamicTuningEntry,
  type DynamicTuningEntry
} from "../lib/dynamicTuning";
import type { SwitchArg } from "../lib/launchSwitches";
import {
  chooseLaunchFile,
  chooseOutputFolder,
  listDynamicRosParameters,
  loadGraphResult,
  readReachableFiles,
  readTextFile,
  getOutputRoot,
  ensureRosbridge,
  restartRosNode,
  setRosParam,
  writeTextFile,
  writeTextFilesAtomically
} from "../lib/api/client";
import { fetchRuntimeGraph } from "../lib/ros/roslibClient";
import { buildEdges, mergeRuntimeGraphWithStaticGraph } from "../lib/parser";
import { reconcileRuntimeParameters } from "../lib/runtimeParams";
import { defaultConfig } from "../lib/defaultConfig";
import { draftSignature } from "../lib/draftChanges";

type GraphStore = {
  sourceRoot: string;
  entryLaunch: string;
  entryForkPath: string;
  rosbridgeUrl: string;
  graphSource: "static" | "runtime";
  staticGraph: GraphModel;
  staticSwitchArgs: SwitchArg[];
  staticSourceRoot: string;
  mapPath: string;
  outputRoot: string;
  defaultOutputRoot: string;
  launchArgSpecs: LaunchArgSpec[];
  launchArgValues: Record<string, string>;
  showUnusedNodes: boolean;
  advancedTopics: boolean;
  composition: Composition;
  switchArgs: SwitchArg[];
  selectedNodeId: string | null;
  graph: GraphModel;
  pendingOverrides: ParamOverride[];
  pendingTopicOverrides: TopicOverride[];
  dynamicTuningSession: DynamicTuningEntry[];
  lastSavedDraftSignature: string | null;
  status: string;
  chooseEntryLaunch: () => Promise<void>;
  setEntryLaunch: (path: string) => Promise<void>;
  chooseOutputRoot: () => Promise<void>;
  resetOutputRoot: () => void;
  loadDefaultOutputRoot: () => Promise<void>;
  setLaunchArgValue: (name: string, value: string) => void;
  setMapPath: (path: string) => void;
  setShowUnusedNodes: (value: boolean) => void;
  setAdvancedTopics: (value: boolean) => void;
  setSwitchValue: (name: string, value: string) => void;
  toggleNodeDisabled: (nodeId: string) => void;
  addComposedNode: (spec: AddedNodeSpec) => void;
  removeComposedNode: (name: string) => void;
  resetComposition: () => void;
  resetDraft: () => void;
  reloadWithComposition: () => Promise<void>;
  reloadWithCompositionDebounced: () => void;
  setSelectedNodeId: (id: string | null) => void;
  loadGraph: () => Promise<void>;
  syncFromRuntime: () => Promise<void>;
  disconnectRuntime: () => void;
  updateParameter: (parameter: Parameter, value: string) => Promise<void>;
  updateTopicName: (nodeId: string, pinId: string, toTopic: string) => void;
  apply: () => Promise<void>;
  visibleNodes: () => GraphNode[];
};

const emptyGraph: GraphModel = { nodes: [], edges: [], includes: [], launchGraph: { launches: [], edges: [] } };
export const defaultMapPath = defaultConfig.mapPath;
// No vehicle/machine-specific seeds: launch arg values are filled from the
// chosen launch file's <arg> defaults and edited by the user in the GUI.
const defaultLaunchArgs: Record<string, string> = {};

type GeneratedFile = {
  relativePath: string;
  content: string;
};

const outputRootDirectoryName = "autoware_graph_studio_overrides";

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function joinPath(...parts: string[]): string {
  const [first = "", ...rest] = parts;
  return [trimTrailingSlash(first), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))]
    .filter((part) => part.length > 0)
    .join("/");
}

function asAutowareGraphStudioOutputRoot(path: string): string {
  const trimmedPath = path.trim();
  const root = trimmedPath === "/" ? "/" : trimTrailingSlash(trimmedPath);
  if (!root) return "";
  const leaf = root.split("/").filter(Boolean).at(-1);
  if (leaf === outputRootDirectoryName) return root;
  return root === "/" ? `/${outputRootDirectoryName}` : joinPath(root, outputRootDirectoryName);
}

function relativeTo(baseDir: string, filePath: string): string {
  const prefix = `${trimTrailingSlash(baseDir)}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath.replace(/^\/+/, "");
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function formatRunTimestamp(date = new Date()): string {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(), 3)}`
  ].join("_");
}

function manifestContent(input: {
  createdAt: string;
  runDir: string;
  latestDir: string;
  entryLaunch: string;
  generatedEntryLaunch: string;
  launchArgs: Record<string, string>;
  paramOverrides: ParamOverride[];
  topicOverrides: TopicOverride[];
  dynamicTuningSession: DynamicTuningEntry[];
  restartTargets: RestartCommandRequest[];
  files: GeneratedFile[];
}): string {
  return `${JSON.stringify(
    {
      version: 1,
      createdAt: input.createdAt,
      runDir: input.runDir,
      latestDir: input.latestDir,
      entryLaunch: input.entryLaunch,
      generatedEntryLaunch: input.generatedEntryLaunch,
      launchCommand: `ros2 launch ${input.generatedEntryLaunch}`,
      launchArgs: input.launchArgs,
      staticParams: input.paramOverrides,
      topicOverrides: input.topicOverrides,
      dynamicParams: input.dynamicTuningSession,
      restartTargets: input.restartTargets,
      files: input.files.map((file) => file.relativePath).sort()
    },
    null,
    2
  )}\n`;
}

function findNodeForParameter(graph: GraphModel, parameter: Parameter): GraphNode | undefined {
  return graph.nodes.find(
    (node) =>
      node.id === parameter.nodeId ||
      node.name === parameter.nodeName ||
      node.id === parameter.nodeName ||
      node.name === parameter.nodeId ||
      node.runtimeAliases?.includes(parameter.nodeName) ||
      node.runtimeAliases?.includes(parameter.nodeId)
  );
}

function findNodeForOverride(graph: GraphModel, override: ParamOverride): GraphNode | undefined {
  const aliases = new Set([override.nodeName, ...(override.nodeAliases ?? [])]);
  return graph.nodes.find(
    (node) =>
      aliases.has(node.name) ||
      aliases.has(node.id) ||
      node.runtimeAliases?.some((alias) => aliases.has(alias)) ||
      (node.restartTarget?.nodeName ? aliases.has(node.restartTarget.nodeName) : false)
  );
}

function updateGraphParameter(graph: GraphModel, parameter: Parameter, value: Parameter["value"]): GraphModel {
  return {
    ...graph,
    nodes: graph.nodes.map((graphNode) => ({
      ...graphNode,
      params: graphNode.params.map((param) =>
        param.nodeId === parameter.nodeId &&
        param.nodeName === parameter.nodeName &&
        param.key === parameter.key &&
        param.sourceFile === parameter.sourceFile
          ? { ...param, value, dirty: true }
          : param
      )
    }))
  };
}

function restartRequestsForOverrides(
  graph: GraphModel,
  overrides: ParamOverride[],
  context: {
    generatedEntryLaunch: string;
    latestEntryLaunch: string;
    runDir: string;
    latestDir: string;
  }
): RestartCommandRequest[] {
  const requests: RestartCommandRequest[] = [];
  const seen = new Set<string>();
  for (const override of overrides) {
    const node = findNodeForOverride(graph, override);
    if (!node) continue;
    const request = restartRequestForTarget(restartTargetForNode(node), context);
    if (!request) continue;
    const key = `${request.kind}:${request.targetName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push(request);
  }
  return requests;
}

// Increments on every composition reparse so a slower, superseded reload can't
// overwrite the graph produced by a newer switch change.
let reloadToken = 0;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function clearScheduledReload() {
  if (!reloadTimer) return;
  clearTimeout(reloadTimer);
  reloadTimer = null;
}

function defaultArgValues(specs: LaunchArgSpec[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const spec of specs) values[spec.name] = spec.defaultValue;
  return values;
}

function hasGraphContent(graph: GraphModel): boolean {
  return graph.nodes.length > 0 || graph.edges.length > 0 || graph.includes.length > 0 || graph.launchGraph.launches.length > 0;
}

export const useGraphStore = create<GraphStore>()(
  persist(
    (set, get) => ({
  sourceRoot: defaultConfig.sourceRoot,
  entryLaunch: defaultConfig.entryLaunch,
  entryForkPath: "",
  rosbridgeUrl: defaultConfig.rosbridgeUrl,
  graphSource: "static",
  staticGraph: emptyGraph,
  staticSwitchArgs: [],
  staticSourceRoot: defaultConfig.sourceRoot,
  mapPath: defaultMapPath,
  outputRoot: "",
  defaultOutputRoot: "",
  launchArgSpecs: [],
  launchArgValues: defaultLaunchArgs,
  showUnusedNodes: false,
  advancedTopics: false,
  composition: emptyComposition(),
  switchArgs: [],
  selectedNodeId: null,
  graph: emptyGraph,
  pendingOverrides: [],
  pendingTopicOverrides: [],
  dynamicTuningSession: [],
  lastSavedDraftSignature: null,
  status: "Choose a launch file to begin.",
  chooseEntryLaunch: async () => {
    const state = get();
    set({ status: "Choosing launch file..." });
    try {
      const path = await chooseLaunchFile({
        defaultPath: state.entryLaunch || undefined
      });
      if (!path) {
        set({ status: "Launch selection cancelled." });
        return;
      }
      await get().setEntryLaunch(path);
      await get().loadGraph();
    } catch (error) {
      set({ status: `Launch selection failed: ${String(error)}` });
    }
  },
  setEntryLaunch: async (path) => {
    const state = get();
    set({
      entryLaunch: path,
      composition: emptyComposition(),
      pendingOverrides: [],
      pendingTopicOverrides: [],
      dynamicTuningSession: [],
      lastSavedDraftSignature: null,
      status: "Reading launch arguments..."
    });
    try {
      const content = await readTextFile(path);
      if (get().entryLaunch !== path) return;
      const launchArgSpecs = content ? parseLaunchArgSpecs(content) : [];
      const nextValues: Record<string, string> = {};
      for (const spec of launchArgSpecs) {
        nextValues[spec.name] = state.launchArgValues[spec.name] ?? spec.defaultValue;
      }
      if (launchArgSpecs.some((spec) => spec.name === "map_path")) {
        nextValues.map_path = nextValues.map_path || state.mapPath || defaultMapPath;
      }
      set({
        launchArgSpecs,
        launchArgValues: nextValues,
        mapPath: nextValues.map_path ?? state.mapPath,
        status: `Selected ${path.split("/").at(-1) ?? path}.`
      });
    } catch (error) {
      if (get().entryLaunch !== path) return;
      set({ launchArgSpecs: [], status: `Launch arg read failed: ${String(error)}` });
    }
  },
  chooseOutputRoot: async () => {
    const state = get();
    set({ status: "Choosing output folder..." });
    try {
      const defaultPath = state.outputRoot
        ? asAutowareGraphStudioOutputRoot(state.outputRoot)
        : state.defaultOutputRoot || (await getOutputRoot());
      const path = await chooseOutputFolder({ defaultPath });
      if (!path) {
        set({ status: "Output folder selection cancelled." });
        return;
      }
      const outputRoot = asAutowareGraphStudioOutputRoot(path);
      set({
        outputRoot,
        status: `Output folder set to ${outputRoot}.`
      });
    } catch (error) {
      set({ status: `Output folder selection failed: ${String(error)}` });
    }
  },
  resetOutputRoot: () => {
    set((state) => ({
      outputRoot: "",
      status: state.defaultOutputRoot
        ? `Output folder reset to default: ${state.defaultOutputRoot}.`
        : "Output folder reset to default."
    }));
  },
  loadDefaultOutputRoot: async () => {
    if (get().defaultOutputRoot) return;
    try {
      const root = await getOutputRoot();
      if (!get().defaultOutputRoot) set({ defaultOutputRoot: root });
    } catch {
      // This path is only a UI hint. Save will report any real filesystem error.
    }
  },
  setLaunchArgValue: (name, value) => {
    if (get().graphSource === "runtime") {
      set({ status: "Launch args are locked while synced from running ROS. Disconnect runtime before changing them." });
      return;
    }
    set((state) => ({
      launchArgValues: { ...state.launchArgValues, [name]: value },
      mapPath: name === "map_path" ? value : state.mapPath,
      status: "Launch arg changed. Updating graph..."
    }));
    get().reloadWithCompositionDebounced();
  },
  setMapPath: (path) => {
    if (get().graphSource === "runtime") {
      set({ status: "Launch args are locked while synced from running ROS. Disconnect runtime before changing them." });
      return;
    }
    set((state) => ({
      mapPath: path,
      launchArgValues: { ...state.launchArgValues, map_path: path },
      status: "Launch arg changed. Updating graph..."
    }));
    get().reloadWithCompositionDebounced();
  },
  setShowUnusedNodes: (value) => set({ showUnusedNodes: value }),
  setAdvancedTopics: (value) => set({ advancedTopics: value }),
  setSwitchValue: (name, value) => {
    // Switches are composition (argOverrides), not launch args, so they stay
    // editable while synced. In runtime mode we only record the draft; the graph
    // is not reparsed (reloadWithCompositionDebounced no-ops), and the change is
    // applied to the generated launch on Save.
    const runtime = get().graphSource === "runtime";
    set((state) => ({
      composition: setArgOverride(state.composition, name, value),
      status: runtime
        ? `Draft changed: ${name} = ${value === "" ? "(default)" : value}. Applies to the generated launch on Save.`
        : "Switch changed. Updating graph..."
    }));
    get().reloadWithCompositionDebounced();
  },
  toggleNodeDisabled: (nodeId) =>
    set((state) => {
      const disabled = !state.composition.disabledNodeIds.includes(nodeId);
      return {
        composition: setNodeDisabled(state.composition, nodeId, disabled),
        status: disabled ? `Draft changed: disabled ${nodeId}.` : `Draft changed: enabled ${nodeId}.`
      };
    }),
  addComposedNode: (spec) =>
    set((state) => ({
      composition: addComposedNodeToComposition(state.composition, spec),
      status: `Draft changed: added ${spec.name} (${spec.packageName}/${spec.executable}).`
    })),
  removeComposedNode: (name) =>
    set((state) => ({ composition: removeComposedNode(state.composition, name), status: `Draft changed: removed ${name}.` })),
  resetComposition: () => {
    const runtime = get().graphSource === "runtime";
    set({
      composition: emptyComposition(),
      status: runtime
        ? "Composition draft cleared. Applies to the generated launch on Save."
        : "Composition cleared. Updating graph..."
    });
    get().reloadWithCompositionDebounced();
  },
  resetDraft: () => {
    if (get().graphSource === "runtime") {
      set({ status: "Launch args are locked while synced from running ROS. Disconnect runtime before changing them." });
      return;
    }
    const launchArgValues = defaultArgValues(get().launchArgSpecs);
    set({
      launchArgValues,
      mapPath: launchArgValues.map_path ?? defaultMapPath,
      composition: emptyComposition(),
      pendingOverrides: [],
      pendingTopicOverrides: [],
      dynamicTuningSession: [],
      lastSavedDraftSignature: null,
      status: "Draft cleared. Updating graph..."
    });
    get().reloadWithCompositionDebounced();
  },
  reloadWithCompositionDebounced: () => {
    clearScheduledReload();
    const state = get();
    if (state.graphSource !== "static" || !state.entryLaunch.trim()) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void get().reloadWithComposition();
    }, 500);
  },
  reloadWithComposition: async () => {
    clearScheduledReload();
    const state = get();
    if (!state.entryLaunch.trim()) return;
    if (state.graphSource !== "static") {
      set({ status: "Graph reparse is locked while synced from running ROS. Disconnect runtime before changing launch args." });
      return;
    }
    const token = ++reloadToken;
    const launchArgs = composedLaunchArgs(buildLaunchArgs(state.launchArgSpecs, state.launchArgValues), state.composition);
    set({ status: "Reparsing with composition args..." });
    try {
      const { graph, switchArgs, sourceRoot } = await loadGraphResult({
        entryLaunch: state.entryLaunch,
        launchArgs
      });
      if (token !== reloadToken) return;
      set({
        sourceRoot,
        graph,
        staticGraph: graph,
        staticSwitchArgs: switchArgs,
        staticSourceRoot: sourceRoot,
        switchArgs,
        status: `Graph updated from draft: ${graph.nodes.length} nodes, ${graph.edges.length} topic links.`
      });
    } catch (error) {
      if (token !== reloadToken) return;
      set({ status: `Reload failed: ${String(error)}` });
    }
  },
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  visibleNodes: () => visibleNodes(get().graph, get().showUnusedNodes),
  loadGraph: async () => {
    const state = get();
    const launchArgs = buildLaunchArgs(state.launchArgSpecs, state.launchArgValues);
    if (!state.entryLaunch.trim()) {
      set({ status: "entry launch is required." });
      return;
    }
    set({ status: "Loading graph..." });
    try {
      const { graph, switchArgs, sourceRoot } = await loadGraphResult({
        entryLaunch: state.entryLaunch,
        launchArgs
      });
      set({
        sourceRoot,
        graph,
        staticGraph: graph,
        staticSwitchArgs: switchArgs,
        staticSourceRoot: sourceRoot,
        switchArgs,
        graphSource: "static",
        selectedNodeId: null,
        dynamicTuningSession: [],
        status: `Loaded ${graph.nodes.length} nodes, ${graph.edges.length} topic links, ${switchArgs.length} switchable options.`
      });
    } catch (error) {
      set({ status: `Load failed: ${String(error)}` });
    }
  },
  syncFromRuntime: async () => {
    const state = get();
    set({ status: `Ensuring rosbridge is running at ${state.rosbridgeUrl}...` });
    try {
      await ensureRosbridge(state.rosbridgeUrl);
      set({ status: `Querying the running ROS graph via ${state.rosbridgeUrl}...` });
      const runtimeGraph = await fetchRuntimeGraph(state.rosbridgeUrl);
      const launchArgs = composedLaunchArgs(buildLaunchArgs(state.launchArgSpecs, state.launchArgValues), state.composition);
      let graph = runtimeGraph;
      let switchArgs = state.switchArgs;
      let sourceRoot = state.sourceRoot;
      let staticGraph = state.graphSource === "static" ? state.graph : state.staticGraph;
      let staticSwitchArgs = state.graphSource === "static" ? state.switchArgs : state.staticSwitchArgs;
      let staticSourceRoot = state.graphSource === "static" ? state.sourceRoot : state.staticSourceRoot;
      try {
        const staticResult = await loadGraphResult({
          entryLaunch: state.entryLaunch,
          launchArgs
        });
        graph = mergeRuntimeGraphWithStaticGraph(runtimeGraph, staticResult.graph);
        switchArgs = staticResult.switchArgs;
        sourceRoot = staticResult.sourceRoot;
        staticGraph = staticResult.graph;
        staticSwitchArgs = staticResult.switchArgs;
        staticSourceRoot = staticResult.sourceRoot;
      } catch {
        graph = runtimeGraph;
      }
      set({
        sourceRoot,
        graph,
        staticGraph,
        staticSwitchArgs,
        staticSourceRoot,
        switchArgs,
        graphSource: "runtime",
        selectedNodeId: null,
        status: `Synced ${graph.nodes.length} running nodes and ${graph.edges.length} topic links. Discovering dynamic parameters...`
      });
      try {
        const dynamicParams = await listDynamicRosParameters(graph.nodes.map((node) => node.name));
        if (get().graphSource !== "runtime") return;
        set((current) => ({
          graph: reconcileRuntimeParameters(current.graph, dynamicParams),
          status: `Synced ${graph.nodes.length} running nodes, ${graph.edges.length} topic links, and ${dynamicParams.length} dynamic parameters from ROS.`
        }));
      } catch (error) {
        if (get().graphSource !== "runtime") return;
        set({
          status: `Synced ${graph.nodes.length} running nodes and ${graph.edges.length} topic links. Dynamic parameter discovery failed: ${String(error)}`
        });
      }
    } catch (error) {
      set({ status: `Sync failed: ${String(error)}` });
    }
  },
  disconnectRuntime: () => {
    const state = get();
    if (state.graphSource !== "runtime") {
      set({ status: "Already showing static analysis." });
      return;
    }
    const graph = hasGraphContent(state.staticGraph) ? state.staticGraph : emptyGraph;
    set({
      sourceRoot: state.staticSourceRoot,
      graph,
      switchArgs: state.staticSwitchArgs,
      graphSource: "static",
      selectedNodeId: null,
      status: `Disconnected from running ROS. Restored static analysis: ${graph.nodes.length} nodes, ${graph.edges.length} topic links.`
    });
  },
  updateParameter: async (parameter, value) => {
    if (parameter.readOnly) {
      set({ status: `Parameter ${parameter.nodeName}.${parameter.key} is read-only.` });
      return;
    }
    // Dynamic parameters always go through ros2 param set (live now + replayed
    // from the generated entry launch); they are never baked into fork <param>.
    if (parameter.dynamic) {
      const dynamicEntry = {
        nodeName: parameter.nodeName,
        key: parameter.key,
        value,
        parameterType: parameter.parameterType
      };
      try {
        set((state) => ({
          dynamicTuningSession: upsertDynamicTuningEntry(state.dynamicTuningSession, dynamicEntry),
          status: `Applying dynamic parameter ${parameter.nodeName}.${parameter.key}...`
        }));
        await setRosParam(parameter.nodeName, parameter.key, value);
        set((state) => ({
          graph: updateGraphParameter(state.graph, parameter, value),
          status: `Applied dynamic parameter ${parameter.nodeName}.${parameter.key}. Save records it for next launch.`
        }));
      } catch (error) {
        set((state) => ({
          dynamicTuningSession: state.dynamicTuningSession.filter(
            (entry) => !(entry.nodeName === dynamicEntry.nodeName && entry.key === dynamicEntry.key)
          ),
          status: `Dynamic parameter set failed: ${String(error)}`
        }));
      }
      return;
    }
    const override = parameterToOverride(parameter, value);
    const node = findNodeForParameter(get().graph, parameter);
    const restartTarget = node ? restartTargetForNode(node) : undefined;
    set((state) => ({
      pendingOverrides: upsertParamOverride(state.pendingOverrides, override),
      graph: updateGraphParameter(state.graph, parameter, override.value),
      status:
        state.graphSource === "runtime"
          ? `Draft changed: ${parameter.nodeName}.${parameter.key}. Save writes the launch and restarts ${
              restartTarget ? describeRestartTarget(restartTarget) : parameter.nodeName
            } if a restart command is configured.`
          : `Draft changed: ${parameter.nodeName}.${parameter.key}. Save writes the generated launch.`
    }));
  },
  updateTopicName: (nodeId, pinId, toTopic) => {
    set((state) => {
      const node = state.graph.nodes.find((item) => item.id === nodeId);
      if (!node) return state;
      const pin = [...node.inputs, ...node.outputs].find((item) => item.id === pinId);
      if (!pin) return state;
      const existingOverride = state.pendingTopicOverrides.find(
        (item) => item.nodeName === node.name && item.pinKind === pin.kind && item.toTopic === pin.topicName
      );
      const fromTopic = existingOverride?.fromTopic ?? pin.topicName;
      const fromRemap = existingOverride?.fromRemap ?? pin.remapFrom;
      const nextTopicOverrides = upsertTopicOverride(state.pendingTopicOverrides, {
        nodeName: node.name,
        pinKind: pin.kind,
        fromTopic,
        toTopic,
        ...(fromRemap ? { fromRemap } : {})
      });
      const nodes = state.graph.nodes.map((graphNode) =>
        graphNode.id === nodeId
          ? {
              ...graphNode,
              inputs: graphNode.inputs.map((input) =>
                input.id === pinId ? { ...input, topicName: toTopic } : input
              ),
              outputs: graphNode.outputs.map((output) =>
                output.id === pinId ? { ...output, topicName: toTopic } : output
              )
            }
          : graphNode
      );
      return {
        pendingTopicOverrides: nextTopicOverrides,
        graph: {
          ...state.graph,
          nodes,
          edges: buildEdges(nodes)
        },
        status: "Draft changed: topic remap. Save writes the generated launch."
      };
    });
  },
  apply: async () => {
    const state = get();
    const hasComposition = isCompositionDirty(state.composition);
    const hasParams = state.pendingOverrides.length > 0;
    const hasTopics = state.pendingTopicOverrides.length > 0;
    const hasDynamicTuning = state.dynamicTuningSession.length > 0;
    const launchArgs = buildLaunchOverrideArgs(state.launchArgSpecs, state.launchArgValues);
    const hasLaunchArgs = Object.keys(launchArgs).length > 0;
    if (!hasComposition && !hasParams && !hasTopics && !hasDynamicTuning && !hasLaunchArgs) {
      set({ status: "No draft changes to save." });
      return;
    }
    const currentDraftSignature = draftSignature(state);
    try {
      const overridesRoot = state.outputRoot.trim() ? asAutowareGraphStudioOutputRoot(state.outputRoot) : await getOutputRoot();
      const timestamp = formatRunTimestamp();
      const runDir = joinPath(overridesRoot, "runs", timestamp);
      const latestDir = joinPath(overridesRoot, "latest");
      const runForksDir = joinPath(runDir, "forks");
      const latestForksDir = joinPath(latestDir, "forks");
      const runFilesToWrite: GeneratedFile[] = [];
      const latestFilesToWrite: GeneratedFile[] = [];
      let runSourceLaunch = state.entryLaunch;
      let latestSourceLaunch = state.entryLaunch;
      let resolvedSourceRoot = state.sourceRoot;
      let writtenCount = 0;
      if (hasComposition || hasParams || hasTopics) {
        const files = await readReachableFiles({
          entryLaunch: state.entryLaunch,
          launchArgs
        });
        resolvedSourceRoot = files.sourceRoot || state.sourceRoot;
        const runForkSet = buildForkSet({
          entryLaunch: state.entryLaunch,
          forksDir: runForksDir,
          sourceRoot: resolvedSourceRoot,
          files: files.files,
          graph: state.graph,
          composition: state.composition,
          paramOverrides: state.pendingOverrides,
          topicOverrides: state.pendingTopicOverrides,
          launchArgs
        });
        const latestForkSet = buildForkSet({
          entryLaunch: state.entryLaunch,
          forksDir: latestForksDir,
          sourceRoot: resolvedSourceRoot,
          files: files.files,
          graph: state.graph,
          composition: state.composition,
          paramOverrides: state.pendingOverrides,
          topicOverrides: state.pendingTopicOverrides,
          launchArgs
        });
        for (const fork of runForkSet.forks) {
          runFilesToWrite.push({ relativePath: relativeTo(runDir, fork.path), content: fork.content });
        }
        for (const fork of latestForkSet.forks) {
          latestFilesToWrite.push({ relativePath: relativeTo(latestDir, fork.path), content: fork.content });
        }
        runSourceLaunch = runForkSet.entryForkPath;
        latestSourceLaunch = latestForkSet.entryForkPath;
      }
      const generatedEntryLaunchRelativePath = "launch/autoware_graph_studio.launch.py";
      const entryForkPath = joinPath(runDir, generatedEntryLaunchRelativePath);
      const latestEntryPath = joinPath(latestDir, generatedEntryLaunchRelativePath);
      runFilesToWrite.push({
        relativePath: generatedEntryLaunchRelativePath,
        content: buildGeneratedEntryLaunchPy({
          sourceLaunch: runSourceLaunch,
          launchArgs,
          entries: state.dynamicTuningSession
        })
      });
      latestFilesToWrite.push({
        relativePath: generatedEntryLaunchRelativePath,
        content: buildGeneratedEntryLaunchPy({
          sourceLaunch: latestSourceLaunch,
          launchArgs,
          entries: state.dynamicTuningSession
        })
      });
      const restartTargets =
        hasParams && state.graphSource === "runtime"
          ? restartRequestsForOverrides(state.graph, state.pendingOverrides, {
              generatedEntryLaunch: entryForkPath,
              latestEntryLaunch: latestEntryPath,
              runDir,
              latestDir
            })
          : [];
      const createdAt = new Date().toISOString();
      runFilesToWrite.push({
        relativePath: "manifest.json",
        content: manifestContent({
          createdAt,
          runDir,
          latestDir,
          entryLaunch: state.entryLaunch,
          generatedEntryLaunch: entryForkPath,
          launchArgs,
          paramOverrides: state.pendingOverrides,
          topicOverrides: state.pendingTopicOverrides,
          dynamicTuningSession: state.dynamicTuningSession,
          restartTargets,
          files: runFilesToWrite
        })
      });
      latestFilesToWrite.push({
        relativePath: "manifest.json",
        content: manifestContent({
          createdAt,
          runDir,
          latestDir,
          entryLaunch: state.entryLaunch,
          generatedEntryLaunch: latestEntryPath,
          launchArgs,
          paramOverrides: state.pendingOverrides,
          topicOverrides: state.pendingTopicOverrides,
          dynamicTuningSession: state.dynamicTuningSession,
          restartTargets,
          files: latestFilesToWrite
        })
      });

      for (const file of runFilesToWrite) {
        await writeTextFile(joinPath(runDir, file.relativePath), file.content);
      }
      await writeTextFilesAtomically(latestDir, latestFilesToWrite);
      writtenCount = runFilesToWrite.length + latestFilesToWrite.length;
      const restartFailures: string[] = [];
      for (const request of restartTargets) {
        try {
          await restartRosNode(request);
        } catch (error) {
          restartFailures.push(`${request.targetName}: ${String(error)}`);
        }
      }
      const restartStatus =
        restartTargets.length === 0
          ? ""
          : restartFailures.length > 0
            ? ` Restart failed for ${restartFailures.join("; ")}.`
            : ` Restart requested for ${restartTargets.map((target) => target.targetName).join(", ")}.`;
      set({
        sourceRoot: resolvedSourceRoot,
        entryForkPath: latestEntryPath,
        lastSavedDraftSignature: currentDraftSignature,
        status: `Saved ${writtenCount} generated file${writtenCount === 1 ? "" : "s"} to latest.${restartStatus} Launch with: ros2 launch ${latestEntryPath}`
      });
    } catch (error) {
      set({ status: `Save failed: ${String(error)}` });
    }
  }
    }),
    {
      name: "autoware_graph_studio-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        entryLaunch: state.entryLaunch,
        mapPath: state.mapPath,
        outputRoot: state.outputRoot,
        launchArgValues: state.launchArgValues,
        showUnusedNodes: state.showUnusedNodes,
        advancedTopics: state.advancedTopics
      })
    }
  )
);

export function useVisibleEdges() {
  return useGraphStore((state) => visibleEdges(state.graph, visibleNodes(state.graph, state.showUnusedNodes)));
}
