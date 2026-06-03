import type { Parameter } from "./graphModel";

export type ParamOverride = {
  nodeName: string;
  key: string;
  value: string | number | boolean | null;
  sourceFile?: string;
  nodeAliases?: string[];
};

export type TopicOverride = {
  nodeName: string;
  pinKind: "input" | "output";
  fromTopic: string;
  toTopic: string;
  // Raw `from` attribute of the originating <remap> (e.g. "~/output/trajectory").
  // When present, the save step rewrites the remap by matching this anchor rather
  // than the resolved `fromTopic`, so $(var ...)-based remaps are handled too.
  fromRemap?: string;
};

export function upsertParamOverride(
  overrides: ParamOverride[],
  next: ParamOverride
): ParamOverride[] {
  const existing = overrides.find(
    (item) => item.nodeName === next.nodeName && item.key === next.key && (item.sourceFile ?? "") === (next.sourceFile ?? "")
  );
  if (!existing) return [...overrides, next];
  return overrides.map((item) =>
    item.nodeName === next.nodeName && item.key === next.key && (item.sourceFile ?? "") === (next.sourceFile ?? "") ? next : item
  );
}

function coerceOverrideValue(parameter: Parameter, value: string): ParamOverride["value"] {
  const trimmed = value.trim();
  if (typeof parameter.value === "boolean") {
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
  }
  if (typeof parameter.value === "number" && trimmed !== "") {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (parameter.value === null && trimmed.toLowerCase() === "null") return null;
  return value;
}

export function parameterToOverride(parameter: Parameter, value: string): ParamOverride {
  const nodeAliases = [...new Set([parameter.nodeName, parameter.nodeId, parameter.sourceNodeName].filter(Boolean))] as string[];
  return {
    nodeName: parameter.nodeName,
    key: parameter.key,
    value: coerceOverrideValue(parameter, value),
    sourceFile: parameter.sourceFile !== "runtime" ? parameter.sourceFile : undefined,
    nodeAliases
  };
}

export function upsertTopicOverride(
  overrides: TopicOverride[],
  next: TopicOverride
): TopicOverride[] {
  const existing = overrides.find(
    (item) =>
      item.nodeName === next.nodeName &&
      item.pinKind === next.pinKind &&
      item.fromTopic === next.fromTopic
  );
  if (!existing) return [...overrides, next];
  return overrides.map((item) =>
    item.nodeName === next.nodeName && item.pinKind === next.pinKind && item.fromTopic === next.fromTopic
      ? next
      : item
  );
}
