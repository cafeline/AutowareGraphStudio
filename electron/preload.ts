import { contextBridge, ipcRenderer, webUtils } from "electron";

type ReachableFilesRequest = {
  entryLaunch: string;
  launchArgs: Record<string, string>;
};

type ChooseLaunchFileRequest = {
  defaultPath?: string;
};

type ChooseOutputFolderRequest = {
  defaultPath?: string;
};

type RestartNodeRequest = {
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

type TextFileEntry = {
  relativePath: string;
  content: string;
};

contextBridge.exposeInMainWorld("api", {
  readReachableFiles: (request: ReachableFilesRequest) => ipcRenderer.invoke("files:reachable", request),
  readText: (filePath: string) => ipcRenderer.invoke("files:readText", filePath),
  writeText: (filePath: string, content: string) => ipcRenderer.invoke("files:writeText", filePath, content),
  writeTextFilesAtomically: (rootDir: string, files: TextFileEntry[]) =>
    ipcRenderer.invoke("files:writeTextFilesAtomically", rootDir, files),
  removePath: (filePath: string) => ipcRenderer.invoke("files:removePath", filePath),
  getOutputRoot: () => ipcRenderer.invoke("paths:outputRoot"),
  chooseLaunchFile: (request: ChooseLaunchFileRequest) => ipcRenderer.invoke("dialog:chooseLaunchFile", request),
  chooseOutputFolder: (request: ChooseOutputFolderRequest) => ipcRenderer.invoke("dialog:chooseOutputFolder", request),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  rosParamSet: (nodeName: string, paramName: string, value: string) =>
    ipcRenderer.invoke("ros:paramSet", nodeName, paramName, value),
  rosDynamicParams: (nodeNames: string[]) => ipcRenderer.invoke("ros:dynamicParams", nodeNames),
  restartNode: (request: RestartNodeRequest | string) => ipcRenderer.invoke("ros:restart", request),
  ensureRosbridge: (url: string) => ipcRenderer.invoke("rosbridge:ensure", url)
});
