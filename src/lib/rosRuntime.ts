import type { GraphNode, RestartTarget } from "./graphModel";

export type RestartContext = {
  generatedEntryLaunch?: string;
  latestEntryLaunch?: string;
  runDir?: string;
  latestDir?: string;
};

export type RestartCommandRequest = {
  nodeName: string;
  targetName: string;
  kind: RestartTarget["kind"];
  containerName?: string;
  plugin?: string;
  generatedEntryLaunch?: string;
  latestEntryLaunch?: string;
  runDir?: string;
  latestDir?: string;
};

export function fallbackRestartTarget(node: Pick<GraphNode, "name" | "launchFile" | "isLaunchInclude">): RestartTarget {
  if (node.isLaunchInclude) {
    return {
      kind: "launch_only",
      nodeName: node.name,
      restartName: node.name,
      launchFile: node.launchFile,
      reason: "This entry is a launch include, not a concrete ROS node."
    };
  }
  return {
    kind: "standalone_node",
    nodeName: node.name,
    restartName: node.name,
    launchFile: node.launchFile,
    reason: "No component metadata was found, so this is treated as a standalone node restart target."
  };
}

export function restartTargetForNode(node: Pick<GraphNode, "name" | "launchFile" | "isLaunchInclude" | "restartTarget">): RestartTarget {
  return node.restartTarget ?? fallbackRestartTarget(node);
}

export function restartRequestForTarget(target: RestartTarget, context: RestartContext = {}): RestartCommandRequest | null {
  if (target.kind === "launch_only" || target.kind === "unsupported") return null;
  const targetName = target.restartName || target.containerName || target.nodeName;
  return {
    nodeName: target.nodeName,
    targetName,
    kind: target.kind,
    containerName: target.containerName,
    plugin: target.plugin,
    generatedEntryLaunch: context.generatedEntryLaunch,
    latestEntryLaunch: context.latestEntryLaunch,
    runDir: context.runDir,
    latestDir: context.latestDir
  };
}

export function describeRestartTarget(target: RestartTarget): string {
  if (target.kind === "component") {
    return target.containerName ? `${target.nodeName} via ${target.containerName}` : target.nodeName;
  }
  return target.restartName || target.nodeName;
}

