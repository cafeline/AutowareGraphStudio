import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import {
  collectReachableFiles,
  readText,
  removePath,
  restartNode,
  listDynamicRosParameters,
  rosParamSet,
  writeText,
  writeTextFilesAtomically,
  type ReachableFilesResult
} from "./ipc/files";
import { ensureRosbridge, stopManagedRosbridge } from "./ipc/rosbridge";

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

const outputRootDirectoryName = "autoware_graph_studio_overrides";

function outputRoot(): string {
  const baseDir = app.isPackaged ? process.cwd() : app.getAppPath();
  return path.resolve(process.env.AUTOWARE_GRAPH_STUDIO_OUTPUT_ROOT ?? path.join(baseDir, outputRootDirectoryName));
}

function asAutowareGraphStudioOutputRoot(dirPath: string): string {
  const resolvedPath = path.resolve(dirPath);
  return path.basename(resolvedPath) === outputRootDirectoryName
    ? resolvedPath
    : path.join(resolvedPath, outputRootDirectoryName);
}

function registerIpc(): void {
  ipcMain.handle("files:reachable", (_event, request: ReachableFilesRequest): Promise<ReachableFilesResult> =>
    collectReachableFiles(request.entryLaunch, request.launchArgs)
  );
  ipcMain.handle("files:readText", (_event, filePath: string) => readText(filePath));
  ipcMain.handle("files:writeText", (_event, filePath: string, content: string) => writeText(filePath, content));
  ipcMain.handle("files:writeTextFilesAtomically", (_event, rootDir: string, files: Parameters<typeof writeTextFilesAtomically>[1]) =>
    writeTextFilesAtomically(rootDir, files)
  );
  ipcMain.handle("files:removePath", (_event, filePath: string) => removePath(filePath));
  ipcMain.handle("paths:outputRoot", () => outputRoot());
  ipcMain.handle("dialog:chooseLaunchFile", async (event, request: ChooseLaunchFileRequest) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: "Choose launch file",
      defaultPath: request.defaultPath,
      properties: ["openFile"],
      filters: [
        { name: "ROS launch XML", extensions: ["xml"] },
        { name: "All files", extensions: ["*"] }
      ]
    } satisfies Electron.OpenDialogOptions;
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selectedPath = result.filePaths[0];
    return result.canceled || !selectedPath ? null : selectedPath;
  });
  ipcMain.handle("dialog:chooseOutputFolder", async (event, request: ChooseOutputFolderRequest) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: "Choose output folder",
      defaultPath: request.defaultPath ?? outputRoot(),
      properties: ["openDirectory", "createDirectory"]
    } satisfies Electron.OpenDialogOptions;
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("ros:paramSet", (_event, nodeName: string, paramName: string, value: string) =>
    rosParamSet(nodeName, paramName, value)
  );
  ipcMain.handle("ros:dynamicParams", (_event, nodeNames: string[]) => listDynamicRosParameters(nodeNames));
  ipcMain.handle("ros:restart", (_event, request: Parameters<typeof restartNode>[0]) => restartNode(request));
  ipcMain.handle("rosbridge:ensure", (_event, url: string) => ensureRosbridge(url));
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc();
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  stopManagedRosbridge();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopManagedRosbridge();
});
