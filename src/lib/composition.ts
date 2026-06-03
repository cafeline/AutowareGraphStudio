export type AddedNodeRemap = {
  from: string;
  to: string;
};

export type AddedNodeSpec = {
  name: string;
  packageName: string;
  executable: string;
  remaps?: AddedNodeRemap[];
};

export type Composition = {
  argOverrides: Record<string, string>;
  disabledNodeIds: string[];
  addedNodes: AddedNodeSpec[];
};

export function emptyComposition(): Composition {
  return { argOverrides: {}, disabledNodeIds: [], addedNodes: [] };
}

export function isCompositionDirty(composition: Composition): boolean {
  return (
    Object.keys(composition.argOverrides).length > 0 ||
    composition.disabledNodeIds.length > 0 ||
    composition.addedNodes.length > 0
  );
}

export function setArgOverride(composition: Composition, name: string, value: string): Composition {
  return { ...composition, argOverrides: { ...composition.argOverrides, [name]: value } };
}

export function clearArgOverride(composition: Composition, name: string): Composition {
  const argOverrides = { ...composition.argOverrides };
  delete argOverrides[name];
  return { ...composition, argOverrides };
}

export function setNodeDisabled(composition: Composition, nodeId: string, disabled: boolean): Composition {
  const without = composition.disabledNodeIds.filter((id) => id !== nodeId);
  return { ...composition, disabledNodeIds: disabled ? [...without, nodeId] : without };
}

export function addComposedNode(composition: Composition, spec: AddedNodeSpec): Composition {
  const without = composition.addedNodes.filter((node) => node.name !== spec.name);
  return { ...composition, addedNodes: [...without, spec] };
}

export function removeComposedNode(composition: Composition, name: string): Composition {
  return { ...composition, addedNodes: composition.addedNodes.filter((node) => node.name !== name) };
}

export function composedLaunchArgs(
  baseArgs: Record<string, string>,
  composition: Composition
): Record<string, string> {
  return { ...baseArgs, ...composition.argOverrides };
}
