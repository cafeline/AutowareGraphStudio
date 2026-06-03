import { resolveValue, type ArgMap } from "./launchConditions";
import { buildPackageIndex } from "./parser";
import type { AddedNodeSpec, Composition } from "./composition";
import type { ParamOverride, TopicOverride } from "./overlays";
import type { GraphModel } from "./graphModel";

export type Fork = { path: string; content: string };

export type ForkInput = {
  entryLaunch: string;
  forksDir: string;
  sourceRoot: string;
  files: Record<string, string>;
  graph: GraphModel;
  composition: Composition;
  paramOverrides: ParamOverride[];
  topicOverrides: TopicOverride[];
  launchArgs: ArgMap;
};

export type ForkOutput = {
  entryForkPath: string;
  forks: Fork[];
};

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function joinForkPath(forksDir: string, sourceRoot: string, originalPath: string): string {
  const prefix = sourceRoot.endsWith("/") ? sourceRoot : `${sourceRoot}/`;
  const rel = originalPath.startsWith(prefix) ? originalPath.slice(prefix.length) : originalPath.replace(/^\/+/, "");
  return `${forksDir.replace(/\/+$/, "")}/${rel}`;
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

function pushUnique<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

type XmlQuote = '"' | "'";

type XmlAttribute = {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  quote?: XmlQuote;
};

type XmlElement = {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  selfClosing: boolean;
  attributeInsertOffset: number;
  attributes: XmlAttribute[];
  children: XmlElement[];
};

type Replacement = {
  start: number;
  end: number;
  text: string;
};

const nodeElementNames = new Set(["node", "node_container", "composable_node"]);

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isNameBoundary(char: string): boolean {
  return char === "" || isWhitespace(char) || char === "=" || char === "/" || char === ">";
}

function findTagEnd(content: string, openStart: number): number {
  let quote: XmlQuote | null = null;
  for (let index = openStart + 1; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function parseAttributes(content: string, start: number, end: number): XmlAttribute[] {
  const attributes: XmlAttribute[] = [];
  let index = start;

  while (index < end) {
    while (index < end && isWhitespace(content[index])) index += 1;
    if (index >= end) break;

    const nameStart = index;
    while (index < end && !isNameBoundary(content[index])) index += 1;
    const name = content.slice(nameStart, index);
    if (!name) {
      index += 1;
      continue;
    }

    while (index < end && isWhitespace(content[index])) index += 1;
    if (content[index] !== "=") {
      attributes.push({ name, value: "", valueStart: index, valueEnd: index });
      continue;
    }

    index += 1;
    while (index < end && isWhitespace(content[index])) index += 1;
    const quote = content[index] === '"' || content[index] === "'" ? (content[index] as XmlQuote) : undefined;
    if (quote) {
      const valueStart = index + 1;
      const valueEnd = content.indexOf(quote, valueStart);
      const safeValueEnd = valueEnd === -1 || valueEnd > end ? end : valueEnd;
      attributes.push({
        name,
        value: content.slice(valueStart, safeValueEnd),
        valueStart,
        valueEnd: safeValueEnd,
        quote
      });
      index = safeValueEnd + 1;
      continue;
    }

    const valueStart = index;
    while (index < end && !isWhitespace(content[index]) && content[index] !== ">" && content[index] !== "/") index += 1;
    attributes.push({ name, value: content.slice(valueStart, index), valueStart, valueEnd: index });
  }

  return attributes;
}

function parseOpeningElement(content: string, openStart: number, tagEnd: number): XmlElement | null {
  let index = openStart + 1;
  while (index < tagEnd && isWhitespace(content[index])) index += 1;
  const nameStart = index;
  while (index < tagEnd && !isNameBoundary(content[index])) index += 1;
  const name = content.slice(nameStart, index);
  if (!name) return null;

  let lastContentIndex = tagEnd - 1;
  while (lastContentIndex > index && isWhitespace(content[lastContentIndex])) lastContentIndex -= 1;
  const selfClosing = content[lastContentIndex] === "/";
  const attributeInsertOffset = selfClosing ? lastContentIndex : tagEnd;
  const attributes = parseAttributes(content, index, attributeInsertOffset);

  return {
    name,
    openStart,
    openEnd: tagEnd + 1,
    closeStart: openStart,
    closeEnd: tagEnd + 1,
    selfClosing,
    attributeInsertOffset,
    attributes,
    children: []
  };
}

function parseXmlElements(content: string): XmlElement[] {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let index = 0;

  while (index < content.length) {
    const openStart = content.indexOf("<", index);
    if (openStart === -1) break;

    if (content.startsWith("<!--", openStart)) {
      const end = content.indexOf("-->", openStart + 4);
      index = end === -1 ? content.length : end + 3;
      continue;
    }
    if (content.startsWith("<![CDATA[", openStart)) {
      const end = content.indexOf("]]>", openStart + 9);
      index = end === -1 ? content.length : end + 3;
      continue;
    }
    if (content.startsWith("<?", openStart)) {
      const end = content.indexOf("?>", openStart + 2);
      index = end === -1 ? content.length : end + 2;
      continue;
    }
    if (content[openStart + 1] === "!") {
      const tagEnd = findTagEnd(content, openStart);
      index = tagEnd === -1 ? content.length : tagEnd + 1;
      continue;
    }

    const tagEnd = findTagEnd(content, openStart);
    if (tagEnd === -1) break;

    if (content[openStart + 1] === "/") {
      let nameStart = openStart + 2;
      while (nameStart < tagEnd && isWhitespace(content[nameStart])) nameStart += 1;
      let nameEnd = nameStart;
      while (nameEnd < tagEnd && !isNameBoundary(content[nameEnd])) nameEnd += 1;
      const name = content.slice(nameStart, nameEnd);
      for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
        const element = stack[stackIndex];
        if (element.name !== name) continue;
        element.closeStart = openStart;
        element.closeEnd = tagEnd + 1;
        stack.length = stackIndex;
        break;
      }
      index = tagEnd + 1;
      continue;
    }

    const element = parseOpeningElement(content, openStart, tagEnd);
    if (!element) {
      index = tagEnd + 1;
      continue;
    }

    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else roots.push(element);

    if (!element.selfClosing) stack.push(element);
    index = tagEnd + 1;
  }

  return roots;
}

function allElements(elements: XmlElement[]): XmlElement[] {
  return elements.flatMap((element) => [element, ...allElements(element.children)]);
}

function descendantElements(element: XmlElement): XmlElement[] {
  return allElements(element.children);
}

function getAttribute(element: XmlElement, name: string): XmlAttribute | undefined {
  return element.attributes.find((attribute) => attribute.name === name);
}

function setAttribute(element: XmlElement, name: string, value: string): Replacement {
  const existing = getAttribute(element, name);
  if (existing) {
    return { start: existing.valueStart, end: existing.valueEnd, text: escapeXmlAttribute(value) };
  }
  return {
    start: element.attributeInsertOffset,
    end: element.attributeInsertOffset,
    text: ` ${name}="${escapeXmlAttribute(value)}"`
  };
}

function applyReplacements(content: string, replacements: Replacement[]): string {
  const filtered: Replacement[] = [];
  let lastEnd = -1;
  for (const replacement of [...replacements].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (replacement.start < lastEnd) continue;
    filtered.push(replacement);
    lastEnd = replacement.end;
  }

  return filtered
    .sort((a, b) => b.start - a.start)
    .reduce(
      (nextContent, replacement) =>
        `${nextContent.slice(0, replacement.start)}${replacement.text}${nextContent.slice(replacement.end)}`,
      content
    );
}

function removalRange(content: string, element: XmlElement): { start: number; end: number } {
  const lineStart = content.lastIndexOf("\n", element.openStart - 1) + 1;
  const leading = content.slice(lineStart, element.openStart);
  const start = leading.trim().length === 0 ? lineStart : element.openStart;
  let end = element.closeEnd;
  if (content[end] === "\r" && content[end + 1] === "\n") end += 2;
  else if (content[end] === "\n") end += 1;
  return { start, end };
}

function nodeElementsNamed(content: string, nodeName: string): XmlElement[] {
  return allElements(parseXmlElements(content)).filter(
    (element) => nodeElementNames.has(element.name) && getAttribute(element, "name")?.value === nodeName
  );
}

function removeNamedBlock(content: string, nodeName: string): string {
  const replacements = nodeElementsNamed(content, nodeName).map((element) => ({
    ...removalRange(content, element),
    text: ""
  }));
  return applyReplacements(content, replacements);
}

function updateInlineParam(content: string, nodeName: string, key: string, value: string): string {
  const replacements = nodeElementsNamed(content, nodeName).flatMap((node) =>
    descendantElements(node)
      .filter((element) => element.name === "param" && getAttribute(element, "name")?.value === key)
      .map((element) => setAttribute(element, "value", value))
  );
  return applyReplacements(content, replacements);
}

function updateInlineRemap(
  content: string,
  nodeName: string,
  fromTopic: string,
  toTopic: string,
  fromRemap?: string
): string {
  // Prefer the raw `from` anchor (e.g. "~/output/trajectory") when we have it:
  // the XML `to` is usually "$(var ...)", so matching the resolved fromTopic
  // against the literal `to` attribute would miss. Fall back to the legacy
  // `to`===fromTopic match for pins that carry no raw from (e.g. runtime-only).
  const matches = (element: XmlElement): boolean => {
    if (element.name !== "remap") return false;
    if (fromRemap !== undefined && fromRemap !== "") {
      return getAttribute(element, "from")?.value === fromRemap;
    }
    return getAttribute(element, "to")?.value === fromTopic;
  };
  const replacements = nodeElementsNamed(content, nodeName).flatMap((node) =>
    descendantElements(node)
      .filter(matches)
      .map((element) => setAttribute(element, "to", toTopic))
  );
  return applyReplacements(content, replacements);
}

function setArgDefault(content: string, name: string, value: string): string {
  const replacements = allElements(parseXmlElements(content))
    .filter((element) => element.name === "arg" && getAttribute(element, "name")?.value === name)
    .filter((element) => getAttribute(element, "value") === undefined)
    .map((element) => setAttribute(element, "default", value));
  return applyReplacements(content, replacements);
}

// A file "declares" an arg when it has a top-level <arg name="X"> without a
// value attribute (i.e. a declaration with an optional default), as opposed to
// the <arg name="X" value="..."> form used to pass values into an <include>.
function fileDeclaresArg(content: string, argNames: Set<string>): boolean {
  return allElements(parseXmlElements(content)).some(
    (element) =>
      element.name === "arg" &&
      getAttribute(element, "value") === undefined &&
      argNames.has(getAttribute(element, "name")?.value ?? "")
  );
}

function buildAddedNodeXml(spec: AddedNodeSpec): string {
  const open = `  <node pkg="${escapeXmlAttribute(spec.packageName)}" exec="${escapeXmlAttribute(spec.executable)}" name="${escapeXmlAttribute(spec.name)}">`;
  const remaps = (spec.remaps ?? []).map(
    (remap) => `    <remap from="${escapeXmlAttribute(remap.from)}" to="${escapeXmlAttribute(remap.to)}"/>`
  );
  return [open, ...remaps, "  </node>"].join("\n");
}

function appendAddedNodes(content: string, nodes: AddedNodeSpec[]): string {
  if (nodes.length === 0) return content;
  const snippet = nodes.map(buildAddedNodeXml).join("\n");
  const launch = parseXmlElements(content).find((element) => element.name === "launch" && !element.selfClosing);
  if (!launch || launch.closeStart <= launch.openStart) return content;
  return applyReplacements(content, [{ start: launch.closeStart, end: launch.closeStart, text: `${snippet}\n` }]);
}

// A pure pass-through like <arg name="x" value="$(var x)"/> just forwards the
// parent's value; it carries no information and must not shadow a concrete
// definition of the same arg collected elsewhere.
function isSelfReferentialArg(name: string, value: string): boolean {
  return value.trim() === `$(var ${name})`;
}

// Collect every <arg name=X default|value=Y> across the file, including the
// value passes inside <include> blocks (that is where Autoware actually defines
// path args like common_param_path). Used to resolve $(var ...) chains so that
// <param from> / <include file> refs deep in the tree can be rewritten to forks.
// Concrete values win over self-referential pass-throughs; otherwise first wins.
function collectArgDeclarations(elements: XmlElement[], out: Map<string, string>): void {
  for (const element of elements) {
    if (element.name === "arg") {
      const name = getAttribute(element, "name")?.value;
      const value = getAttribute(element, "value")?.value ?? getAttribute(element, "default")?.value;
      if (name && value !== undefined) {
        const existing = out.get(name);
        if (existing === undefined || (isSelfReferentialArg(name, existing) && !isSelfReferentialArg(name, value))) {
          out.set(name, value);
        }
      }
    }
    collectArgDeclarations(element.children, out);
  }
}

function buildGlobalArgMap(
  files: Record<string, string>,
  launchArgs: ArgMap,
  argOverrides: Record<string, string>
): ArgMap {
  const collected = new Map<string, string>();
  for (const [file, content] of Object.entries(files)) {
    if (isYamlPath(file)) continue;
    collectArgDeclarations(parseXmlElements(content), collected);
  }
  return { ...Object.fromEntries(collected), ...launchArgs, ...argOverrides };
}

function rewriteIncludes(
  content: string,
  currentFile: string,
  args: ArgMap,
  packages: Record<string, string>,
  forkedFiles: Set<string>,
  forkPathOf: (orig: string) => string
): string {
  const replacements = allElements(parseXmlElements(content)).flatMap((element) => {
    if (element.name !== "include") return [];
    const file = getAttribute(element, "file");
    if (!file) return [];
    const resolved = resolveFilePath(resolveValue(file.value, args, packages), dirname(currentFile));
    return forkedFiles.has(resolved) ? [setAttribute(element, "file", forkPathOf(resolved))] : [];
  });
  return applyReplacements(content, replacements);
}

function rewriteParamFileRefs(
  content: string,
  currentFile: string,
  args: ArgMap,
  packages: Record<string, string>,
  forkedFiles: Set<string>,
  forkPathOf: (orig: string) => string,
  paramFileRefs: Record<string, string>
): string {
  const replacements = allElements(parseXmlElements(content)).flatMap((element) => {
    if (element.name !== "param") return [];
    const from = getAttribute(element, "from");
    if (!from) return [];
    // Prefer the parser's scope-correct resolution for this exact `from`
    // expression; the same arg name (e.g. common_param_path) can resolve to
    // different files in different include scopes, which a flat arg map cannot
    // capture. Fall back to best-effort resolution for refs the parser didn't
    // record (e.g. params under nodes that were pruned by an inactive branch).
    const resolved = resolveFilePath(paramFileRefs[from.value] ?? resolveValue(from.value, args, packages), dirname(currentFile));
    return forkedFiles.has(resolved) ? [setAttribute(element, "from", forkPathOf(resolved))] : [];
  });
  return applyReplacements(content, replacements);
}

function isYamlPath(path: string): boolean {
  return /\.ya?ml$/i.test(path);
}

function normalizedNodeName(name: string): string {
  return name.replace(/^\/+/, "");
}

function nodeNameBasename(name: string): string {
  return normalizedNodeName(name).split("/").filter(Boolean).at(-1) ?? name;
}

function overrideNodeAliases(override: ParamOverride): string[] {
  return [
    ...new Set(
      [override.nodeName, ...(override.nodeAliases ?? [])]
        .flatMap((name) => [name, normalizedNodeName(name), nodeNameBasename(name)])
        .filter(Boolean)
    )
  ];
}

// --- Targeted YAML scalar editing -------------------------------------------
// ROS 2 param files are type-sensitive: a double parameter must stay `1.0`, not
// `1`. Rewriting the whole file via yaml.load/dump silently turns whole-number
// floats into ints (and drops comments), which makes composable nodes fail to
// load with a type-mismatch. So we edit only the exact scalar being overridden
// and leave every other byte — types, comments, layout — untouched.

function leadingIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("#");
}

// Key text of a `key:` / `key: value` mapping line, or null. Keys may contain
// `/`, `*`, `.` (e.g. "/**", "ros__parameters", "a.b.c").
function mappingKey(line: string): string | null {
  const match = line.match(/^\s*([^\s#][^:]*?)\s*:(?:\s|$)/);
  return match ? match[1] : null;
}

// Span of the scalar value on a mapping line, excluding any trailing " #comment"
// and surrounding whitespace. Returns null when there is no scalar value.
function valueSpan(line: string): { start: number; end: number } | null {
  const match = line.match(/^(\s*[^\s#][^:]*?\s*:\s*)(.*)$/);
  if (!match) return null;
  const start = match[1].length;
  let end = line.length;
  if (!/^['"]/.test(match[2])) {
    const comment = line.indexOf(" #", start);
    if (comment !== -1) end = comment;
  }
  while (end > start && (line[end - 1] === " " || line[end - 1] === "\t" || line[end - 1] === "\r")) end -= 1;
  return end > start ? { start, end } : null;
}

// Range [start, end) of lines that are nested under the header at headerIdx.
function childBlockRange(lines: string[], headerIdx: number): [number, number] {
  const headerIndent = leadingIndent(lines[headerIdx]);
  let end = headerIdx + 1;
  while (end < lines.length) {
    if (isStructuralLine(lines[end]) && leadingIndent(lines[end]) <= headerIndent) break;
    end += 1;
  }
  return [headerIdx + 1, end];
}

// Index of the direct-child mapping line with the given key within [start, end).
function findChildKeyLine(lines: string[], start: number, end: number, key: string): number {
  let childIndent = -1;
  for (let i = start; i < end; i += 1) {
    if (!isStructuralLine(lines[i])) continue;
    const indent = leadingIndent(lines[i]);
    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) continue;
    if (mappingKey(lines[i]) === key) return i;
  }
  return -1;
}

function findLeafLine(lines: string[], nodeKeyCandidates: string[], keyParts: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (!isStructuralLine(lines[i]) || leadingIndent(lines[i]) !== 0) continue;
    const key = mappingKey(lines[i]);
    if (key === null || !nodeKeyCandidates.includes(key)) continue;
    const [nodeStart, nodeEnd] = childBlockRange(lines, i);
    const paramsHeader = findChildKeyLine(lines, nodeStart, nodeEnd, "ros__parameters");
    if (paramsHeader === -1) continue;
    let [start, end] = childBlockRange(lines, paramsHeader);

    let leaf = -1;
    for (let p = 0; p < keyParts.length; p += 1) {
      const idx = findChildKeyLine(lines, start, end, keyParts[p]);
      if (idx === -1) {
        leaf = -1;
        break;
      }
      if (p === keyParts.length - 1) {
        leaf = idx;
        break;
      }
      [start, end] = childBlockRange(lines, idx);
    }
    if (leaf !== -1) return leaf;

    // Some yamls keep the whole path as one literal key ("a.b.c: value").
    const [ps, pe] = childBlockRange(lines, paramsHeader);
    const literal = findChildKeyLine(lines, ps, pe, keyParts.join("."));
    if (literal !== -1) return literal;
  }
  return -1;
}

// Render a value, preserving the float-ness implied by the original token so a
// double parameter does not collapse to an int (e.g. 100 -> "100.0").
function formatScalarValue(originalToken: string, value: ParamOverride["value"]): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value === "number") {
    const originalIsFloat = /[.eE]/.test(originalToken) && !/^['"]/.test(originalToken);
    return originalIsFloat && Number.isInteger(value) ? `${value}.0` : String(value);
  }
  const quote = originalToken.startsWith("'") ? "'" : originalToken.startsWith('"') ? '"' : "";
  return quote ? `${quote}${value}${quote}` : value;
}

function nodeKeyCandidatesFor(override: ParamOverride): string[] {
  const aliases = overrideNodeAliases(override);
  return [...new Set([...aliases, ...aliases.map((name) => `/${normalizedNodeName(name)}`), "/**", "**"])];
}

// Append a new param under an existing node block (or a fresh /** block),
// without reformatting the rest of the file. Used only when the key is absent.
function appendYamlOverride(lines: string[], nodeKeyCandidates: string[], keyParts: string[], value: ParamOverride["value"]): string[] {
  const dotted = keyParts.join(".");
  const text = formatScalarValue("", value);
  for (let i = 0; i < lines.length; i += 1) {
    if (!isStructuralLine(lines[i]) || leadingIndent(lines[i]) !== 0) continue;
    if (!nodeKeyCandidates.includes(mappingKey(lines[i]) ?? "")) continue;
    const [nodeStart, nodeEnd] = childBlockRange(lines, i);
    const paramsHeader = findChildKeyLine(lines, nodeStart, nodeEnd, "ros__parameters");
    if (paramsHeader === -1) continue;
    const [start, end] = childBlockRange(lines, paramsHeader);
    let childIndent = leadingIndent(lines[paramsHeader]) + 2;
    for (let j = start; j < end; j += 1) {
      if (isStructuralLine(lines[j])) {
        childIndent = leadingIndent(lines[j]);
        break;
      }
    }
    return [...lines.slice(0, end), `${" ".repeat(childIndent)}${dotted}: ${text}`, ...lines.slice(end)];
  }
  return [...lines, "/**:", "  ros__parameters:", `    ${dotted}: ${text}`];
}

// --- Autoware module-preset (`launch:` yaml) arg editing --------------------
// A preset looks like:
//   launch:
//     - arg:
//         name: behavior_path_planner_type
//         default: behavior_path_planner
// It is included ahead of the launch tree, so its declared default is the
// authoritative value for the arg. Swaps must rewrite the default here.

function isPresetLaunchYaml(content: string): boolean {
  return content.split("\n").some((line) => /^launch:\s*$/.test(line));
}

function presetDeclaresAnyArg(content: string, argNames: Set<string>): boolean {
  return content.split("\n").some((line) => {
    const match = line.match(/^\s*name:\s*(.+?)\s*$/);
    return match ? argNames.has(match[1].replace(/^['"]|['"]$/g, "")) : false;
  });
}

// Find the `default:` line that is a sibling of the matched `name:` (same arg
// block / indent) without crossing into the next list item.
function findPresetDefaultLine(lines: string[], nameIdx: number, indent: number): number {
  const scan = (indices: number[]): number => {
    for (const j of indices) {
      if (!isStructuralLine(lines[j])) continue;
      const lineIndent = leadingIndent(lines[j]);
      if (lineIndent < indent) break;
      if (lineIndent > indent) continue;
      if (/^\s*default\s*:/.test(lines[j])) return j;
      if (/^\s*-\s/.test(lines[j])) break; // next list item, different arg
    }
    return -1;
  };
  const down: number[] = [];
  for (let j = nameIdx + 1; j < lines.length; j += 1) down.push(j);
  const downHit = scan(down);
  if (downHit !== -1) return downHit;
  const up: number[] = [];
  for (let j = nameIdx - 1; j >= 0; j -= 1) up.push(j);
  return scan(up);
}

function setPresetArgDefault(content: string, argName: string, value: ParamOverride["value"]): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(\s*)name:\s*(.+?)\s*$/);
    if (!match) continue;
    if (match[2].replace(/^['"]|['"]$/g, "") !== argName) continue;
    const indent = match[1].length;
    const defaultIdx = findPresetDefaultLine(lines, i, indent);
    if (defaultIdx !== -1) {
      const span = valueSpan(lines[defaultIdx]);
      if (span) {
        const token = lines[defaultIdx].slice(span.start, span.end);
        lines[defaultIdx] =
          lines[defaultIdx].slice(0, span.start) + formatScalarValue(token, value) + lines[defaultIdx].slice(span.end);
        return lines.join("\n");
      }
    }
    // The arg declares no default: add one right after the name line.
    lines.splice(i + 1, 0, `${" ".repeat(indent)}default: ${formatScalarValue("", value)}`);
    return lines.join("\n");
  }
  return content;
}

function applyYamlParamOverrides(content: string, overrides: ParamOverride[]): string {
  let lines = content.split("\n");
  for (const override of overrides) {
    const candidates = nodeKeyCandidatesFor(override);
    const keyParts = override.key.split(".").filter(Boolean);
    if (keyParts.length === 0) continue;

    const leaf = findLeafLine(lines, candidates, keyParts);
    const span = leaf === -1 ? null : valueSpan(lines[leaf]);
    if (span) {
      const token = lines[leaf].slice(span.start, span.end);
      lines[leaf] =
        lines[leaf].slice(0, span.start) + formatScalarValue(token, override.value) + lines[leaf].slice(span.end);
    } else {
      lines = appendYamlOverride(lines, candidates, keyParts, override.value);
    }
  }
  return lines.join("\n");
}

function updateInlineParamOverride(content: string, override: ParamOverride): string {
  return overrideNodeAliases(override).reduce(
    (nextContent, nodeName) => updateInlineParam(nextContent, nodeName, override.key, String(override.value)),
    content
  );
}

export function buildForkSet(input: ForkInput): ForkOutput {
  const { entryLaunch, forksDir, sourceRoot, files, graph, composition, paramOverrides, topicOverrides, launchArgs } = input;
  const packages = buildPackageIndex(files);

  const nodeFile = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.isLaunchInclude) continue;
    nodeFile.set(node.name, node.launchFile);
    nodeFile.set(node.id, node.launchFile);
  }

  const touchedFiles = new Set<string>([entryLaunch]);
  const disabledByFile = new Map<string, string[]>();
  const paramByFile = new Map<string, ParamOverride[]>();
  const yamlParamByFile = new Map<string, ParamOverride[]>();
  const topicByFile = new Map<string, TopicOverride[]>();

  for (const nodeId of composition.disabledNodeIds) {
    const file = nodeFile.get(nodeId);
    if (!file) continue;
    touchedFiles.add(file);
    pushUnique(disabledByFile, file, nodeId);
  }
  for (const override of paramOverrides) {
    const sourceFile = override.sourceFile && files[override.sourceFile] !== undefined ? override.sourceFile : undefined;
    if (sourceFile && isYamlPath(sourceFile)) {
      touchedFiles.add(sourceFile);
      pushUnique(yamlParamByFile, sourceFile, override);
      const launchFile = nodeFile.get(override.nodeName);
      if (launchFile) touchedFiles.add(launchFile);
      continue;
    }
    const file = sourceFile ?? nodeFile.get(override.nodeName);
    if (!file) continue;
    touchedFiles.add(file);
    pushUnique(paramByFile, file, override);
  }
  for (const override of topicOverrides) {
    const file = nodeFile.get(override.nodeName);
    if (!file) continue;
    touchedFiles.add(file);
    pushUnique(topicByFile, file, override);
  }

  // Swap / Switchable Options change an <arg> that is usually declared deep in
  // the include chain. Fork every file that declares one of those args (and,
  // via the BFS below, its ancestors) so the changed default actually reaches
  // the conditional groups that read it — even when no other edit touched them.
  // An Autoware module preset (a `launch:` yaml) declares some of these args and
  // is included before the launch tree that reads them, so its DeclareLaunchArgument
  // wins over both the deep <arg default> and a command-line value. Fork the preset
  // too and rewrite its default — that is the only place the swap actually takes.
  const overriddenArgNames = new Set(Object.keys(composition.argOverrides));
  if (overriddenArgNames.size > 0) {
    for (const [file, content] of Object.entries(files)) {
      if (touchedFiles.has(file)) continue;
      if (isYamlPath(file)) {
        if (isPresetLaunchYaml(content) && presetDeclaresAnyArg(content, overriddenArgNames)) touchedFiles.add(file);
      } else if (fileDeclaresArg(content, overriddenArgNames)) {
        touchedFiles.add(file);
      }
    }
  }

  const parentsOf = new Map<string, string[]>();
  for (const edge of graph.launchGraph.edges) {
    pushUnique(parentsOf, edge.target, edge.source);
  }
  for (const launch of graph.launchGraph.launches) {
    for (const paramFile of launch.paramFiles) {
      pushUnique(parentsOf, paramFile, launch.path);
    }
  }
  const queue = [...touchedFiles];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parent of parentsOf.get(current) ?? []) {
      if (touchedFiles.has(parent)) continue;
      touchedFiles.add(parent);
      queue.push(parent);
    }
  }

  const forkPathOf = (orig: string) => joinForkPath(forksDir, sourceRoot, orig);

  // $(var ...) used in <include file> and <param from> can chain through args
  // declared deep in the tree, so resolve them against a global arg map rather
  // than entry-level launchArgs only. Rewrites are still guarded by forkedFiles,
  // so an imperfect resolution can never point a ref at a non-forked file.
  const resolveArgs = buildGlobalArgMap(files, launchArgs, composition.argOverrides);
  const paramFileRefsByFile = new Map<string, Record<string, string>>();
  for (const launch of graph.launchGraph.launches) {
    if (launch.paramFileRefs) paramFileRefsByFile.set(launch.path, launch.paramFileRefs);
  }

  const forks: Fork[] = [];
  for (const file of touchedFiles) {
    let content = files[file];
    if (content === undefined) continue;

    if (isYamlPath(file)) {
      if (isPresetLaunchYaml(content)) {
        for (const [name, value] of Object.entries(composition.argOverrides)) {
          content = setPresetArgDefault(content, name, value);
        }
      } else {
        content = applyYamlParamOverrides(content, yamlParamByFile.get(file) ?? []);
      }
    } else {
      for (const nodeId of disabledByFile.get(file) ?? []) {
        content = removeNamedBlock(content, nodeNameBasename(nodeId));
      }
      for (const override of paramByFile.get(file) ?? []) {
        content = updateInlineParamOverride(content, override);
      }
      for (const override of topicByFile.get(file) ?? []) {
        content = updateInlineRemap(content, override.nodeName, override.fromTopic, override.toTopic, override.fromRemap);
      }

      if (file === entryLaunch) {
        for (const [name, value] of Object.entries(launchArgs)) {
          content = setArgDefault(content, name, value);
        }
        content = appendAddedNodes(content, composition.addedNodes);
      }

      // argOverrides (Swap / Switchable Options) apply to every forked file and
      // win over launchArgs, since the arg they target may be declared deep in
      // the include chain rather than in the entry launch.
      for (const [name, value] of Object.entries(composition.argOverrides)) {
        content = setArgDefault(content, name, value);
      }

      content = rewriteIncludes(content, file, resolveArgs, packages, touchedFiles, forkPathOf);
      content = rewriteParamFileRefs(
        content,
        file,
        resolveArgs,
        packages,
        touchedFiles,
        forkPathOf,
        paramFileRefsByFile.get(file) ?? {}
      );
    }

    forks.push({ path: forkPathOf(file), content });
  }

  return { entryForkPath: forkPathOf(entryLaunch), forks };
}
