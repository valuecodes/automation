// "Section: security (pnpm audit)": the audit job's result as a table, one
// row per package, version, path set and fix.

import { existsSync, readFileSync } from "node:fs";
import { Fail, context } from "../lib/env.ts";
import { byCodePoint, esc } from "../lib/markdown.ts";
import { markFailed, writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { requireSetup } from "./setup.ts";

const ID = "10-security";

type Advisory = {
  severity?: string;
  module_name?: string;
  patched_versions?: string | null;
  github_advisory_id?: string | null;
  id?: string | number;
  url?: string;
  findings?: { version?: string; paths?: string[] }[];
};

type Audit = {
  advisories: Record<string, Advisory>;
};

const RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  info: 4,
};
const MARK: Record<string, string> = {
  critical: "🟥",
  high: "🟧",
  moderate: "🟨",
  low: "⬜",
  info: "⬜",
};

const rank = (severity: string): number => RANK[severity] ?? 5;

// Paths look like `.>knip>zod` or `apps__playground>wrangler>sharp`.
const describePath = (path: string): string => {
  const parts = path.split(">");
  const head =
    parts[0] === "." ? "" : `${(parts[0] ?? "").replaceAll("__", "/")}: `;
  const direct = parts.length === 2 ? " (direct)" : "";
  return `${head}${parts.slice(1).join(" > ")}${direct}`;
};

type Row = {
  rank: number;
  severity: string;
  module: string;
  found: string;
  patched: string;
  paths: string[];
  path: string;
  link: string;
};

const rows = (audit: Audit): Row[] =>
  Object.values(audit.advisories).map((a) => {
    const findings = a.findings ?? [];
    const paths = [...new Set(findings.flatMap((f) => f.paths ?? []))].sort(
      byCodePoint,
    );
    const severity = a.severity ?? "";
    return {
      rank: rank(severity),
      severity,
      module: a.module_name ?? "",
      found: [...new Set(findings.map((f) => f.version ?? ""))]
        .sort(byCodePoint)
        .join(", "),
      patched: a.patched_versions ?? "none",
      paths,
      path:
        describePath(paths[0] ?? "?") +
        (paths.length > 1 ? ` (+${paths.length - 1} more)` : ""),
      link: `[${a.github_advisory_id ?? a.id}](${a.url})`,
    };
  });

/** jq's ordering of the group key `[module, found, patched, paths]`. */
const compareKeys = (a: Row, b: Row): number =>
  byCodePoint(a.module, b.module) ||
  byCodePoint(a.found, b.found) ||
  byCodePoint(a.patched, b.patched) ||
  byCodePoint(JSON.stringify(a.paths), JSON.stringify(b.paths));

/** The table rows. Advisories on the same package, version, paths and fix
 * share a row: one update clears them all. */
const table = (audit: Audit): string[] => {
  const groups = new Map<string, { first: Row; all: Row[] }>();
  for (const row of rows(audit)) {
    const key = JSON.stringify([row.module, row.found, row.patched, row.paths]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { first: row, all: [row] });
    } else {
      group.all.push(row);
    }
  }
  return [...groups.values()]
    .map((g) => {
      const all = [...g.all].sort(
        (a, b) => a.rank - b.rank || byCodePoint(a.link, b.link),
      );
      return { first: all[0] ?? g.first, all };
    })
    .sort((a, b) => compareKeys(a.first, b.first))
    .sort(
      (a, b) =>
        a.first.rank - b.first.rank ||
        byCodePoint(a.first.module, b.first.module),
    )
    .map(({ first, all }) => {
      const mark = MARK[first.severity] ?? "⬜";
      return `| ${mark} ${esc(first.severity)} | \`${esc(first.module)}\` ${esc(first.found)} | ${esc(first.patched)} | ${esc(first.path)} | ${all.map((r) => r.link).join(", ")} |`;
    });
};

/** Counts by severity, worst first: `1 high, 2 moderate`. */
const breakdown = (audit: Audit): string => {
  const counts = new Map<string, number>();
  for (const a of Object.values(audit.advisories)) {
    const s = a.severity ?? "";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => byCodePoint(a[0], b[0]))
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([s, n]) => `${n} ${esc(s)}`)
    .join(", ");
};

type Section = {
  markdown: string;
  status: Status;
  failed?: boolean;
};

const render = (
  auditStatus: string,
  audit: Audit | null,
  runsUrl: string,
): Section => {
  if (auditStatus.startsWith("skipped: ")) {
    const why = auditStatus.slice("skipped: ".length);
    return {
      markdown: `**Security (pnpm audit):** not applicable, ${why}.\n`,
      status: { state: "na", text: "not applicable", details: why },
    };
  }
  if (auditStatus.startsWith("failed: ")) {
    const why = auditStatus.slice("failed: ".length);
    return {
      markdown: `**Security (pnpm audit):** check failed (${why}), see [the latest run](${runsUrl}).\n`,
      status: { state: "failed", text: "check failed", details: why },
      failed: true,
    };
  }
  if (auditStatus !== "ok" || audit === null) {
    throw new Fail(`Unexpected audit status '${auditStatus}'.`);
  }
  const count = Object.keys(audit.advisories).length;
  if (count === 0) {
    return {
      markdown:
        "**Security (pnpm audit):** no known vulnerabilities in `pnpm-lock.yaml`.\n",
      status: { state: "ok", text: "no known vulnerabilities", details: "" },
    };
  }
  // One advisory can hit several paths, so every count here comes from the
  // advisories, not from `.metadata.vulnerabilities`. The banner and the
  // summary table already give the count, so the section is the table alone.
  const noun = count === 1 ? "vulnerability" : "vulnerabilities";
  const markdown = [
    "### Security (pnpm audit)",
    "",
    "| Severity | Package | Patched | Path | Advisories |",
    "| --- | --- | --- | --- | --- |",
    ...table(audit),
  ].join("\n");
  return {
    markdown: `${markdown}\n`,
    status: {
      state: "alert",
      text: `${count} ${noun}`,
      details: `${count} ${noun} (${breakdown(audit)})`,
    },
  };
};

const security = (): void => {
  const ctx = context();
  requireSetup(ctx.src);
  if (!existsSync(`${ctx.audit}/status`)) {
    throw new Fail("The audit job produced no result.");
  }
  const auditStatus = readFileSync(`${ctx.audit}/status`, "utf8").trim();
  const audit =
    auditStatus === "ok"
      ? (JSON.parse(readFileSync(`${ctx.audit}/audit.json`, "utf8")) as Audit)
      : null;
  const section = render(auditStatus, audit, ctx.runsUrl);
  if (section.failed === true) {
    markFailed(ctx.sections, ID);
  }
  writeSection(ctx.sections, ID, section.markdown, section.status);
};

export { table, breakdown, render, security };
export type { Audit };
