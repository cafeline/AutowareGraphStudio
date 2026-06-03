import { XMLParser } from "fast-xml-parser";
import yaml from "js-yaml";
import { conditionArgNames, isElementActive, resolveValue } from "./launchConditions";
import type {
  GraphEdge,
  LaunchFileNode,
  GraphModel,
  GraphNode,
  LaunchArgs,
  Parameter,
  Pin,
  ResolvedGraph,
  RestartTarget
} from "./graphModel";

type FileMap = Record<string, string>;

type PackageIndex = Record<string, string>;

type LaunchSummaryDraft = {
  path: string;
  label: string;
  includePaths: Set<string>;
  nodeNames: string[];
  argNames: string[];
  paramFiles: Set<string>;
  paramFileRefs: Map<string, string>;
  parameters: Parameter[];
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) =>
    [
      "arg",
      "let",
      "include",
      "group",
      "node",
      "remap",
      "param",
      "node_container",
      "composable_node",
      "load_composable_node",
      "push-ros-namespace"
    ].includes(name)
});

export const hiddenTopicNames = new Set(["/parameter_events", "/parameter_event", "/rosout"]);

export function isHiddenTopic(topicName: string): boolean {
  const normalized = topicName.replace(/\/+$/, "");
  return hiddenTopicNames.has(normalized || topicName);
}

function visibleTopicEntries(topics: Record<string, string> | undefined): [string, string][] {
  return Object.entries(topics ?? {}).filter(([topicName]) => !isHiddenTopic(topicName));
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  if (absolute) return `/${parts.join("/")}`;
  return parts.join("/") || ".";
}

function resolveFilePath(value: string, currentDir: string): string {
  if (!value) return value;
  return value.startsWith("/") ? normalizePath(value) : normalizePath(`${currentDir}/${value}`);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeRosNamespace(namespace: string | undefined): string {
  if (!namespace) return "";
  const cleaned = namespace.trim().replace(/\/+/g, "/").replace(/\/+$/g, "");
  if (!cleaned || cleaned === "/") return "";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function normalizeRosName(name: string): string {
  const cleaned = name.trim().replace(/\/+/g, "/").replace(/\/+$/g, "");
  return cleaned === "/" ? "" : cleaned;
}

function joinRosName(name: string, namespace: string | undefined): string {
  const cleanedName = normalizeRosName(name);
  if (!cleanedName || cleanedName.startsWith("/")) return cleanedName;
  const cleanedNamespace = normalizeRosNamespace(namespace);
  return cleanedNamespace ? `${cleanedNamespace}/${cleanedName}` : cleanedName;
}

function joinRosNamespace(namespace: string | undefined, parentNamespace: string | undefined): string {
  if (!namespace?.trim()) return normalizeRosNamespace(parentNamespace);
  if (namespace.trim().startsWith("/")) return normalizeRosNamespace(namespace);
  const parent = normalizeRosNamespace(parentNamespace);
  const child = namespace.trim().replace(/^\/+|\/+$/g, "");
  return `${parent}/${child}`.replace(/\/+/g, "/");
}

function resolveRosTopicName(topicName: string, namespace: string | undefined, nodeName: string | undefined): string {
  const cleaned = normalizeRosName(topicName);
  if (!cleaned) return normalizeRosNamespace(namespace) || "/";
  if (cleaned.startsWith("/")) return cleaned;
  if (cleaned.startsWith("~")) {
    const privateName = cleaned.replace(/^~\/?/, "");
    const privateNamespace = nodeName ? normalizeRosNamespace(nodeName) : normalizeRosNamespace(namespace);
    return privateName ? `${privateNamespace || ""}/${privateName}`.replace(/\/+/g, "/") : privateNamespace || "/";
  }
  const cleanedNamespace = normalizeRosNamespace(namespace);
  return `${cleanedNamespace}/${cleaned}`.replace(/\/+/g, "/");
}

function parentNamespaceOf(nodeName: string | undefined): string {
  if (!nodeName) return "";
  const parts = normalizeRosName(nodeName).split("/").filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `/${parts.join("/")}` : "";
}

export function buildPackageIndex(files: FileMap): PackageIndex {
  const index: PackageIndex = {};
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith("package.xml")) continue;
    const parsed = xmlParser.parse(content);
    const name = parsed.package?.name;
    if (typeof name === "string") {
      index[name] = dirname(path);
    }
  }
  return index;
}

function flattenParams(
  nodeId: string,
  nodeName: string,
  value: unknown,
  sourceFile: string,
  prefix = ""
): Parameter[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{ nodeId, nodeName, key: prefix, value: value as Parameter["value"], sourceFile, dirty: false }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenParams(nodeId, nodeName, child, sourceFile, prefix ? `${prefix}.${key}` : key)
  );
}

function loadParamFile(files: FileMap, path: string, nodeId: string, nodeName: string): Parameter[] {
  const content = files[path];
  if (!content) return [];
  const parsed = yaml.load(content) as Record<string, { ros__parameters?: unknown }> | null;
  if (!parsed || typeof parsed !== "object") return [];
  return Object.values(parsed).flatMap((entry) =>
    entry?.ros__parameters ? flattenParams(nodeId, nodeName, entry.ros__parameters, path) : []
  );
}

function ensureLaunchSummary(summaries: Map<string, LaunchSummaryDraft>, launchPath: string): LaunchSummaryDraft {
  const existing = summaries.get(launchPath);
  if (existing) return existing;
  const summary: LaunchSummaryDraft = {
    path: launchPath,
    label: basename(launchPath),
    includePaths: new Set(),
    nodeNames: [],
    argNames: [],
    paramFiles: new Set(),
    paramFileRefs: new Map(),
    parameters: []
  };
  summaries.set(launchPath, summary);
  return summary;
}

function finalizeLaunchSummaries(summaries: Map<string, LaunchSummaryDraft>): LaunchFileNode[] {
  const countNodes = (launchPath: string, visiting = new Set<string>()): number => {
    if (visiting.has(launchPath)) return 0;
    const summary = summaries.get(launchPath);
    if (!summary) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(launchPath);
    return (
      summary.nodeNames.length +
      [...summary.includePaths].reduce((total, includePath) => total + countNodes(includePath, nextVisiting), 0)
    );
  };

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      includePaths: [...summary.includePaths],
      totalNodeCount: countNodes(summary.path),
      paramFiles: [...summary.paramFiles],
      paramFileRefs: Object.fromEntries(summary.paramFileRefs)
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function parseLaunchFile(
  files: FileMap,
  packages: PackageIndex,
  launchPath: string,
  args: Record<string, string>,
  graph: GraphModel,
  visited: Set<string>,
  launchSummaries: Map<string, LaunchSummaryDraft>,
  gateNames: string[] = [],
  inheritedNamespace = ""
) {
  const visitKey = `${launchPath}::${normalizeRosNamespace(inheritedNamespace)}::${JSON.stringify(Object.entries(args).sort())}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);
  const content = files[launchPath];
  if (!content) return;
  const launchSummary = ensureLaunchSummary(launchSummaries, launchPath);
  const parsed = xmlParser.parse(content);
  const launch = parsed.launch ?? {};
  const namespaceForPushes = (pushes: Record<string, unknown> | Record<string, unknown>[] | undefined, baseNamespace: string): string =>
    asArray<Record<string, unknown>>(pushes).reduce((namespace, push) => {
      if (!isElementActive(push as { if?: string; unless?: string }, args, packages)) return namespace;
      return typeof push.namespace === "string" ? joinRosNamespace(resolveValue(push.namespace, args, packages), namespace) : namespace;
    }, baseNamespace);
  let launchNamespace = namespaceForPushes(launch["push-ros-namespace"] as Record<string, unknown> | Record<string, unknown>[] | undefined, inheritedNamespace);

  for (const arg of asArray<Record<string, string>>(launch.arg)) {
    if (arg.name && !launchSummary.argNames.includes(arg.name)) launchSummary.argNames.push(arg.name);
    if (arg.name && arg.default !== undefined && args[arg.name] === undefined) {
      args[arg.name] = resolveValue(arg.default, args, packages);
    }
  }
  for (const letNode of asArray<Record<string, string>>(launch.let)) {
    if (letNode.name && letNode.value !== undefined) {
      args[letNode.name] = resolveValue(letNode.value, args, packages);
    }
  }

  const gatesForElement = (element: Record<string, unknown>, gates: string[]): string[] => {
    const names = [...gates];
    if (typeof element.if === "string") names.push(...conditionArgNames(element.if));
    if (typeof element.unless === "string") names.push(...conditionArgNames(element.unless));
    return [...new Set(names)];
  };

  const addNodeFromRecord = (
    record: Record<string, unknown>,
    nodeName: string,
    nodeId: string,
    packageName: string | undefined,
    executable: string | undefined,
    gates: string[],
    namespace: string,
    restartTarget?: RestartTarget,
    runtimeAliases: string[] = []
  ) => {
    const inputs: Pin[] = [];
    const outputs: Pin[] = [];
    const params: Parameter[] = [];

    for (const remap of asArray<Record<string, string>>(record.remap as Record<string, string>[])) {
      const rawFrom = remap.from ?? "";
      const from = resolveValue(rawFrom, args, packages);
      const to = resolveRosTopicName(resolveValue(remap.to ?? from, args, packages), namespace, nodeId);
      if (isHiddenTopic(to)) continue;
      const kind = from.includes("output") || from.includes("pub") ? "output" : "input";
      const pin: Pin = {
        id: `${nodeId}:${kind}:${to}`,
        nodeId,
        topicName: to,
        dataType: "unknown",
        kind,
        remapFrom: rawFrom
      };
      if (kind === "output") outputs.push(pin);
      else inputs.push(pin);
    }

    for (const param of asArray<Record<string, string>>(record.param as Record<string, string>[])) {
      if (param.from) {
        const paramPath = resolveFilePath(resolveValue(param.from, args, packages), dirname(launchPath));
        const loadedParams = loadParamFile(files, paramPath, nodeId, nodeName);
        params.push(...loadedParams);
        launchSummary.paramFiles.add(paramPath);
        launchSummary.paramFileRefs.set(param.from, paramPath);
        launchSummary.parameters.push(...loadedParams);
      } else if (param.name) {
        const inlineParam = {
          nodeId,
          nodeName,
          key: param.name,
          value: param.value ?? null,
          sourceFile: launchPath,
          dirty: false
        };
        params.push(inlineParam);
        launchSummary.parameters.push(inlineParam);
      }
    }

    launchSummary.nodeNames.push(nodeName);
    graph.nodes.push({
      id: nodeId,
      name: nodeName,
      packageName,
      executable,
      launchFile: launchPath,
      inputs,
      outputs,
      params,
      isPsim: nodeName.toLowerCase().includes("psim"),
      gatedBy: gates,
      restartTarget,
      runtimeAliases
    });
  };

  const visitNode = (node: Record<string, unknown>, gates: string[]) => {
    if (!isElementActive(node as { if?: string; unless?: string }, args, packages)) return;
    const nodeName = String(node.name ?? node.exec ?? `node_${graph.nodes.length}`);
    const namespace =
      typeof node.namespace === "string"
        ? joinRosNamespace(resolveValue(node.namespace, args, packages), launchNamespace)
        : normalizeRosNamespace(launchNamespace);
    const runtimeName = joinRosName(nodeName, namespace);
    addNodeFromRecord(
      node,
      nodeName,
      runtimeName,
      typeof node.pkg === "string" ? node.pkg : undefined,
      typeof node.exec === "string" ? node.exec : undefined,
      gatesForElement(node, gates),
      namespace,
      {
        kind: "standalone_node",
        nodeName: runtimeName,
        restartName: runtimeName,
        launchFile: launchPath,
        reason: "Standalone ROS node."
      },
      uniqueStrings([runtimeName])
    );
  };

  const visitComposableNode = (
    composable: Record<string, unknown>,
    gates: string[],
    context: { containerName?: string; namespace?: string } = {}
  ) => {
    if (!isElementActive(composable as { if?: string; unless?: string }, args, packages)) return;
    const name = String(composable.name ?? composable.plugin ?? `composable_${graph.nodes.length}`);
    const ownNamespace = typeof composable.namespace === "string" ? resolveValue(composable.namespace, args, packages) : undefined;
    const namespace =
      ownNamespace === undefined || ownNamespace === ""
        ? normalizeRosNamespace(context.namespace)
        : ownNamespace.startsWith("/")
          ? ownNamespace
          : joinRosName(ownNamespace, context.namespace);
    const runtimeName = joinRosName(name, namespace);
    const plugin = typeof composable.plugin === "string" ? composable.plugin : undefined;
    const restartName = context.containerName ?? runtimeName;
    addNodeFromRecord(
      composable,
      name,
      runtimeName,
      typeof composable.pkg === "string" ? composable.pkg : undefined,
      plugin,
      gatesForElement(composable, gates),
      namespace,
      {
        kind: "component",
        nodeName: runtimeName,
        restartName,
        containerName: context.containerName,
        plugin,
        launchFile: launchPath,
        reason: context.containerName
          ? "Composable node parameters require reloading the component or restarting its container."
          : "Composable node parameters require reloading the component."
      },
      uniqueStrings([runtimeName, restartName])
    );
  };

  const visitNodeContainer = (container: Record<string, unknown>, gates: string[]) => {
    if (!isElementActive(container as { if?: string; unless?: string }, args, packages)) return;
    const childGates = gatesForElement(container, gates);
    const containerName = String(container.name ?? container.exec ?? `container_${graph.nodes.length}`);
    const namespace =
      typeof container.namespace === "string"
        ? joinRosNamespace(resolveValue(container.namespace, args, packages), launchNamespace)
        : normalizeRosNamespace(launchNamespace);
    const runtimeContainerName = joinRosName(containerName, namespace);
    addNodeFromRecord(
      container,
      containerName,
      runtimeContainerName,
      typeof container.pkg === "string" ? container.pkg : undefined,
      typeof container.exec === "string" ? container.exec : undefined,
      childGates,
      namespace,
      {
        kind: "container",
        nodeName: runtimeContainerName,
        restartName: runtimeContainerName,
        containerName: runtimeContainerName,
        launchFile: launchPath,
        reason: "Composable node container."
      },
      uniqueStrings([runtimeContainerName])
    );
    for (const composable of asArray<Record<string, unknown>>(container.composable_node as Record<string, unknown>[])) {
      visitComposableNode(composable, childGates, { containerName: runtimeContainerName, namespace });
    }
  };

  const visitLoadComposableNode = (load: Record<string, unknown>, gates: string[]) => {
    if (!isElementActive(load as { if?: string; unless?: string }, args, packages)) return;
    const childGates = gatesForElement(load, gates);
    const target =
      typeof load.target === "string" ? joinRosName(resolveValue(load.target, args, packages), launchNamespace) : undefined;
    const namespace = parentNamespaceOf(target);
    for (const composable of asArray<Record<string, unknown>>(load.composable_node as Record<string, unknown>[])) {
      visitComposableNode(composable, childGates, { containerName: target, namespace });
    }
  };

  const visitInclude = (include: Record<string, unknown>, gates: string[]) => {
    if (typeof include.file !== "string") return;
    if (!isElementActive(include as { if?: string; unless?: string }, args, packages)) return;
    const childGates = gatesForElement(include, gates);
    const childArgs = { ...args };
    for (const arg of asArray<Record<string, string>>(include.arg as Record<string, string>[])) {
      if (arg.name && arg.value !== undefined) childArgs[arg.name] = resolveValue(arg.value, childArgs, packages);
    }
    const resolved = resolveFilePath(resolveValue(include.file, childArgs, packages), dirname(launchPath));
    graph.includes.push({ fromLaunch: launchPath, toLaunch: resolved });
    launchSummary.includePaths.add(resolved);
    ensureLaunchSummary(launchSummaries, resolved);
    graph.launchGraph.edges.push({
      id: `${launchPath}->${resolved}`,
      source: launchPath,
      target: resolved
    });
    if (resolved.endsWith(".xml")) {
      parseLaunchFile(files, packages, resolved, childArgs, graph, visited, launchSummaries, childGates, launchNamespace);
    } else {
      graph.nodes.push({
        id: resolved,
        name: basename(resolved),
        launchFile: launchPath,
        executable: resolved,
        inputs: [],
        outputs: [],
        params: [],
        isLaunchInclude: true,
        gatedBy: childGates,
        restartTarget: {
          kind: "launch_only",
          nodeName: basename(resolved),
          restartName: basename(resolved),
          launchFile: launchPath,
          reason: "This include is not a concrete ROS node."
        }
      });
    }
  };

  const visitGroup = (group: Record<string, unknown>, gates: string[]) => {
    if (!isElementActive(group as { if?: string; unless?: string }, args, packages)) return;
    const childGates = gatesForElement(group, gates);
    const parentNamespace = launchNamespace;
    const groupNamespace = namespaceForPushes(
      group["push-ros-namespace"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
      parentNamespace
    );
    const previousNamespace = launchNamespace;
    launchNamespace = groupNamespace;
    for (const include of asArray<Record<string, unknown>>(group.include as Record<string, unknown>[])) visitInclude(include, childGates);
    for (const node of asArray<Record<string, unknown>>(group.node as Record<string, unknown>[])) visitNode(node, childGates);
    for (const container of asArray<Record<string, unknown>>(group.node_container as Record<string, unknown>[])) visitNodeContainer(container, childGates);
    for (const load of asArray<Record<string, unknown>>(group.load_composable_node as Record<string, unknown>[])) visitLoadComposableNode(load, childGates);
    for (const child of asArray<Record<string, unknown>>(group.group as Record<string, unknown>[])) visitGroup(child, childGates);
    launchNamespace = previousNamespace;
  };

  for (const include of asArray<Record<string, unknown>>(launch.include)) visitInclude(include, gateNames);
  for (const node of asArray<Record<string, unknown>>(launch.node)) visitNode(node, gateNames);
  for (const container of asArray<Record<string, unknown>>(launch.node_container)) visitNodeContainer(container, gateNames);
  for (const load of asArray<Record<string, unknown>>(launch.load_composable_node)) visitLoadComposableNode(load, gateNames);
  for (const group of asArray<Record<string, unknown>>(launch.group)) visitGroup(group, gateNames);
}

export function buildEdges(nodes: GraphNode[]): GraphEdge[] {
  const publishers = new Map<string, GraphNode[]>();
  const subscribers = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    for (const pin of node.outputs) {
      if (isHiddenTopic(pin.topicName)) continue;
      publishers.set(pin.topicName, [...(publishers.get(pin.topicName) ?? []), node]);
    }
    for (const pin of node.inputs) {
      if (isHiddenTopic(pin.topicName)) continue;
      subscribers.set(pin.topicName, [...(subscribers.get(pin.topicName) ?? []), node]);
    }
  }
  const edges: GraphEdge[] = [];
  for (const [topic, sourceNodes] of publishers.entries()) {
    for (const source of sourceNodes) {
      for (const target of subscribers.get(topic) ?? []) {
        if (source.id === target.id) continue;
        const outputType = source.outputs.find((pin) => pin.topicName === topic)?.dataType ?? "unknown";
        const inputType = target.inputs.find((pin) => pin.topicName === topic)?.dataType ?? "unknown";
        edges.push({
          id: `${source.id}->${target.id}:${topic}`,
          source: source.id,
          target: target.id,
          topicName: topic,
          dataType: outputType !== "unknown" ? outputType : inputType
        });
      }
    }
  }
  return edges;
}

export function parseStaticGraph(files: FileMap, entryLaunch: string, launchArgs: LaunchArgs): GraphModel {
  const graph: GraphModel = { nodes: [], edges: [], includes: [], launchGraph: { launches: [], edges: [] } };
  const launchSummaries = new Map<string, LaunchSummaryDraft>();
  const packages = buildPackageIndex(files);
  parseLaunchFile(files, packages, entryLaunch, { ...launchArgs }, graph, new Set(), launchSummaries);
  graph.edges = buildEdges(graph.nodes);
  graph.launchGraph.launches = finalizeLaunchSummaries(launchSummaries);
  return graph;
}

// Build a graph purely from a runtime dump (ros2 node list + pub/sub). This is the source of
// truth for "what is actually running" — it includes .launch.py and framework-generated nodes
// that static analysis cannot see.
export function buildRuntimeGraph(resolved: ResolvedGraph): GraphModel {
  const nodes: GraphNode[] = resolved.nodes.map((resolvedNode) => {
    const inputs = visibleTopicEntries(resolvedNode.subscribers).map(([topicName, dataType]) => ({
      id: `${resolvedNode.name}:input:${topicName}`,
      nodeId: resolvedNode.name,
      topicName,
      dataType,
      kind: "input" as const
    }));
    const outputs = visibleTopicEntries(resolvedNode.publishers).map(([topicName, dataType]) => ({
      id: `${resolvedNode.name}:output:${topicName}`,
      nodeId: resolvedNode.name,
      topicName,
      dataType,
      kind: "output" as const
    }));
    return {
      id: resolvedNode.name,
      name: resolvedNode.name,
      packageName: resolvedNode.package,
      executable: resolvedNode.executable_or_plugin,
      launchFile: "runtime",
      inputs,
      outputs,
      params: [],
      isPsim: resolvedNode.name.toLowerCase().includes("psim")
    };
  });
  return { nodes, edges: buildEdges(nodes), includes: [], launchGraph: { launches: [], edges: [] } };
}

function normalizedNodeName(name: string): string {
  return name.replace(/^\/+/, "");
}

function staticLookupNames(node: GraphNode): string[] {
  return uniqueStrings([
    node.name,
    normalizedNodeName(node.name),
    node.restartTarget?.nodeName,
    node.restartTarget ? normalizedNodeName(node.restartTarget.nodeName) : undefined,
    node.restartTarget?.restartName,
    node.restartTarget ? normalizedNodeName(node.restartTarget.restartName) : undefined,
    ...(node.runtimeAliases ?? []),
    ...(node.runtimeAliases ?? []).map(normalizedNodeName)
  ]);
}

function staticParamsForRuntimeNode(staticNode: GraphNode, runtimeNode: GraphNode): Parameter[] {
  return staticNode.params.map((param) => ({
    ...param,
    nodeId: runtimeNode.name,
    nodeName: runtimeNode.name,
    sourceNodeName: param.sourceNodeName ?? param.nodeName
  }));
}

export function mergeRuntimeGraphWithStaticGraph(runtimeGraph: GraphModel, staticGraph: GraphModel): GraphModel {
  const staticByName = new Map<string, GraphNode>();
  for (const node of staticGraph.nodes) {
    for (const name of staticLookupNames(node)) {
      staticByName.set(name, node);
    }
  }

  return {
    ...runtimeGraph,
    includes: staticGraph.includes,
    launchGraph: staticGraph.launchGraph,
    nodes: runtimeGraph.nodes.map((runtimeNode) => {
      const staticNode = staticByName.get(runtimeNode.name) ?? staticByName.get(normalizedNodeName(runtimeNode.name));
      if (!staticNode) return runtimeNode;
      const remapFromByTopic = new Map<string, string>();
      for (const pin of [...staticNode.inputs, ...staticNode.outputs]) {
        if (pin.remapFrom) remapFromByTopic.set(`${pin.kind}:${pin.topicName}`, pin.remapFrom);
      }
      const withStaticRemap = (pin: Pin): Pin => {
        const remapFrom = remapFromByTopic.get(`${pin.kind}:${pin.topicName}`);
        return remapFrom ? { ...pin, remapFrom } : pin;
      };
      return {
        ...runtimeNode,
        inputs: runtimeNode.inputs.map(withStaticRemap),
        outputs: runtimeNode.outputs.map(withStaticRemap),
        launchFile: staticNode.launchFile,
        packageName: runtimeNode.packageName ?? staticNode.packageName,
        executable: runtimeNode.executable ?? staticNode.executable,
        params: [...staticParamsForRuntimeNode(staticNode, runtimeNode), ...runtimeNode.params.filter((param) => param.dynamic)],
        isPsim: runtimeNode.isPsim || staticNode.isPsim,
        gatedBy: staticNode.gatedBy,
        restartTarget: staticNode.restartTarget
          ? {
              ...staticNode.restartTarget,
              nodeName: runtimeNode.name,
              restartName:
                staticNode.restartTarget.kind === "component"
                  ? staticNode.restartTarget.restartName
                  : runtimeNode.name
            }
          : runtimeNode.restartTarget,
        runtimeAliases: uniqueStrings([...(runtimeNode.runtimeAliases ?? []), ...(staticNode.runtimeAliases ?? [])])
      };
    })
  };
}

export function mergeResolvedGraph(graph: GraphModel, resolved: ResolvedGraph): GraphModel {
  const nodesByName = new Map(graph.nodes.map((node) => [node.name, node]));
  const mergedNodes = [...graph.nodes];
  for (const resolvedNode of resolved.nodes) {
    const existing = nodesByName.get(resolvedNode.name);
    const inputs = visibleTopicEntries(resolvedNode.subscribers).map(([topicName, dataType]) => ({
      id: `${resolvedNode.name}:input:${topicName}`,
      nodeId: resolvedNode.name,
      topicName,
      dataType,
      kind: "input" as const
    }));
    const outputs = visibleTopicEntries(resolvedNode.publishers).map(([topicName, dataType]) => ({
      id: `${resolvedNode.name}:output:${topicName}`,
      nodeId: resolvedNode.name,
      topicName,
      dataType,
      kind: "output" as const
    }));

    if (existing) {
      existing.inputs = inputs;
      existing.outputs = outputs;
      existing.packageName = resolvedNode.package ?? existing.packageName;
      existing.executable = resolvedNode.executable_or_plugin ?? existing.executable;
    } else {
      mergedNodes.push({
        id: resolvedNode.name,
        name: resolvedNode.name,
        packageName: resolvedNode.package,
        executable: resolvedNode.executable_or_plugin,
        launchFile: "resolved_graph.json",
        inputs,
        outputs,
        params: [],
        isPsim: resolvedNode.name.toLowerCase().includes("psim")
      });
    }
  }
  return { ...graph, nodes: mergedNodes, edges: buildEdges(mergedNodes) };
}
