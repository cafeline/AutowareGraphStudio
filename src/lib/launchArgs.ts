import { XMLParser } from "fast-xml-parser";

export type LaunchArgSpec = {
  name: string;
  defaultValue: string;
  hasDefault: boolean;
  choices: string[];
  inputKind: "select" | "text";
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) => ["arg"].includes(name)
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// Choices come solely from the launch file itself — nothing is hardcoded here.
// Anything machine- or vehicle-specific is chosen by the user in the GUI.
function choicesFor(defaultValue: string) {
  const choices = new Set<string>();
  if (defaultValue) choices.add(defaultValue);
  if (defaultValue === "true" || defaultValue === "false") {
    choices.add("true");
    choices.add("false");
  }
  return [...choices];
}

export function parseLaunchArgSpecs(content: string): LaunchArgSpec[] {
  const parsed = parser.parse(content);
  const args = asArray<Record<string, string>>(parsed.launch?.arg);
  const seen = new Set<string>();
  return args.flatMap((arg) => {
    if (!arg.name || seen.has(arg.name)) return [];
    seen.add(arg.name);
    const hasDefault = arg.default !== undefined || arg.value !== undefined;
    const defaultValue = String(arg.default ?? arg.value ?? "");
    const choices = choicesFor(defaultValue);
    return [
      {
        name: arg.name,
        defaultValue,
        hasDefault,
        choices,
        inputKind: choices.length > 1 && choices.every((choice) => choice.length <= 120) ? "select" : "text"
      }
    ];
  });
}

export function buildLaunchArgs(specs: LaunchArgSpec[], currentValues: Record<string, string>) {
  if (specs.length === 0) return { ...currentValues };
  const args: Record<string, string> = {};
  for (const spec of specs) args[spec.name] = currentValues[spec.name] ?? spec.defaultValue;
  return args;
}

export function buildLaunchOverrideArgs(specs: LaunchArgSpec[], currentValues: Record<string, string>) {
  if (specs.length === 0) return { ...currentValues };
  const args: Record<string, string> = {};
  for (const spec of specs) {
    const value = currentValues[spec.name] ?? spec.defaultValue;
    if (!spec.hasDefault || value !== spec.defaultValue) args[spec.name] = value;
  }
  return args;
}
