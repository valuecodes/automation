// A reader for the YAML pnpm writes: block mappings and sequences, flow
// `{…}` and `[…]`, plain and quoted scalars, comments and `---` documents.
// That covers `pnpm-lock.yaml` and `pnpm-workspace.yaml` without a YAML
// package; anchors, tags and block scalars are refused, not misread.

type Yaml =
  | null
  | boolean
  | number
  | string
  | Yaml[]
  | { readonly [key: string]: Yaml };

class YamlError extends Error {}

type Line = { indent: number; text: string; no: number };

/** Reads a quoted scalar starting at `at`; returns it and the index after. */
const readQuoted = (text: string, at: number): [string, number] => {
  const quote = text[at];
  if (quote === "'") {
    let out = "";
    for (let i = at + 1; i < text.length; i += 1) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          return [out, i + 1];
        }
      } else {
        out += text[i];
      }
    }
  } else {
    for (let i = at + 1; i < text.length; i += 1) {
      if (text[i] === "\\") {
        i += 1;
      } else if (text[i] === '"') {
        return [JSON.parse(text.slice(at, i + 1)) as string, i + 1];
      }
    }
  }
  throw new YamlError(`unterminated quoted scalar: ${text}`);
};

/** The line without its trailing comment, if any. */
const stripComment = (text: string): string => {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = i === 0 ? " " : (text[i - 1] ?? " ");
    if ((ch === "'" || ch === '"') && /[\s:,[{-]/.test(prev)) {
      i = readQuoted(text, i)[1] - 1;
    } else if (ch === "#" && /\s/.test(prev)) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
};

const plain = (text: string): Yaml => {
  if (text === "" || text === "~" || text === "null") {
    return null;
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  // Integers only: `1.10` is a version far more often than a float.
  if (/^-?(0|[1-9][0-9]*)$/.test(text)) {
    return Number(text);
  }
  return text;
};

const unsupported = (text: string): void => {
  if (/^[|>&*!]/.test(text)) {
    throw new YamlError(`unsupported YAML syntax: ${text}`);
  }
};

const skipSpace = (text: string, at: number): number => {
  let i = at;
  while (i < text.length && /\s/.test(text[i] ?? "")) {
    i += 1;
  }
  return i;
};

/** A flow collection or scalar starting at `at`; returns it and the end. */
const readFlow = (text: string, at: number): [Yaml, number] => {
  let i = skipSpace(text, at);
  const open = text[i];
  if (open === "{") {
    const out: Record<string, Yaml> = {};
    i += 1;
    for (;;) {
      i = skipSpace(text, i);
      if (text[i] === "}") {
        return [out, i + 1];
      }
      let key: string;
      if (text[i] === "'" || text[i] === '"') {
        [key, i] = readQuoted(text, i);
      } else {
        const colon = text.indexOf(":", i);
        if (colon === -1) {
          throw new YamlError(`flow mapping without ':' in ${text}`);
        }
        key = text.slice(i, colon).trim();
        i = colon;
      }
      i = skipSpace(text, i);
      if (text[i] !== ":") {
        throw new YamlError(`expected ':' in ${text}`);
      }
      let value: Yaml;
      [value, i] = readFlow(text, i + 1);
      out[key] = value;
      i = skipSpace(text, i);
      if (text[i] === ",") {
        i += 1;
      } else if (text[i] !== "}") {
        throw new YamlError(`expected ',' or '}' in ${text}`);
      }
    }
  }
  if (open === "[") {
    const out: Yaml[] = [];
    i += 1;
    for (;;) {
      i = skipSpace(text, i);
      if (text[i] === "]") {
        return [out, i + 1];
      }
      let value: Yaml;
      [value, i] = readFlow(text, i);
      out.push(value);
      i = skipSpace(text, i);
      if (text[i] === ",") {
        i += 1;
      } else if (text[i] !== "]") {
        throw new YamlError(`expected ',' or ']' in ${text}`);
      }
    }
  }
  if (open === "'" || open === '"') {
    return readQuoted(text, i);
  }
  let end = i;
  while (end < text.length && !",]}".includes(text[end] ?? "")) {
    end += 1;
  }
  const raw = text.slice(i, end).trim();
  unsupported(raw);
  return [plain(raw), end];
};

/**
 * A value written on the key's line, or a sequence item's. Only a flow
 * collection or a quoted scalar is read by its delimiters: a plain scalar
 * runs to the end of the line, commas and all (`deprecated: x, see y`).
 */
const inline = (text: string): Yaml => {
  unsupported(text);
  if (!/^[{['"]/.test(text)) {
    return plain(text);
  }
  const [value, end] = readFlow(text, 0);
  if (skipSpace(text, end) !== text.length) {
    throw new YamlError(`unexpected text after a value: ${text}`);
  }
  return value;
};

/** `key: rest` of a mapping line, or null when the line is not one. */
const splitKey = (text: string): [string, string] | null => {
  let key: string;
  let end: number;
  if (text.startsWith("{") || text.startsWith("[")) {
    return null;
  }
  if (text.startsWith("'") || text.startsWith('"')) {
    [key, end] = readQuoted(text, 0);
  } else {
    const m = /^(.*?):(?:\s|$)/.exec(text);
    if (m === null) {
      return null;
    }
    key = (m[1] ?? "").trim();
    end = (m[1] ?? "").length;
  }
  const after = /^\s*:(?:\s+|$)/.exec(text.slice(end));
  if (after === null) {
    return null;
  }
  return [key, text.slice(end + after[0].length).trim()];
};

const isItem = (text: string): boolean => text === "-" || text.startsWith("- ");

const parseBlock = (
  lines: Line[],
  at: number,
  indent: number,
): [Yaml, number] =>
  isItem(lines[at]?.text ?? "")
    ? parseSequence(lines, at, indent)
    : parseMapping(lines, at, indent);

const parseNested = (
  lines: Line[],
  at: number,
  indent: number,
): [Yaml, number] => {
  const next = lines[at];
  if (next !== undefined && next.indent > indent) {
    return parseBlock(lines, at, next.indent);
  }
  if (next !== undefined && next.indent === indent && isItem(next.text)) {
    return parseSequence(lines, at, indent);
  }
  return [null, at];
};

const parseMapping = (
  lines: Line[],
  at: number,
  indent: number,
): [Yaml, number] => {
  const out: Record<string, Yaml> = {};
  let i = at;
  for (let line = lines[i]; line !== undefined && line.indent === indent;) {
    if (isItem(line.text)) {
      break;
    }
    const kv = splitKey(line.text);
    if (kv === null) {
      throw new YamlError(`line ${line.no}: expected 'key: value'`);
    }
    const [key, rest] = kv;
    i += 1;
    let value: Yaml;
    if (rest === "") {
      [value, i] = parseNested(lines, i, indent);
    } else {
      value = inline(rest);
    }
    out[key] = value;
    line = lines[i];
  }
  return [out, i];
};

const parseSequence = (
  lines: Line[],
  at: number,
  indent: number,
): [Yaml, number] => {
  const out: Yaml[] = [];
  let i = at;
  for (
    let line = lines[i];
    line !== undefined && line.indent === indent && isItem(line.text);
  ) {
    const item = line.text.slice(2).trim();
    if (item === "") {
      i += 1;
      let value: Yaml;
      [value, i] = parseNested(lines, i, indent);
      out.push(value);
    } else if (splitKey(item) === null) {
      out.push(inline(item));
      i += 1;
    } else {
      // `- key: value` opens a mapping indented past the dash.
      lines[i] = { indent: indent + 2, text: item, no: line.no };
      let value: Yaml;
      [value, i] = parseMapping(lines, i, indent + 2);
      out.push(value);
    }
    line = lines[i];
  }
  return [out, i];
};

const parseDocument = (text: string): Yaml => {
  const lines: Line[] = [];
  text.split("\n").forEach((raw, index) => {
    if (raw.startsWith("\t")) {
      throw new YamlError(`line ${index + 1}: tabs cannot indent YAML`);
    }
    const indent = raw.length - raw.trimStart().length;
    const content = stripComment(raw.slice(indent));
    if (content !== "") {
      lines.push({ indent, text: content, no: index + 1 });
    }
  });
  const first = lines[0];
  if (first === undefined) {
    return null;
  }
  const [value, end] = parseBlock(lines, 0, first.indent);
  const left = lines[end];
  if (left !== undefined) {
    throw new YamlError(`line ${left.no}: unexpected indentation`);
  }
  return value;
};

/** Every document of the text, in order; an empty document is null. */
const parseYaml = (text: string): Yaml[] => {
  const docs: string[] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (/^---(\s.*)?$/.test(line)) {
      docs.push(current.join("\n"));
      current = [];
    } else if (!/^\.\.\.(\s.*)?$/.test(line)) {
      current.push(line);
    }
  }
  docs.push(current.join("\n"));
  // A leading `---` opens the first document rather than ending an empty one.
  const parsed = docs.map(parseDocument);
  if (parsed.length > 1 && parsed[0] === null && docs[0]?.trim() === "") {
    parsed.shift();
  }
  return parsed;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export { parseYaml, asRecord };
