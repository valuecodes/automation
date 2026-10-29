// "Dependencies: pick the updates": every `catalog:` entry of
// `pnpm-workspace.yaml` against the registry, the same rule and signals as
// the dashboard. The picks go to the resolve step, which edits the file and
// resolves the lockfile; the PR body is rendered there too, once the new
// locked versions are known.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { appendRunnerFile, warning } from "../lib/actions.ts";
import { nodeMajor, parseCatalog, parseSpec } from "../lib/catalog.ts";
import { Fail } from "../lib/env.ts";
import type { LockedPackage } from "../lib/lockfile.ts";
import { esc } from "../lib/markdown.ts";
import { NAME, downloadPackuments, readPackument } from "../lib/npm.ts";
import { signalRow, signals } from "../lib/signals.ts";
import { newer } from "../lib/versions.ts";
import type { Packument } from "../lib/versions.ts";
import { asRecord, parseYaml } from "../lib/yaml.ts";
import { updateContext } from "./context.ts";
import { writeState } from "./outcome.ts";
import { FILES } from "./setup.ts";

type Kept = {
  name: string;
  prefix: string;
  current: string;
  target: string;
  date: string;
};

type Picks = {
  total: number;
  kept: Kept[];
  /** Table rows of the candidates held back by update signals. */
  flagged: string[];
  majors: number;
};

/**
 * The lockfile is resolved by pnpm, which picks transitive versions on its
 * own. Its cooldown and trust check are what keep a fresh or downgraded
 * release out of them, so the caller must have both, with a cooldown at
 * least as long as this workflow's. Returns the cooldown in minutes.
 */
const guard = (doc: unknown, minAgeDays: number): number | null => {
  const settings = asRecord(doc);
  const age = settings?.minimumReleaseAge ?? 0;
  let minutes: number | null = null;
  if (typeof age === "number" && Number.isInteger(age) && age >= 0) {
    minutes = age;
  } else if (typeof age === "string" && /^[0-9]+$/.test(age)) {
    minutes = Number(age);
  }
  if (
    minutes === null ||
    minutes < minAgeDays * 1440 ||
    settings?.trustPolicy !== "no-downgrade"
  ) {
    return null;
  }
  return minutes;
};

/** What the pick rests on, for the log: a wrong current version or an odd
 * publish date, tarball or publisher shows up here. */
const pickLog = (
  name: string,
  target: string,
  current: string,
  pack: Packument,
): string => {
  const v = pack.versions?.[target];
  return `${name}: picked ${target} over ${current}, published ${pack.time?.[target] ?? "?"}, tarball ${v?.dist?.tarball ?? "?"}, publisher ${v?._npmUser?.name ?? "?"}, ${Object.keys(pack.versions ?? {}).length} versions, latest ${pack["dist-tags"]?.latest ?? "?"}`;
};

const pick = (
  entries: [string, string][],
  packument: (name: string) => Packument,
  cutoff: number,
  major: number | null,
  log: (line: string) => void,
): Picks => {
  const picks: Picks = {
    total: entries.length,
    kept: [],
    flagged: [],
    majors: 0,
  };
  for (const [name, spec] of entries) {
    const parsed = parseSpec(spec);
    if (parsed === null) {
      continue;
    }
    const pack = packument(name);
    const row = newer(
      pack,
      name,
      parsed.current,
      cutoff,
      name === "@types/node" ? major : null,
    );
    if (row.major !== null) {
      picks.majors += 1;
    }
    if (row.inMajor === null) {
      continue;
    }
    log(pickLog(name, row.inMajor, parsed.current, pack));
    const found = signals(pack, parsed.current, row.inMajor);
    if (found.length > 0) {
      picks.flagged.push(signalRow(name, parsed.current, row.inMajor, found));
    } else {
      picks.kept.push({
        name,
        prefix: parsed.prefix,
        current: parsed.current,
        target: row.inMajor,
        date: row.inMajorDate ?? "",
      });
    }
  }
  return picks;
};

const currentReason = (picks: Picks): string => {
  let reason =
    picks.flagged.length > 0
      ? `${picks.flagged.length} catalog updates are held back by update signals, see the dashboard`
      : `the ${picks.total} catalog packages are up to date on their majors`;
  if (picks.majors > 0) {
    reason += "; new majors stay on the dashboard";
  }
  return reason;
};

const catalogTitle = (kept: Kept[]): string =>
  kept.length === 1
    ? `Update ${kept[0]?.name ?? ""} to ${kept[0]?.target ?? ""}`
    : `Update ${kept.length} catalog packages`;

type Rendered = { content: string[]; summary: string[] };

/** The lockfile part of a PR body, shared by the pnpm and catalog kinds. The
 * full list of new locked versions goes to the run summary and the PR shows
 * the first 100, so a large resolution cannot break the body. `lead` says
 * why the lockfile changed when the edited file does not make it obvious. */
const renderLockfile = (
  added: LockedPackage[],
  runsUrl: string,
  lead = "",
): Rendered => {
  const prefix = lead === "" ? "" : `${lead} `;
  if (added.length === 0) {
    return {
      content: ["### Lockfile changes", "", `${prefix}No new locked versions.`],
      summary: [],
    };
  }
  const content = [
    "### Lockfile changes",
    "",
    `${prefix}${added.length} new locked ${added.length === 1 ? "version" : "versions"}, all checked on osv.dev: none is in the OpenSSF malicious-packages database.`,
    "",
    "<details><summary>New locked versions</summary>",
    "",
    "| Package | Version |",
    "| --- | --- |",
    ...added.slice(0, 100).map((a) => `| \`${a.name}\` | ${a.version} |`),
  ];
  if (added.length > 100) {
    content.push(
      `| … ${added.length - 100} more, see [the latest run's summary](${runsUrl}) |`,
    );
  }
  content.push("", "</details>");
  const summary = [
    "### All new locked versions",
    "",
    ...added.map((a) => `- \`${a.name}\` ${a.version}`),
  ];
  return { content, summary };
};

/** The PR body, with the lockfile part from `renderLockfile`. */
const renderCatalog = (
  picks: Picks,
  added: LockedPackage[],
  runsUrl: string,
): Rendered => {
  const flagged = picks.flagged.length;
  const content: string[] = [];
  if (flagged > 0) {
    content.push(
      "> [!WARNING]",
      flagged === 1
        ? "> 1 package was left out because of update signals, see below."
        : `> ${flagged} packages were left out because of update signals, see below.`,
      "",
    );
  }
  content.push(
    "| Package | Current | Update | Released |",
    "| --- | --- | --- | --- |",
    ...picks.kept.map(
      (k) =>
        `| \`${esc(k.name)}\` | ${k.prefix}${k.current} | ${k.prefix}${k.target} | ${k.date} |`,
    ),
    "",
  );
  const lockfile = renderLockfile(added, runsUrl);
  content.push(...lockfile.content);
  if (flagged > 0) {
    content.push(
      "",
      "### Left out",
      "",
      "| Package | Update | Signals |",
      "| --- | --- | --- |",
      ...picks.flagged,
    );
  }
  return { content, summary: lockfile.summary };
};

const readPicks = (npm: string): Picks => {
  const file = `${npm}/picks.json`;
  if (!existsSync(file)) {
    throw new Fail("The pick step wrote no result; see the step before.");
  }
  return JSON.parse(readFileSync(file, "utf8")) as Picks;
};

const catalog = async (): Promise<void> => {
  const ctx = updateContext();
  const workspace = `${ctx.src}/${FILES.workspace}`;
  if (!existsSync(workspace)) {
    writeState(ctx.out, "na", "no pnpm-workspace.yaml");
    return;
  }
  const yaml = readFileSync(workspace, "utf8");
  // Keys become registry URLs, so anything that is not an npm package name
  // is left out instead of quoted.
  const all = parseCatalog(yaml);
  const entries = [...all].filter(([name]) => NAME.test(name));
  if (all.size - entries.length > 0) {
    warning(
      `${all.size - entries.length} catalog entries are not npm package names and were skipped.`,
    );
  }
  if (entries.length === 0) {
    writeState(ctx.out, "na", "no catalog: in pnpm-workspace.yaml");
    return;
  }
  const packageJson = `${ctx.src}/${FILES.packageJson}`;
  const pm = existsSync(packageJson)
    ? (
        JSON.parse(readFileSync(packageJson, "utf8")) as {
          packageManager?: unknown;
        }
      ).packageManager
    : undefined;
  if (typeof pm !== "string" || !pm.startsWith("pnpm@")) {
    writeState(ctx.out, "na", "package.json has no pnpm packageManager");
    return;
  }
  const minutes = guard(parseYaml(yaml)[0], ctx.minAgeDays);
  if (minutes === null) {
    writeState(
      ctx.out,
      "na",
      `pnpm-workspace.yaml needs minimumReleaseAge of at least ${ctx.minAgeDays * 1440} and trustPolicy: no-downgrade`,
    );
    return;
  }
  // Direct updates wait as long as pnpm makes the transitive ones wait.
  const cutoff = Math.floor(Date.now() / 1000) - minutes * 60;
  const nvmrc = `${ctx.src}/${FILES.nvmrc}`;
  const major = nodeMajor(
    existsSync(nvmrc) ? readFileSync(nvmrc, "utf8") : null,
  );
  const log = await downloadPackuments(
    ctx.npm,
    entries.map(([name]) => name),
  );
  for (const line of log) {
    console.log(line);
  }
  const picks = pick(
    entries,
    (name) => readPackument(ctx.npm, name),
    cutoff,
    major,
    console.log,
  );
  writeFileSync(`${ctx.npm}/picks.json`, JSON.stringify(picks));
  if (picks.kept.length === 0) {
    writeState(ctx.out, "current", currentReason(picks));
    return;
  }
  appendRunnerFile("GITHUB_ENV", "RESOLVE=true\n");
};

export {
  guard,
  pick,
  currentReason,
  catalogTitle,
  renderLockfile,
  renderCatalog,
  readPicks,
  catalog,
};
export type { Picks };
