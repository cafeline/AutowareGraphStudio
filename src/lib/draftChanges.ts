import type { Composition } from "./composition";
import type { DynamicTuningEntry } from "./dynamicTuning";
import type { LaunchArgSpec } from "./launchArgs";
import type { ParamOverride, TopicOverride } from "./overlays";

export type DraftChange = {
  id: string;
  kind: "arg" | "node" | "param" | "topic" | "dynamic";
  label: string;
  detail: string;
};

export type DraftState = {
  launchArgSpecs: LaunchArgSpec[];
  launchArgValues: Record<string, string>;
  composition: Composition;
  pendingOverrides: ParamOverride[];
  pendingTopicOverrides: TopicOverride[];
  dynamicTuningSession: DynamicTuningEntry[];
};

function valueOf(spec: LaunchArgSpec, values: Record<string, string>): string {
  return values[spec.name] ?? spec.defaultValue;
}

export function buildDraftChanges(state: DraftState): DraftChange[] {
  const changes: DraftChange[] = [];

  for (const spec of state.launchArgSpecs) {
    const value = valueOf(spec, state.launchArgValues);
    const changed = spec.hasDefault ? value !== spec.defaultValue : value.trim() !== "";
    if (!changed) continue;
    changes.push({
      id: `arg:${spec.name}`,
      kind: "arg",
      label: `launch arg: ${spec.name}`,
      detail: spec.hasDefault ? `${spec.defaultValue || "(empty)"} -> ${value || "(empty)"}` : value
    });
  }

  for (const [name, value] of Object.entries(state.composition.argOverrides)) {
    changes.push({
      id: `switch:${name}`,
      kind: "arg",
      label: `switch: ${name}`,
      detail: value || "(default)"
    });
  }

  for (const nodeId of state.composition.disabledNodeIds) {
    changes.push({
      id: `disable:${nodeId}`,
      kind: "node",
      label: "disable node",
      detail: nodeId
    });
  }

  for (const node of state.composition.addedNodes) {
    changes.push({
      id: `add:${node.name}`,
      kind: "node",
      label: "add node",
      detail: `${node.name} (${node.packageName}/${node.executable})`
    });
  }

  for (const override of state.pendingOverrides) {
    changes.push({
      id: `param:${override.nodeName}:${override.key}`,
      kind: "param",
      label: `param: ${override.nodeName}.${override.key}`,
      detail: String(override.value)
    });
  }

  for (const override of state.pendingTopicOverrides) {
    changes.push({
      id: `topic:${override.nodeName}:${override.pinKind}:${override.fromTopic}`,
      kind: "topic",
      label: `topic: ${override.nodeName}`,
      detail: `${override.fromTopic} -> ${override.toTopic}`
    });
  }

  for (const entry of state.dynamicTuningSession) {
    changes.push({
      id: `dynamic:${entry.nodeName}:${entry.key}`,
      kind: "dynamic",
      label: `dynamic param: ${entry.nodeName}.${entry.key}`,
      detail: String(entry.value)
    });
  }

  return changes;
}

export function draftSignature(state: DraftState): string {
  return JSON.stringify(buildDraftChanges(state).map((change) => [change.id, change.detail]));
}
