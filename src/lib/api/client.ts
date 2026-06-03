import type { GraphModel } from "../graphModel";
import { parseStaticGraph } from "../parser";
import { discoverSwitchArgs, type SwitchArg } from "../launchSwitches";
import type { DynamicRosParameter, ReachableFilesResponse, RestartNodeRequest, TextFileEntry } from "../../types/window";

export type FileMap = Record<string, string>;

export type LoadGraphRequest = {
  entryLaunch: string;
  launchArgs: Record<string, string>;
};

export type ReachableFilesResult = {
  files: FileMap;
  sourceRoot: string;
  packageRoots: string[];
  searchedRoots: string[];
};

export type GraphLoadResult = { graph: GraphModel; switchArgs: SwitchArg[]; sourceRoot: string };

function api() {
  return window.api;
}

export async function readTextFile(path: string): Promise<string | null> {
  return api().readText(path);
}

function inferSourceRoot(entryLaunch: string): string {
  const absolute = entryLaunch.startsWith("/");
  const segments = entryLaunch.split("/").filter(Boolean);
  const srcIndex = segments.lastIndexOf("src");
  if (srcIndex >= 0) return `${absolute ? "/" : ""}${segments.slice(0, srcIndex + 1).join("/")}`;
  const installIndex = segments.lastIndexOf("install");
  if (installIndex >= 0) return `${absolute ? "/" : ""}${segments.slice(0, installIndex + 1).join("/")}`;
  const launchIndex = segments.lastIndexOf("launch");
  if (launchIndex >= 2) return `${absolute ? "/" : ""}${segments.slice(0, launchIndex - 1).join("/")}`;
  return `${absolute ? "/" : ""}${segments.slice(0, -1).join("/")}`;
}

function normalizeReachableFilesResult(response: ReachableFilesResponse, entryLaunch: string): ReachableFilesResult {
  const structured = response as Partial<ReachableFilesResult>;
  if (structured.files && typeof structured.files === "object" && !Array.isArray(structured.files)) {
    return {
      files: structured.files,
      sourceRoot: structured.sourceRoot || inferSourceRoot(entryLaunch),
      packageRoots: structured.packageRoots ?? [],
      searchedRoots: structured.searchedRoots ?? []
    };
  }
  return {
    files: response as FileMap,
    sourceRoot: inferSourceRoot(entryLaunch),
    packageRoots: [],
    searchedRoots: []
  };
}

export async function readReachableFiles(request: LoadGraphRequest): Promise<ReachableFilesResult> {
  const response = await api().readReachableFiles(request);
  return normalizeReachableFilesResult(response, request.entryLaunch);
}

export async function loadGraphResult(request: LoadGraphRequest): Promise<GraphLoadResult> {
  const { files, sourceRoot } = await readReachableFiles(request);
  const graph = parseStaticGraph(files, request.entryLaunch, request.launchArgs);
  return { graph, switchArgs: discoverSwitchArgs(files), sourceRoot };
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await api().writeText(path, content);
}

export async function writeTextFilesAtomically(rootDir: string, files: TextFileEntry[]): Promise<void> {
  await api().writeTextFilesAtomically(rootDir, files);
}

export async function removePath(path: string): Promise<void> {
  await api().removePath(path);
}

export async function getOutputRoot(): Promise<string> {
  return api().getOutputRoot();
}

export async function chooseLaunchFile(request: { defaultPath?: string }): Promise<string | null> {
  return api().chooseLaunchFile(request);
}

export async function chooseOutputFolder(request: { defaultPath?: string }): Promise<string | null> {
  return api().chooseOutputFolder(request);
}

export async function setRosParam(nodeName: string, paramName: string, value: unknown): Promise<void> {
  await api().rosParamSet(nodeName, paramName, String(value));
}

export async function listDynamicRosParameters(nodeNames: string[]): Promise<DynamicRosParameter[]> {
  return api().rosDynamicParams(nodeNames);
}

export async function restartRosNode(request: RestartNodeRequest | string): Promise<void> {
  await api().restartNode(request);
}

export async function ensureRosbridge(url: string): Promise<{ alreadyRunning: boolean }> {
  return api().ensureRosbridge(url);
}
