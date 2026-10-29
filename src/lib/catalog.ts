// The `catalog:` block of `pnpm-workspace.yaml`: reading it, reading one
// entry's version spec, and editing versions in place.

import { Fail } from "./env.ts";

/**
 * The `catalog:` block. The file is read without a YAML parser, so the block
 * must be a flat mapping of plain or quoted scalars, which is what pnpm
 * writes; anything else fails the check.
 */
const parseCatalog = (yaml: string): Map<string, string> => {
  const entries = new Map<string, string>();
  const lines = yaml.split("\n");
  const start = lines.findIndex(
    (l) =>
      /^catalog:\s*(#.*)?$/.test(l) || /^catalog:\s*\{\s*\}\s*(#.*)?$/.test(l),
  );
  if (start === -1 || (lines[start] ?? "").includes("{")) {
    return entries;
  }
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const m =
      /^\s+(?:"([^"]*)"|'([^']*)'|([^\s"'#][^:]*?))\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#][^#]*?))\s*(#.*)?$/.exec(
        line,
      );
    if (m === null) {
      throw new Fail(
        `Cannot read this line of the catalog in pnpm-workspace.yaml: ${line.trim()}`,
      );
    }
    entries.set(m[1] ?? m[2] ?? m[3] ?? "", m[4] ?? m[5] ?? m[6] ?? "");
  }
  return entries;
};

/** The `.nvmrc` major, which caps `@types/node`. */
const nodeMajor = (nvmrc: string | null): number | null => {
  if (nvmrc === null) {
    return null;
  }
  const m = /^([0-9]+)\./.exec(nvmrc.replaceAll(/\s/g, "").replace(/^v/, ""));
  return m === null ? null : Number(m[1]);
};

/** An exact version with an optional `^` or `~`; anything else is skipped. */
const SPEC = /^([~^]?)([0-9]+\.[0-9]+\.[0-9]+)$/;

type Spec = { prefix: string; current: string };

const parseSpec = (spec: string): Spec | null => {
  const m = SPEC.exec(spec);
  if (m === null) {
    return null;
  }
  return { prefix: m[1] ?? "", current: m[2] ?? "" };
};

type CatalogUpdate = { current: string; target: string };

const unquote = (text: string): string =>
  text.length >= 2 &&
  ((text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")))
    ? text.slice(1, -1)
    : text;

/**
 * Edits only the version on each catalog line, so comments, quotes and blank
 * lines stay as they are. The whole value (minus its prefix) must be the
 * current version, not just contain it: `6.6.5` is inside `26.6.5`, and
 * replacing it there once produced `26.14.13`.
 */
const editCatalog = (
  yaml: string,
  updates: Map<string, CatalogUpdate>,
): string => {
  const done = new Set<string>();
  let inside = false;
  const out = yaml.split("\n").map((line) => {
    if (/^catalog:\s*(#.*)?$/.test(line)) {
      inside = true;
      return line;
    }
    if (inside && /^\S/.test(line)) {
      inside = false;
      return line;
    }
    const colon = line.indexOf(":");
    if (!inside || !/^\s+[^\s#]/.test(line) || colon === -1) {
      return line;
    }
    const key = unquote(line.slice(0, colon).trim());
    const u = updates.get(key);
    if (u === undefined) {
      return line;
    }
    const rest = line.slice(colon);
    const at = rest.indexOf(u.current);
    if (at === -1) {
      throw new Fail(`${key}: ${u.current} is not on its catalog line`);
    }
    const value = unquote(
      rest
        .slice(1)
        .trim()
        .replace(/\s*#.*$/, "")
        .trim(),
    ).replace(/^[~^]/, "");
    if (value !== u.current) {
      throw new Fail(
        `${key}: the catalog line holds ${value}, not ${u.current}`,
      );
    }
    done.add(key);
    return `${line.slice(0, colon)}${rest.slice(0, at)}${u.target}${rest.slice(at + u.current.length)}`;
  });
  if (done.size !== updates.size) {
    throw new Fail("not every update was found under catalog:");
  }
  return out.join("\n");
};

export { parseCatalog, nodeMajor, parseSpec, editCatalog };
