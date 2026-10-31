// "Update the dashboard issue": the title, alerts and summary table from the
// section files, the body cut to the issue size limit, and the issue created
// or edited only when something changed.

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { appendRunnerFile, error, warning } from "../lib/actions.ts";
import { Fail, context, env } from "../lib/env.ts";
import type { Context } from "../lib/env.ts";
import { api as githubApi } from "../lib/github.ts";
import type { Api } from "../lib/github.ts";
import { esc } from "../lib/markdown.ts";
import { markFailed, parseStatus } from "../lib/sections.ts";
import type { State, Status } from "../lib/sections.ts";

const SECTIONS = [
  "10-security",
  "15-supply-chain",
  "20-catalog",
  "30-pnpm",
  "50-node",
] as const;

const LABEL = "maintain-kit-dashboard";
const SOURCE_LINK =
  " · Source: [valuecodes/maintain-kit](https://github.com/valuecodes/maintain-kit)";
// Issue bodies are limited to 65,536 characters; the run summary always
// gets the full body.
const LIMIT = 60_000;

type Section = {
  id: string;
  name: string;
  status: Status | null;
  markdown: string;
  rows: string[] | null;
  failed: boolean;
};

const checkName = (id: string): string => {
  const name = id.replace(/^[0-9]+-/, "");
  return (
    {
      security: "Security",
      "supply-chain": "Supply chain",
      catalog: "Dependencies",
      node: "Node.js",
    }[name] ?? name
  );
};

/**
 * Reads the section files. An empty fragment with no status is a disabled
 * check and is left out. A fragment without a valid status means its step
 * died halfway, so it counts as failed too.
 */
const readSections = (dir: string, runsUrl: string): Section[] => {
  const sections: Section[] = [];
  for (const id of SECTIONS) {
    const md = `${dir}/${id}.md`;
    const markdown = existsSync(md) ? readFileSync(md, "utf8") : null;
    const statusFile = `${dir}/${id}.status`;
    const status = existsSync(statusFile)
      ? parseStatus(readFileSync(statusFile, "utf8"))
      : null;
    if (markdown === "" && !existsSync(statusFile)) {
      continue;
    }
    const name = checkName(id);
    let failed = existsSync(`${dir}/${id}.failed`);
    if (markdown === null || status === null) {
      error(`The ${name} check failed.`);
      failed = true;
      const section: Section = {
        id,
        name,
        status: { state: "failed", text: "check failed", details: "" },
        markdown: `**${id.replace(/^[0-9]+-/, "")}:** check failed, see [the latest run](${runsUrl}).\n`,
        rows: null,
        failed,
      };
      // Written back so the step is repeatable and the run reports it.
      writeFileSync(md, section.markdown);
      writeFileSync(statusFile, `failed\tcheck failed\t\n`);
      if (existsSync(`${dir}/${id}.rows`)) {
        unlinkSync(`${dir}/${id}.rows`);
      }
      markFailed(dir, id);
      sections.push(section);
      continue;
    }
    const rowsFile = `${dir}/${id}.rows`;
    const rows = existsSync(rowsFile)
      ? readFileSync(rowsFile, "utf8")
          .split("\n")
          .filter((l) => l !== "")
      : null;
    sections.push({ id, name, status, markdown, rows, failed });
  }
  return sections;
};

const namesIn = (sections: Section[], state: State): string[] =>
  sections.filter((s) => s.status?.state === state).map((s) => s.name);

/**
 * The title carries the worst state and names the checks in it, so the
 * pinned issue tells from the issue list what needs attention. Counts stay
 * out, so the title changes with the state, not with every new advisory.
 */
const headline = (sections: Section[]): string => {
  const alerts = namesIn(sections, "alert");
  if (alerts.length > 0) {
    // Supply chain is only an alert for a malicious package in the lockfile,
    // so the title says that instead of a vague word.
    return `🔴 ${alerts
      .join(", ")
      .replace("Supply chain", "malicious package in lockfile")
      .replace("Security", "Security alert")}`;
  }
  const failed = namesIn(sections, "failed");
  if (failed.length > 1) {
    return `❌ ${failed.join(", ")} checks failed`;
  }
  if (failed.length === 1) {
    return `❌ ${failed[0]} check failed`;
  }
  const warn = namesIn(sections, "warn");
  if (warn.length > 1) {
    return `⚠️ ${warn.join(", ")} need attention`;
  }
  if (warn.length === 1) {
    return `⚠️ ${warn[0]} needs attention`;
  }
  const updates = namesIn(sections, "update").length;
  if (updates === 1) {
    return "⬆️ 1 update";
  }
  if (updates > 1) {
    return `⬆️ ${updates} updates`;
  }
  return "✅ all current";
};

// The one place that pairs a state with its emoji and word. The word is
// fixed per state, so the Status column reads the same in every row and
// still makes sense where emoji do not render.
const icon = (state: State): string =>
  ({
    ok: "✅ ok",
    na: "⚪ n/a",
    update: "⬆️ update",
    warn: "⚠️ attention",
    alert: "🔴 alert",
  })[state as string] ?? "❌ failed";

/** Alert blocks for what needs action; nothing when there is nothing to say. */
const alerts = (sections: Section[], runsUrl: string): string[] => {
  const out: string[] = [];
  const warnings: string[] = [];
  const by = (id: string): Status | null =>
    sections.find((s) => s.id === id)?.status ?? null;
  const supply = by("15-supply-chain");
  if (supply?.state === "alert") {
    out.push(
      "> [!CAUTION]",
      `> ${supply.details}. See Supply chain below.`,
      "",
    );
  } else if (supply?.state === "warn" && supply.text.startsWith("malicious")) {
    warnings.push(
      `Supply chain: malicious update candidate, ${supply.details}. See Supply chain below.`,
    );
  }
  const security = by("10-security");
  if (security?.state === "alert") {
    out.push(
      "> [!CAUTION]",
      `> ${security.details} in \`pnpm-lock.yaml\`, see Security below.`,
      "",
    );
  }
  const failed = sections.filter((s) => s.failed).map((s) => s.name);
  if (failed.length > 0) {
    warnings.unshift(
      `Checks failed: ${failed.join(", ")}. See [the latest run](${runsUrl}).`,
    );
  }
  const node = by("50-node");
  if (node?.state === "warn") {
    warnings.push(`Node.js: ${node.text}.`);
  }
  if (warnings.length > 0) {
    // A bare `>` line keeps the warnings in separate paragraphs.
    out.push("> [!WARNING]", warnings.map((w) => `> ${w}`).join("\n>\n"), "");
  }
  return out;
};

/** The body with at most `keep` catalog rows. */
const build = (sections: Section[], runsUrl: string, keep: number): string => {
  const lines = [
    ...alerts(sections, runsUrl),
    "| Check | Status | Details |",
    "| --- | --- | --- |",
  ];
  for (const s of sections) {
    if (s.status !== null) {
      lines.push(
        `| ${s.name} | ${icon(s.status.state)} | ${esc(s.status.details)} |`,
      );
    }
  }
  for (const s of sections) {
    if (s.markdown === "") {
      continue;
    }
    lines.push("", s.markdown.replace(/\n$/, ""));
    if (s.rows !== null) {
      lines.push(...s.rows.slice(0, keep));
      if (keep < s.rows.length) {
        // One cell fits the table with or without the "Latest major" column;
        // Markdown fills the missing cells.
        lines.push(
          `| … ${s.rows.length - keep} more, see [the latest run's summary](${runsUrl}) |`,
        );
      }
    }
  }
  return lines.join("\n").replace(/\n+$/, "");
};

/** The full body, then cut until it fits the issue size limit. */
const content = (
  sections: Section[],
  runsUrl: string,
): { full: string; fitted: string } => {
  const rows = sections.find((s) => s.rows !== null)?.rows?.length ?? 0;
  let keep = rows;
  const full = build(sections, runsUrl, keep);
  let fitted = full;
  while (length(fitted) > LIMIT) {
    if (keep === 0) {
      throw new Fail(
        "The body exceeds the issue size limit even without the catalog table.",
      );
    }
    let next = Math.floor((keep * LIMIT) / length(fitted));
    if (next >= keep) {
      next = keep - 1;
    }
    keep = next;
    fitted = build(sections, runsUrl, keep);
  }
  return { full, fitted };
};

const length = (text: string): number => [...text].length;

const footer = (
  body: string,
  date: string,
  runsUrl: string,
  note: string,
): string => {
  // The hash excludes the date, so an unchanged body is not re-saved.
  const hash = createHash("sha256").update(body).digest("hex");
  return `${body}\n\n---\nLast changed: ${date} · [Workflow runs](${runsUrl})${SOURCE_LINK}\n\n${note}\n<!-- maintain-kit-dashboard:${hash} -->\n`;
};

type Issue = {
  number: number;
  title: string;
  body: string | null;
  html_url?: string;
  pull_request?: unknown;
};

/**
 * Whether the open issue already holds this body. Unchanged means the same
 * title, content, footer and marker, so a hand edit is overwritten and an
 * issue with an older footer gains the current one once.
 */
const unchanged = (
  issue: Issue,
  title: string,
  body: string,
  note: string,
): boolean => {
  const hash = createHash("sha256").update(body).digest("hex");
  // Like the shell's `$(...)`, the comparison ignores trailing newlines.
  const existing = (issue.body ?? "").replaceAll("\r", "").replace(/\n+$/, "");
  const prefix = `${body}\n\n---\nLast changed: `;
  const suffix = `${SOURCE_LINK}\n\n${note}\n<!-- maintain-kit-dashboard:${hash} -->`;
  return (
    issue.title === title &&
    existing.startsWith(prefix) &&
    existing.endsWith(suffix) &&
    existing.length >= prefix.length + suffix.length
  );
};

const publish = async (
  api: Api,
  repo: string,
  title: string,
  /** The body without the footer, which the marker hashes. */
  content: string,
  body: string,
  note: string,
  log: (line: string) => void = console.log,
): Promise<void> => {
  const label = {
    color: "1d76db",
    description:
      "Kept up to date by the maintain-kit-dashboard workflow (valuecodes/maintain-kit)",
  };
  try {
    await api("POST", `repos/${repo}/labels`, { name: LABEL, ...label });
  } catch (error) {
    if (
      !(error instanceof Error && "status" in error && error.status === 422)
    ) {
      throw error;
    }
    await api("PATCH", `repos/${repo}/labels/${LABEL}`, label);
  }
  const issues = (
    await api<Issue[]>(
      "GET",
      `repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100`,
    )
  )
    .filter((i) => i.pull_request === undefined)
    .sort((a, b) => a.number - b.number);
  const first = issues[0];
  if (first === undefined) {
    const created = await api<Issue>("POST", `repos/${repo}/issues`, {
      title,
      body,
      labels: [LABEL],
    });
    log(`Created ${created.html_url}. Pin it in the repo's issue list.`);
    return;
  }
  const number = first.number;
  if (issues.length > 1) {
    warning(
      `Several open issues carry the maintain-kit-dashboard label; editing #${number} and leaving the rest.`,
    );
  }
  // Editing the title does not notify anyone either.
  const issue = await api<Issue>("GET", `repos/${repo}/issues/${number}`);
  if (unchanged(issue, title, content, note)) {
    log(`Issue #${number} is unchanged.`);
  } else {
    await api("PATCH", `repos/${repo}/issues/${number}`, { title, body });
    log(`Updated issue #${number}.`);
  }
};

const issue = async (
  ctx: Context = context(),
  api: Api = githubApi,
): Promise<void> => {
  const sections = readSections(ctx.sections, ctx.runsUrl);
  const runUrl = `${env("SERVER_URL")}/${ctx.repo}/actions/runs/${env("RUN_ID")}`;
  const title = `Maintenance dashboard: ${headline(sections)}`;
  // In the footer, so the issue opens with what needs action.
  const note = `Generated by the \`${ctx.caller}\` workflow; manual edits are overwritten.`;
  const { full, fitted } = content(sections, ctx.runsUrl);
  appendRunnerFile(
    "GITHUB_STEP_SUMMARY",
    `## ${title}\n\n${full}\n\n---\nLast run: ${runUrl}${SOURCE_LINK}\n`,
  );
  const body = footer(
    fitted,
    new Date().toISOString().slice(0, 10),
    ctx.runsUrl,
    note,
  );
  writeFileSync(`${ctx.temp}/body.md`, body);
  if (ctx.dryRun) {
    console.log(
      "Dry run: the title and body are in the run summary; the issue was not touched.",
    );
  } else {
    await publish(api, ctx.repo, title, fitted, body, note);
  }

  const failed = readdirSync(ctx.sections)
    .filter((f) => f.endsWith(".failed"))
    .map((f) => f.replace(/\.failed$/, ""))
    .sort();
  if (failed.length > 0) {
    throw new Fail(`Checks failed: ${failed.join(" ")}.`);
  }
  // Unlike `pnpm audit` findings, a known-malicious package is an incident,
  // and a red scheduled run is the only notification `GITHUB_TOKEN` can
  // send. That holds for an update candidate too, whose state is only a
  // warning, so this reads the status text.
  const supply = sections.find((s) => s.id === "15-supply-chain")?.status;
  if (
    supply !== undefined &&
    supply !== null &&
    supply.text.startsWith("malicious")
  ) {
    throw new Fail(
      `${supply.details}. See the Supply chain section of the dashboard.`,
    );
  }
};

export {
  readSections,
  headline,
  build,
  content,
  footer,
  unchanged,
  publish,
  issue,
};
export type { Section };
