// "Section: dependencies (catalog)": every package in the `catalog:` of
// `pnpm-workspace.yaml` against the registry. The rows are kept apart in
// `20-catalog.rows` so the last step can truncate them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Fail, context } from "../lib/env.ts";
import { warning } from "../lib/actions.ts";
import { esc, plural } from "../lib/markdown.ts";
import {
  NAME,
  downloadPackuments,
  readPackument,
  versionExists,
} from "../lib/npm.ts";
import { writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { EXACT, dropVersion, newer } from "../lib/versions.ts";
import type { Newer } from "../lib/versions.ts";
import { FILES, readCutoff, requireSetup } from "./setup.ts";

const ID = "20-catalog";

/**
 * The `catalog:` block of `pnpm-workspace.yaml`. The file is read without a
 * YAML parser, so the block must be a flat mapping of plain or quoted
 * scalars, which is what pnpm writes; anything else fails the check.
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

type Row = Newer | { name: string; current: string; unparsed: true };

const isUnparsed = (
  row: Row,
): row is { name: string; current: string; unparsed: true } =>
  "unparsed" in row;

const hasUpdate = (row: Row): boolean =>
  !isUnparsed(row) && (row.inMajor !== null || row.major !== null);

/** The table rows for the outdated and unparsed entries, in catalog order. */
const tableRows = (rows: Row[]): string[] => {
  const majors = rows.filter((r) => !isUnparsed(r) && r.major !== null).length;
  return rows
    .filter((r) => isUnparsed(r) || hasUpdate(r))
    .map((r) => {
      const cells = isUnparsed(r)
        ? [
            `\`${esc(r.name)}\``,
            `\`${esc(r.current)}\``,
            "not an exact version",
            "",
            "",
          ]
        : [
            `\`${esc(r.name)}\``,
            r.current,
            r.inMajor ?? "",
            r.major === null ? "" : `⚠️ ${r.major}`,
            r.majorDate ?? r.inMajorDate ?? "",
          ];
      if (majors === 0) {
        cells.splice(3, 1);
      }
      return `| ${cells.join(" | ")} |`;
    });
};

/** A version a packument listed but the registry does not serve. */
type Phantom = { name: string; version: string };

/**
 * Every picked version against the registry's version endpoint. A version
 * it does not serve leaves its row, with its date, and is reported instead
 * of listed, so the issue and the supply chain step never name it.
 */
const confirm = async (
  rows: Row[],
  exists: (name: string, version: string) => Promise<boolean> = versionExists,
): Promise<{ rows: Row[]; phantom: Phantom[] }> => {
  const picks: Phantom[] = [];
  for (const row of rows) {
    if (!isUnparsed(row)) {
      for (const version of [row.inMajor, row.major]) {
        if (version !== null) {
          picks.push({ name: row.name, version });
        }
      }
    }
  }
  const served = await Promise.all(picks.map((p) => exists(p.name, p.version)));
  const phantom = picks.filter((_, i) => served[i] === false);
  const cleaned = rows.map((row) =>
    isUnparsed(row)
      ? row
      : phantom
          .filter((p) => p.name === row.name)
          .reduce((r, p) => dropVersion(r, p.version), row),
  );
  return { rows: cleaned, phantom };
};

const phantomLine = (p: Phantom): string =>
  `The registry lists \`${esc(p.name)}\` ${p.version} but does not serve it; ignored.`;

type Rendered = {
  markdown: string;
  status: Status;
  rows: string[] | null;
};

const render = (
  rows: Row[],
  minAgeDays: number,
  major: number | null,
  capsTypesNode: boolean,
  phantom: Phantom[] = [],
): Rendered => {
  const total = rows.length;
  const outdated = rows.filter(hasUpdate).length;
  const majors = rows.filter((r) => !isUnparsed(r) && r.major !== null).length;
  const unparsed = rows.filter(isUnparsed).length;
  if (outdated + unparsed === 0) {
    const notes = phantom.map((p) => `${phantomLine(p)}\n`).join("");
    return {
      markdown: `**Dependencies:** all ${total} catalog packages are up to date.\n${notes}`,
      status:
        phantom.length === 0
          ? {
              state: "ok",
              text: "up to date",
              details: plural(total, "package"),
            }
          : {
              state: "warn",
              text: `${phantom.length} not served`,
              details: `${plural(total, "package")}, ${phantom.length} not served by the registry`,
            },
      rows: null,
    };
  }
  const details: string[] = [];
  if (majors > 0) {
    details.push(plural(majors, "new major"));
  }
  if (unparsed > 0) {
    details.push(`${unparsed} not an exact version`);
  }
  if (phantom.length > 0) {
    details.push(`${phantom.length} not served by the registry`);
  }
  const lines = [
    "### Dependencies (`catalog:` in `pnpm-workspace.yaml`)",
    "",
    `${outdated} of ${total} packages have an update at least ${minAgeDays} days old.`,
  ];
  if (majors > 0) {
    lines.push("⚠️ marks a new major.");
  }
  if (unparsed === 1) {
    lines.push("1 entry is not an exact version and was not checked.");
  } else if (unparsed > 1) {
    lines.push(
      `${unparsed} entries are not exact versions and were not checked.`,
    );
  }
  if (major !== null && capsTypesNode) {
    lines.push(`\`@types/node\` is capped at the \`.nvmrc\` major (${major}).`);
  }
  lines.push(...phantom.map(phantomLine));
  lines.push("");
  if (majors > 0) {
    lines.push(
      "| Package | Current | Latest in major | Latest major | Released |",
    );
    lines.push("| --- | --- | --- | --- | --- |");
  } else {
    lines.push("| Package | Current | Latest in major | Released |");
    lines.push("| --- | --- | --- | --- |");
  }
  const status: Status =
    outdated > 0
      ? {
          state: "update",
          text: `${outdated} of ${total} outdated`,
          details: `${outdated} of ${total} outdated${details.length ? `, ${details.join(", ")}` : ""}`,
        }
      : {
          state: "warn",
          text:
            unparsed > 0
              ? `${unparsed} not an exact version`
              : `${phantom.length} not served`,
          details: details.join(", "),
        };
  return { markdown: `${lines.join("\n")}\n`, status, rows: tableRows(rows) };
};

const catalog = async (): Promise<void> => {
  const ctx = context();
  requireSetup(ctx.src);
  mkdirSync(ctx.npm, { recursive: true });
  const workspace = `${ctx.src}/${FILES.workspace}`;
  if (!existsSync(workspace)) {
    writeSection(
      ctx.sections,
      ID,
      "**Dependencies:** not applicable, no `pnpm-workspace.yaml`.\n",
      {
        state: "na",
        text: "not applicable",
        details: "no pnpm-workspace.yaml",
      },
    );
    return;
  }
  // Keys become registry URLs, so anything that is not an npm package name
  // is left out instead of quoted.
  const all = parseCatalog(readFileSync(workspace, "utf8"));
  const entries = [...all].filter(([name]) => NAME.test(name));
  if (all.size - entries.length > 0) {
    warning(
      `${all.size - entries.length} catalog entries are not npm package names and were skipped.`,
    );
  }
  if (entries.length === 0) {
    writeSection(
      ctx.sections,
      ID,
      "**Dependencies:** not applicable, no `catalog:` in `pnpm-workspace.yaml`.\n",
      {
        state: "na",
        text: "not applicable",
        details: "no catalog in pnpm-workspace.yaml",
      },
    );
    return;
  }
  const nvmrc = `${ctx.src}/${FILES.nvmrc}`;
  const major = nodeMajor(
    existsSync(nvmrc) ? readFileSync(nvmrc, "utf8") : null,
  );
  await downloadPackuments(
    ctx.npm,
    entries.map(([name]) => name),
  );
  const cutoff = readCutoff(ctx.src);
  const picked: Row[] = entries.map(([name, spec]) => {
    const current = spec.replace(/^[\^~]/, "");
    if (!EXACT.test(current)) {
      return { name, current: spec, unparsed: true };
    }
    return newer(
      readPackument(ctx.npm, name),
      name,
      current,
      cutoff,
      name === "@types/node" ? major : null,
    );
  });
  const { rows, phantom } = await confirm(picked);
  for (const p of phantom) {
    warning(
      `The packument lists ${p.name} ${p.version} but the registry does not serve it; ignored. See the download log above for the edge that served the packument.`,
    );
  }
  // The supply chain step reuses the rows and the packuments.
  writeFileSync(`${ctx.npm}/rows.json`, JSON.stringify(rows));
  const rendered = render(
    rows,
    ctx.minAgeDays,
    major,
    all.has("@types/node"),
    phantom,
  );
  if (rendered.rows !== null) {
    writeFileSync(
      `${ctx.sections}/${ID}.rows`,
      rendered.rows.map((r) => `${r}\n`).join(""),
    );
  }
  writeSection(ctx.sections, ID, rendered.markdown, rendered.status);
};

export {
  ID,
  parseCatalog,
  nodeMajor,
  isUnparsed,
  tableRows,
  confirm,
  render,
  catalog,
};
export type { Row };
