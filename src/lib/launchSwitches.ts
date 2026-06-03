export type FileMap = Record<string, string>;

export type SwitchArg = {
  name: string;
  defaultValue: string | undefined;
  candidates: string[];
  description?: string;
  source: "condition" | "description";
};

type ArgInfo = { default?: string; description?: string };

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return undefined;
  return match[2] ?? match[3] ?? "";
}

function collectArgs(content: string): Map<string, ArgInfo> {
  const args = new Map<string, ArgInfo>();
  for (const match of content.matchAll(/<arg\b[^>]*>/g)) {
    const tag = match[0];
    const name = attr(tag, "name");
    if (!name) continue;
    const info = args.get(name) ?? {};
    const defaultValue = attr(tag, "default");
    if (defaultValue !== undefined) info.default = defaultValue;
    const description = attr(tag, "description");
    if (description !== undefined) info.description = description;
    args.set(name, info);
  }
  return args;
}

function collectConditionValues(content: string): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();
  const add = (name: string, value: string) => {
    const set = values.get(name) ?? new Set<string>();
    set.add(value);
    values.set(name, set);
  };
  for (const match of content.matchAll(/'\$\(var\s+([A-Za-z0-9_]+)\)'\s*(?:==|!=)\s*'([^']*)'/g)) {
    add(match[1], match[2]);
  }
  for (const match of content.matchAll(/'([^']*)'\s*(?:==|!=)\s*'\$\(var\s+([A-Za-z0-9_]+)\)'/g)) {
    add(match[2], match[1]);
  }
  for (const match of content.matchAll(/'([^']*)'\s+(?:not\s+in|in)\s+'\$\(var\s+([A-Za-z0-9_]+)\)'/g)) {
    add(match[2], match[1]);
  }
  return values;
}

const stopWords = new Set(["options", "option", "are", "or", "and", "the", "is", "e", "g"]);

function descriptionOptions(description: string | undefined): string[] {
  if (!description) return [];
  const quoted = [...description.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (quoted.length >= 2) return quoted;
  const lower = description.toLowerCase();
  const marker = lower.search(/options?:/);
  if (marker === -1) return [];
  const rest = description.slice(marker).replace(/options?:/i, "");
  return rest
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => /^[a-z0-9_]+$/i.test(token) && token.length > 1 && !stopWords.has(token.toLowerCase()));
}

export function discoverSwitchArgs(files: FileMap): SwitchArg[] {
  const args = new Map<string, ArgInfo>();
  const conditionValues = new Map<string, Set<string>>();

  for (const content of Object.values(files)) {
    for (const [name, info] of collectArgs(content)) {
      const existing = args.get(name) ?? {};
      args.set(name, { default: info.default ?? existing.default, description: info.description ?? existing.description });
    }
    for (const [name, set] of collectConditionValues(content)) {
      const existing = conditionValues.get(name) ?? new Set<string>();
      for (const value of set) existing.add(value);
      conditionValues.set(name, existing);
    }
  }

  const switches: SwitchArg[] = [];
  const names = new Set([...args.keys(), ...conditionValues.keys()]);
  for (const name of names) {
    const info = args.get(name) ?? {};
    const fromConditions = [...(conditionValues.get(name) ?? new Set<string>())];
    const fromDescription = descriptionOptions(info.description);
    const candidates: string[] = [];
    const push = (value: string) => {
      if (!candidates.includes(value)) candidates.push(value);
    };
    if (info.default !== undefined) push(info.default);
    for (const value of fromConditions) push(value);
    for (const value of fromDescription) push(value);
    if (candidates.length < 2) continue;
    switches.push({
      name,
      defaultValue: info.default,
      candidates,
      description: info.description,
      source: fromConditions.length > 0 ? "condition" : "description"
    });
  }
  return switches.sort((a, b) => a.name.localeCompare(b.name));
}
