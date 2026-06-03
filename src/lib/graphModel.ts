export type PinKind = "input" | "output";

export type Pin = {
  id: string;
  nodeId: string;
  topicName: string;
  dataType: string;
  kind: PinKind;
  // Raw, unresolved `from` attribute of the <remap> that produced this pin (e.g.
  // "~/output/trajectory"). This is the stable anchor used to rewrite the remap
  // on save, since `topicName` is resolved while the XML keeps `to="$(var ...)"`.
  remapFrom?: string;
};

export type Parameter = {
  nodeId: string;
  nodeName: string;
  key: string;
  value: string | number | boolean | null;
  sourceFile: string;
  dirty: boolean;
  dynamic?: boolean;
  parameterType?: string;
  readOnly?: boolean;
  sourceNodeName?: string;
};

export type RestartTargetKind = "standalone_node" | "component" | "container" | "launch_only" | "unsupported";

export type RestartTarget = {
  kind: RestartTargetKind;
  nodeName: string;
  restartName: string;
  containerName?: string;
  plugin?: string;
  launchFile?: string;
  reason?: string;
};

export type GraphNode = {
  id: string;
  name: string;
  packageName?: string;
  executable?: string;
  launchFile: string;
  inputs: Pin[];
  outputs: Pin[];
  params: Parameter[];
  isLaunchInclude?: boolean;
  isPsim?: boolean;
  disabled?: boolean;
  isAdded?: boolean;
  swappable?: boolean;
  staticParamCount?: number;
  dynamicParamCount?: number;
  gatedBy?: string[];
  restartTarget?: RestartTarget;
  runtimeAliases?: string[];
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  topicName: string;
  dataType: string;
};

export type IncludeEdge = {
  fromLaunch: string;
  toLaunch: string;
};

export type LaunchGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type LaunchStatus = "original" | "provisional" | "ghost" | "overridden";

export type LaunchFileNode = {
  path: string;
  label: string;
  includePaths: string[];
  nodeNames: string[];
  totalNodeCount: number;
  argNames: string[];
  paramFiles: string[];
  parameters: Parameter[];
  status?: LaunchStatus;
  // Maps the raw `from` expression of each <param from="..."> in this launch
  // file (e.g. "$(var common_param_path)") to the path the parser resolved it to
  // using this file's scoped args. The save step uses this to rewrite param refs
  // to forks, since the same arg name can resolve differently per include scope.
  paramFileRefs?: Record<string, string>;
};

export type LaunchGraphModel = {
  launches: LaunchFileNode[];
  edges: LaunchGraphEdge[];
};

export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  includes: IncludeEdge[];
  launchGraph: LaunchGraphModel;
};

export type LaunchArgs = Record<string, string>;

export type ResolvedNode = {
  name: string;
  package?: string;
  executable_or_plugin?: string;
  publishers?: Record<string, string>;
  subscribers?: Record<string, string>;
  parameters?: Record<string, unknown>;
};

export type ResolvedGraph = {
  nodes: ResolvedNode[];
};
