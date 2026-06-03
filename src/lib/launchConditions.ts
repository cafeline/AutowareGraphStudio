export type ArgMap = Record<string, string>;
export type PackageIndex = Record<string, string>;

export type ConditionResult = { value: boolean; evaluated: boolean };

// Resolve $(var ...), $(env ...) and $(find-pkg-share ...) substitutions.
// The $(eval ...) wrapper is intentionally left intact (its inner $(var ...) is resolved).
export function resolveValue(value: string, args: ArgMap, packages: PackageIndex): string {
  let result = value;
  for (let i = 0; i < 8; i += 1) {
    const before = result;
    result = result.replace(/\$\(var ([^)]+)\)/g, (_, key: string) => args[key] ?? "");
    result = result.replace(/\$\(env ([^) ]+)(?: ([^)]+))?\)/g, (_, _key: string, fallback?: string) => fallback ?? "");
    result = result.replace(/\$\(find-pkg-share ([^)]+)\)/g, (_, key: string) => {
      const resolvedKey = resolveValue(key, args, packages);
      return packages[resolvedKey] ?? "";
    });
    if (before === result) break;
  }
  return result;
}

export function conditionArgNames(raw: string): string[] {
  const names = new Set<string>();
  for (const match of raw.matchAll(/\$\(var\s+([A-Za-z0-9_]+)\)/g)) {
    names.add(match[1]);
  }
  return [...names];
}

type Token =
  | { type: "str"; value: string }
  | { type: "num"; value: number }
  | { type: "bool"; value: boolean }
  | { type: "op"; value: string }
  | { type: "kw"; value: "and" | "or" | "not" | "in" }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (char === " " || char === "\t" || char === "\n") {
      i += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const end = input.indexOf(char, i + 1);
      if (end === -1) throw new Error("unterminated string");
      tokens.push({ type: "str", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const opMatch = input.slice(i).match(/^(==|!=|<=|>=|<|>)/);
    if (opMatch) {
      tokens.push({ type: "op", value: opMatch[1] });
      i += opMatch[1].length;
      continue;
    }
    const wordMatch = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (word === "True" || word === "true") tokens.push({ type: "bool", value: true });
      else if (word === "False" || word === "false") tokens.push({ type: "bool", value: false });
      else if (word === "and" || word === "or" || word === "not" || word === "in") tokens.push({ type: "kw", value: word });
      else throw new Error(`unsupported identifier: ${word}`);
      i += word.length;
      continue;
    }
    const numMatch = input.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (numMatch) {
      tokens.push({ type: "num", value: Number(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }
    throw new Error(`unsupported token at: ${input.slice(i)}`);
  }
  return tokens;
}

type Value = string | number | boolean;

function toBool(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "" && value !== "false" && value !== "0";
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parse(): Value {
    const value = this.parseOr();
    if (this.pos !== this.tokens.length) throw new Error("trailing tokens");
    return value;
  }

  private parseOr(): Value {
    let left = this.parseAnd();
    while (this.peek()?.type === "kw" && (this.peek() as { value: string }).value === "or") {
      this.pos += 1;
      const right = this.parseAnd();
      left = toBool(left) || toBool(right);
    }
    return left;
  }

  private parseAnd(): Value {
    let left = this.parseNot();
    while (this.peek()?.type === "kw" && (this.peek() as { value: string }).value === "and") {
      this.pos += 1;
      const right = this.parseNot();
      left = toBool(left) && toBool(right);
    }
    return left;
  }

  private parseNot(): Value {
    const token = this.peek();
    if (token?.type === "kw" && token.value === "not") {
      this.pos += 1;
      return !toBool(this.parseNot());
    }
    return this.parseComparison();
  }

  private parseComparison(): Value {
    const left = this.parsePrimary();
    const token = this.peek();
    if (token?.type === "op") {
      this.pos += 1;
      const right = this.parsePrimary();
      return this.compare(left, token.value, right);
    }
    if (token?.type === "kw" && token.value === "in") {
      this.pos += 1;
      const right = this.parsePrimary();
      return String(right).includes(String(left));
    }
    if (token?.type === "kw" && token.value === "not" && this.tokens[this.pos + 1]?.type === "kw" && (this.tokens[this.pos + 1] as { value: string }).value === "in") {
      this.pos += 2;
      const right = this.parsePrimary();
      return !String(right).includes(String(left));
    }
    return left;
  }

  private compare(left: Value, op: string, right: Value): boolean {
    switch (op) {
      case "==":
        return typeof left === "number" && typeof right === "number" ? left === right : String(left) === String(right);
      case "!=":
        return typeof left === "number" && typeof right === "number" ? left !== right : String(left) !== String(right);
      case "<":
        return Number(left) < Number(right);
      case ">":
        return Number(left) > Number(right);
      case "<=":
        return Number(left) <= Number(right);
      case ">=":
        return Number(left) >= Number(right);
      default:
        throw new Error(`unsupported operator: ${op}`);
    }
  }

  private parsePrimary(): Value {
    const token = this.peek();
    if (!token) throw new Error("unexpected end of expression");
    if (token.type === "str") {
      this.pos += 1;
      return token.value;
    }
    if (token.type === "num") {
      this.pos += 1;
      return token.value;
    }
    if (token.type === "bool") {
      this.pos += 1;
      return token.value;
    }
    if (token.type === "lparen") {
      this.pos += 1;
      const value = this.parseOr();
      if (this.peek()?.type !== "rparen") throw new Error("missing )");
      this.pos += 1;
      return value;
    }
    throw new Error("unexpected token");
  }
}

export function evaluateCondition(raw: string, args: ArgMap, packages: PackageIndex): ConditionResult {
  const resolved = resolveValue(raw, args, packages).trim();
  const evalMatch = resolved.match(/^\$\(eval\s+([\s\S]*)\)$/);
  if (evalMatch) {
    let body = evalMatch[1].trim();
    if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
      body = body.slice(1, -1);
    }
    try {
      const value = new Parser(tokenize(body)).parse();
      return { value: toBool(value), evaluated: true };
    } catch {
      return { value: true, evaluated: false };
    }
  }
  const lower = resolved.toLowerCase();
  if (lower === "true" || lower === "1") return { value: true, evaluated: true };
  if (lower === "false" || lower === "0") return { value: false, evaluated: true };
  // Empty usually means an unresolved/undefined var in our static analysis: fail open (do not prune).
  return { value: true, evaluated: false };
}

export function isElementActive(
  element: { if?: string; unless?: string },
  args: ArgMap,
  packages: PackageIndex
): boolean {
  if (element.if !== undefined) {
    const result = evaluateCondition(element.if, args, packages);
    if (result.evaluated && !result.value) return false;
  }
  if (element.unless !== undefined) {
    const result = evaluateCondition(element.unless, args, packages);
    if (result.evaluated && result.value) return false;
  }
  return true;
}
