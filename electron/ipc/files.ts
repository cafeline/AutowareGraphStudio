import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveValue } from "../../src/lib/launchConditions";

const execAsync = promisify(exec);

export type FileMap = Record<string, string>;
export type TextFileEntry = {
  relativePath: string;
  content: string;
};
export type ReachableFilesResult = {
  files: FileMap;
  sourceRoot: string;
  packageRoots: string[];
  searchedRoots: string[];
};
type ArgMap = Record<string, string>;
type PackageIndex = Record<string, string>;

const SUPPORTED = new Set([".xml", ".yaml", ".yml"]);
const SKIPPED_WALK_DIRS = new Set([".git", "node_modules", "target", "dist", "dist-app", "out", "build", "log"]);
const ROS_PARAM_SCAN_BUDGET_MS = Number(process.env.AUTOWARE_GRAPH_STUDIO_DYNAMIC_PARAM_SCAN_BUDGET_MS ?? "15000");
const ROS_PARAM_LIST_TIMEOUT_MS = Number(process.env.AUTOWARE_GRAPH_STUDIO_DYNAMIC_PARAM_LIST_TIMEOUT_MS ?? "7000");
const ROS_PARAM_LIST_ALL_TIMEOUT_MS = Number(process.env.AUTOWARE_GRAPH_STUDIO_DYNAMIC_PARAM_LIST_ALL_TIMEOUT_MS ?? "12000");
// These bound the runtime parameter scan. They must be generous: the list is the
// source of truth for which node declares which parameter (see
// reconcileRuntimeParameters), so an under-count would wrongly hide valid
// parameters. Listing only collects names/types (no per-parameter ROS calls), so
// a high per-node cap is cheap; large planning nodes have a few hundred params.
const ROS_PARAM_MAX_NODES = Number(process.env.AUTOWARE_GRAPH_STUDIO_DYNAMIC_PARAM_MAX_NODES ?? "400");
const ROS_PARAM_MAX_PER_NODE = Number(process.env.AUTOWARE_GRAPH_STUDIO_DYNAMIC_PARAM_MAX_PER_NODE ?? "2000");
const ROS_PARAM_LIST_MAX_BUFFER = Number(process.env.AUTOWARE_GRAPH_STUDIO_DYNAMIC_PARAM_LIST_MAX_BUFFER ?? String(16 * 1024 * 1024));

export type DynamicRosParameter = {
  nodeName: string;
  paramName: string;
  value: string | number | boolean | null;
  parameterType: string;
  readOnly: boolean;
  description?: string;
};

type ListedRosParameter = {
  name: string;
  parameterType: string;
};

function isSupported(filePath: string): boolean {
  return SUPPORTED.has(path.extname(filePath));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, onFile: (file: string) => void, seen = new Set<string>()): Promise<void> {
  let realDir = path.resolve(dir);
  try {
    realDir = await fs.realpath(dir);
  } catch {
    // Keep the resolved path; readdir below will safely return on missing roots.
  }
  if (seen.has(realDir)) return;
  seen.add(realDir);

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_WALK_DIRS.has(entry.name)) continue;
      await walk(full, onFile, seen);
    }
    else if (entry.isFile()) onFile(full);
  }
}

function attrValue(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return undefined;
  return match[2] ?? match[3] ?? "";
}

function tagsNamed(content: string, name: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b[^>]*>`, "g");
  for (const match of content.matchAll(re)) tags.push(match[0]);
  return tags;
}

function blocksNamed(content: string, name: string): string[] {
  // self-closing <name .../> or <name ...> ... </name>
  const blocks: string[] = [];
  const open = new RegExp(`<${name}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(content)) !== null) {
    const start = match.index;
    const gt = content.indexOf(">", start);
    if (gt === -1) break;
    if (content[gt - 1] === "/") {
      blocks.push(content.slice(start, gt + 1));
      open.lastIndex = gt + 1;
      continue;
    }
    const close = content.indexOf(`</${name}>`, gt);
    if (close === -1) {
      blocks.push(content.slice(start, gt + 1));
      open.lastIndex = gt + 1;
      continue;
    }
    const end = close + `</${name}>`.length;
    blocks.push(content.slice(start, end));
    open.lastIndex = end;
  }
  return blocks;
}

function packageName(packageXml: string): string | undefined {
  const match = packageXml.match(/<name>\s*([^<]+?)\s*<\/name>/);
  return match?.[1];
}

function splitPathList(value: string | undefined): string[] {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of paths) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

async function existingDirs(paths: string[]): Promise<string[]> {
  const dirs: string[] = [];
  for (const item of uniquePaths(paths)) {
    try {
      const stat = await fs.stat(item);
      if (stat.isDirectory()) dirs.push(item);
    } catch {
      // ignore missing candidate roots
    }
  }
  return dirs;
}

function ancestorNamed(filePath: string, name: string): string | undefined {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (path.basename(current) === name) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function nearestPackageRoot(filePath: string): Promise<string | undefined> {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (await pathExists(path.join(current, "package.xml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function packageSearchRootsFromEnv(): string[] {
  const explicitRoots = [
    ...splitPathList(process.env.AUTOWARE_GRAPH_STUDIO_PACKAGE_INDEX_ROOTS),
    process.env.AUTOWARE_GRAPH_STUDIO_SRC_ROOT,
    process.env.VITE_AUTOWARE_GRAPH_STUDIO_SRC_ROOT,
    process.env.AUTOWARE_GRAPH_STUDIO_INSTALL_ROOT,
    process.env.VITE_AUTOWARE_GRAPH_STUDIO_INSTALL_ROOT
  ].filter((item): item is string => Boolean(item));
  const workspaceRoots = [process.env.AUTOWARE_GRAPH_STUDIO_WORKSPACE_ROOT, process.env.VITE_AUTOWARE_GRAPH_STUDIO_WORKSPACE_ROOT].filter(
    (item): item is string => Boolean(item)
  );
  const prefixShareRoots = [
    ...splitPathList(process.env.AMENT_PREFIX_PATH),
    ...splitPathList(process.env.COLCON_PREFIX_PATH),
    ...splitPathList(process.env.CMAKE_PREFIX_PATH)
  ].flatMap((prefix) => [path.join(prefix, "share")]);

  return [
    ...explicitRoots,
    ...workspaceRoots.flatMap((root) => [path.join(root, "src"), path.join(root, "install")]),
    ...prefixShareRoots
  ];
}

function peerWorkspaceRoots(root: string): string[] {
  const baseName = path.basename(root);
  if (baseName !== "src" && baseName !== "install") return [];
  const workspaceRoot = path.dirname(root);
  return [path.join(workspaceRoot, "src"), path.join(workspaceRoot, "install")];
}

async function inferPackageSearchRoots(entryLaunch: string): Promise<{ sourceRoot: string; searchRoots: string[] }> {
  const srcAncestor = ancestorNamed(entryLaunch, "src");
  const installAncestor = ancestorNamed(entryLaunch, "install");
  const packageRoot = await nearestPackageRoot(entryLaunch);
  const sourceRoot = srcAncestor ?? installAncestor ?? (packageRoot ? path.dirname(packageRoot) : path.dirname(entryLaunch));

  const localRoots = [
    sourceRoot,
    ...peerWorkspaceRoots(sourceRoot),
    packageRoot,
    packageRoot ? path.dirname(packageRoot) : undefined
  ].filter((item): item is string => Boolean(item));

  const searchRoots = await existingDirs([...localRoots, ...packageSearchRootsFromEnv()]);
  return { sourceRoot: path.resolve(sourceRoot), searchRoots };
}

async function buildPackageIndex(searchRoots: string[], files: FileMap): Promise<PackageIndex> {
  const packages: PackageIndex = {};
  const packageXmls: string[] = [];
  for (const root of searchRoots) {
    await walk(root, (file) => {
      if (path.basename(file) === "package.xml") packageXmls.push(file);
    });
  }
  for (const file of packageXmls) {
    try {
      const content = await fs.readFile(file, "utf8");
      files[file] = content;
      const name = packageName(content);
      if (name && !packages[name]) packages[name] = path.dirname(file);
    } catch {
      // ignore unreadable package.xml
    }
  }
  return packages;
}

async function readIfSupported(filePath: string, files: FileMap): Promise<string | undefined> {
  if (!isSupported(filePath)) return undefined;
  if (files[filePath] !== undefined) return files[filePath];
  try {
    const content = await fs.readFile(filePath, "utf8");
    files[filePath] = content;
    return content;
  } catch {
    return undefined;
  }
}

function resolvePath(value: string, currentDir: string): string {
  return path.isAbsolute(value) ? value : path.join(currentDir, value);
}

// Follow includes/params unconditionally (superset). Conditions are evaluated later in the TS parser.
async function readReachableLaunch(
  launchPath: string,
  args: ArgMap,
  packages: PackageIndex,
  files: FileMap,
  visited: Set<string>
): Promise<void> {
  if (visited.has(launchPath)) return;
  visited.add(launchPath);
  const content = await readIfSupported(launchPath, files);
  if (content === undefined) return;
  const currentDir = path.dirname(launchPath);
  const localArgs: ArgMap = { ...args };

  for (const tag of tagsNamed(content, "arg")) {
    const name = attrValue(tag, "name");
    const def = attrValue(tag, "default");
    if (name && def !== undefined && localArgs[name] === undefined) localArgs[name] = resolveValue(def, localArgs, packages);
  }
  for (const tag of tagsNamed(content, "let")) {
    const name = attrValue(tag, "name");
    const value = attrValue(tag, "value");
    if (name && value !== undefined) localArgs[name] = resolveValue(value, localArgs, packages);
  }
  for (const tag of tagsNamed(content, "param")) {
    const from = attrValue(tag, "from");
    if (from) await readIfSupported(resolvePath(resolveValue(from, localArgs, packages), currentDir), files);
  }
  for (const block of blocksNamed(content, "include")) {
    const file = attrValue(block, "file");
    if (!file) continue;
    const childArgs: ArgMap = { ...localArgs };
    for (const argTag of tagsNamed(block, "arg")) {
      const name = attrValue(argTag, "name");
      const value = attrValue(argTag, "value");
      if (name && value !== undefined) childArgs[name] = resolveValue(value, childArgs, packages);
    }
    const resolved = resolveValue(file, childArgs, packages);
    const childPath = resolvePath(resolved, currentDir);
    if (path.extname(childPath) === ".xml") await readReachableLaunch(childPath, childArgs, packages, files, visited);
    else await readIfSupported(childPath, files);
  }
}

export async function collectReachableFiles(entryLaunch: string, launchArgs: ArgMap): Promise<ReachableFilesResult> {
  const files: FileMap = {};
  const { sourceRoot, searchRoots } = await inferPackageSearchRoots(entryLaunch);
  const packages = await buildPackageIndex(searchRoots, files);
  await readReachableLaunch(entryLaunch, { ...launchArgs }, packages, files, new Set());
  return {
    files,
    sourceRoot,
    packageRoots: Object.values(packages).sort(),
    searchedRoots: searchRoots
  };
}

export async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function assertRelativePathInsideRoot(rootDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`Atomic write path must be relative: ${relativePath}`);
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Atomic write path escapes target directory: ${relativePath}`);
  }
  return target;
}

async function writeTextFileTree(rootDir: string, files: TextFileEntry[]): Promise<void> {
  for (const file of files) {
    const filePath = assertRelativePathInsideRoot(rootDir, file.relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, "utf8");
  }
}

async function renameIfExists(from: string, to: string): Promise<boolean> {
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function writeTextFilesAtomically(rootDir: string, files: TextFileEntry[]): Promise<void> {
  const parentDir = path.dirname(rootDir);
  const baseName = path.basename(rootDir);
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempDir = path.join(parentDir, `.${baseName}.tmp-${suffix}`);
  const backupDir = path.join(parentDir, `.${baseName}.backup-${suffix}`);
  let backupCreated = false;

  await fs.mkdir(parentDir, { recursive: true });
  try {
    await writeTextFileTree(tempDir, files);
    backupCreated = await renameIfExists(rootDir, backupDir);
    try {
      await fs.rename(tempDir, rootDir);
    } catch (error) {
      if (backupCreated) {
        await renameIfExists(backupDir, rootDir).catch(() => undefined);
      }
      throw error;
    }
    if (backupCreated) await fs.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    if (backupCreated) {
      await renameIfExists(backupDir, rootDir).catch(() => undefined);
    }
    throw error;
  }
}

export async function removePath(filePath: string): Promise<void> {
  await fs.rm(filePath, { recursive: true, force: true });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseRosParamList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith(":"))
    .filter((line) => !line.startsWith("/"))
    .map((line) => parseRosParamListLine(line).name);
}

function parseRosParamListLine(line: string): ListedRosParameter {
  const match = line.match(/^(.*?)\s+\(type:\s*([^)]+)\)\s*$/);
  if (!match) return { name: line.trim(), parameterType: "unknown" };
  return { name: match[1].trim(), parameterType: match[2].trim() };
}

export function parseRosParamListByNode(stdout: string): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  let currentNode: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.endsWith(":")) {
      currentNode = line.slice(0, -1);
      byNode.set(currentNode, byNode.get(currentNode) ?? []);
      continue;
    }
    if (!currentNode) continue;
    byNode.get(currentNode)?.push(parseRosParamListLine(line).name);
  }
  return byNode;
}

export function parseRosParamEntriesByNode(stdout: string): Map<string, ListedRosParameter[]> {
  const byNode = new Map<string, ListedRosParameter[]>();
  let currentNode: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.endsWith(":")) {
      currentNode = line.slice(0, -1);
      byNode.set(currentNode, byNode.get(currentNode) ?? []);
      continue;
    }
    if (!currentNode) continue;
    byNode.get(currentNode)?.push(parseRosParamListLine(line));
  }
  return byNode;
}

export function parseRosParamDescribe(stdout: string): Pick<DynamicRosParameter, "parameterType" | "readOnly" | "description"> {
  const type = stdout.match(/^\s*Type:\s*(.+?)\s*$/im)?.[1]?.trim() ?? "unknown";
  const readOnlyText = stdout.match(/^\s*Read only:\s*(.+?)\s*$/im)?.[1]?.trim().toLowerCase();
  const description = stdout.match(/^\s*Description:\s*(.*?)\s*$/im)?.[1]?.trim();
  return {
    parameterType: type,
    readOnly: readOnlyText === "true",
    description: description || undefined
  };
}

export function parseRosParamGet(stdout: string): string | number | boolean | null {
  const value = stdout.match(/value is:\s*([\s\S]*?)\s*$/i)?.[1]?.trim() ?? stdout.trim();
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^not set$/i.test(value)) return null;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?(?:\d+\.\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number.parseFloat(value);
  return value.replace(/^['"]|['"]$/g, "");
}

export async function rosParamSet(nodeName: string, paramName: string, value: string): Promise<void> {
  await execAsync(`ros2 param set ${shellQuote(nodeName)} ${shellQuote(paramName)} ${shellQuote(value)}`);
}

export async function listDynamicRosParameters(nodeNames: string[]): Promise<DynamicRosParameter[]> {
  const uniqueNodeNames = [...new Set(nodeNames.filter(Boolean))].slice(0, ROS_PARAM_MAX_NODES);
  const dynamicParams: DynamicRosParameter[] = [];
  const deadline = Date.now() + ROS_PARAM_SCAN_BUDGET_MS;
  const paramsByNode = new Map<string, ListedRosParameter[]>();

  try {
    const listed = await execAsync("ros2 param list --no-daemon --spin-time 1.0 --include-hidden-nodes --param-type", {
      timeout: ROS_PARAM_LIST_ALL_TIMEOUT_MS,
      maxBuffer: ROS_PARAM_LIST_MAX_BUFFER
    });
    for (const [nodeName, params] of parseRosParamEntriesByNode(listed.stdout)) {
      paramsByNode.set(nodeName, params);
    }
  } catch {
    // Fall back to per-node queries below.
  }

  for (const nodeName of uniqueNodeNames) {
    if (Date.now() > deadline) break;
    let params = paramsByNode.get(nodeName) ?? [];
    if (params.length === 0) {
      try {
        const listed = await execAsync(`ros2 param list --no-daemon --spin-time 1.0 --param-type ${shellQuote(nodeName)}`, {
          timeout: ROS_PARAM_LIST_TIMEOUT_MS,
          maxBuffer: ROS_PARAM_LIST_MAX_BUFFER
        });
        params = parseRosParamList(listed.stdout).map((name) => ({ name, parameterType: "unknown" }));
      } catch {
        continue;
      }
    }
    params = params.slice(0, ROS_PARAM_MAX_PER_NODE);
    for (const param of params) {
      if (Date.now() > deadline) break;
      dynamicParams.push({
        nodeName,
        paramName: param.name,
        value: null,
        parameterType: param.parameterType,
        readOnly: false
      });
    }
  }
  return dynamicParams;
}

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

function expandRestartTemplate(template: string, request: RestartNodeRequest): string {
  const targetName = request.targetName ?? request.nodeName;
  const values: Record<string, string> = {
    node: request.nodeName,
    target: targetName,
    restartName: targetName,
    kind: request.kind ?? "",
    container: request.containerName ?? "",
    plugin: request.plugin ?? "",
    generatedEntryLaunch: request.generatedEntryLaunch ?? "",
    latestEntryLaunch: request.latestEntryLaunch ?? "",
    runDir: request.runDir ?? "",
    latestDir: request.latestDir ?? ""
  };
  return Object.entries(values).reduce((command, [key, value]) => command.split(`{${key}}`).join(value), template);
}

export async function restartNode(request: RestartNodeRequest | string): Promise<void> {
  const template = process.env.AUTOWARE_GRAPH_STUDIO_RESTART_NODE_COMMAND;
  if (!template) throw new Error("AUTOWARE_GRAPH_STUDIO_RESTART_NODE_COMMAND is not set; cannot restart nodes safely");
  const restartRequest = typeof request === "string" ? { nodeName: request, targetName: request } : request;
  await execAsync(expandRestartTemplate(template, restartRequest));
}
