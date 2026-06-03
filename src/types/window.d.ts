export type ReachableFilesRequest = {
  entryLaunch: string;
  launchArgs: Record<string, string>;
};

export type ReachableFilesResult = {
  files: Record<string, string>;
  sourceRoot: string;
  packageRoots?: string[];
  searchedRoots?: string[];
};

export type ReachableFilesResponse = Record<string, string> | ReachableFilesResult;

export type ChooseLaunchFileRequest = {
  defaultPath?: string;
};

export type ChooseOutputFolderRequest = {
  defaultPath?: string;
};

export type DynamicRosParameter = {
  nodeName: string;
  paramName: string;
  value: string | number | boolean | null;
  parameterType: string;
  readOnly: boolean;
  description?: string;
};

export type RestartNodeRequest = {
  nodeName: string;
  targetName?: string;
  kind?: string;
  containerName?: string;
  plugin?: string;
  generatedEntryLaunch?: string;
  latestEntryLaunch?: string;
  runDir?: string;
  latestDir?: string;
};

export type TextFileEntry = {
  relativePath: string;
  content: string;
};

export type ElectronApi = {
  readReachableFiles(request: ReachableFilesRequest): Promise<ReachableFilesResponse>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  writeTextFilesAtomically(rootDir: string, files: TextFileEntry[]): Promise<void>;
  removePath(path: string): Promise<void>;
  getOutputRoot(): Promise<string>;
  chooseLaunchFile(request: ChooseLaunchFileRequest): Promise<string | null>;
  chooseOutputFolder(request: ChooseOutputFolderRequest): Promise<string | null>;
  pathForFile(file: File): string;
  rosParamSet(nodeName: string, paramName: string, value: string): Promise<void>;
  rosDynamicParams(nodeNames: string[]): Promise<DynamicRosParameter[]>;
  restartNode(request: RestartNodeRequest | string): Promise<void>;
  ensureRosbridge(url: string): Promise<{ alreadyRunning: boolean }>;
};

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export {};
