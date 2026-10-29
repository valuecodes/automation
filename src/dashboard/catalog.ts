// "Section: dependencies (catalog)": every package in the `catalog:` of
// `pnpm-workspace.yaml` against the registry. The rows are kept apart in
// `20-catalog.rows` so the last step can truncate them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { warning } from "../lib/actions.ts";
import { nodeMajor, parseCatalog, parseSpec } from "../lib/catalog.ts";
import { readCutoff } from "../lib/cutoff.ts";
import { context } from "../lib/env.ts";
import { esc, plural } from "../lib/markdown.ts";
import { NAME, downloadPackuments, readPackument } from "../lib/npm.ts";
import { writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { newer } from "../lib/versions.ts";
import type { Newer } from "../lib/versions.ts";
import { FILES, requireSetup } from "./setup.ts";

const ID = "20-catalog";

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
): Rendered => {
  const total = rows.length;
  const outdated = rows.filter(hasUpdate).length;
  const majors = rows.filter((r) => !isUnparsed(r) && r.major !== null).length;
  const unparsed = rows.filter(isUnparsed).length;
  if (outdated + unparsed === 0) {
    return {
      markdown: `**Dependencies:** all ${total} catalog packages are up to date.\n`,
      status: {
        state: "ok",
        text: "up to date",
        details: plural(total, "package"),
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
          text: `${unparsed} not an exact version`,
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
  const rows: Row[] = entries.map(([name, spec]) => {
    const parsed = parseSpec(spec);
    if (parsed === null) {
      return { name, current: spec, unparsed: true };
    }
    return newer(
      readPackument(ctx.npm, name),
      name,
      parsed.current,
      cutoff,
      name === "@types/node" ? major : null,
    );
  });
  // The supply chain step reuses the rows and the packuments.
  writeFileSync(`${ctx.npm}/rows.json`, JSON.stringify(rows));
  const rendered = render(rows, ctx.minAgeDays, major, all.has("@types/node"));
  if (rendered.rows !== null) {
    writeFileSync(
      `${ctx.sections}/${ID}.rows`,
      rendered.rows.map((r) => `${r}\n`).join(""),
    );
  }
  writeSection(ctx.sections, ID, rendered.markdown, rendered.status);
};

export { ID, isUnparsed, tableRows, render, catalog };
export type { Row };
