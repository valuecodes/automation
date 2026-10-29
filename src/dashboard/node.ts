// "Section: Node.js": the `.nvmrc` pin against the release index, and where
// its major is in the release schedule. The summary row is the only place
// Node.js is shown, so the fragment is empty.

import { existsSync, readFileSync } from "node:fs";
import { Fail, context } from "../lib/env.ts";
import { fetchJson } from "../lib/http.ts";
import { writeSection } from "../lib/sections.ts";
import type { State, Status } from "../lib/sections.ts";
import { compare, parse, stamp } from "../lib/versions.ts";
import type { Version } from "../lib/versions.ts";
import { FILES, readCutoff, requireSetup } from "./setup.ts";

const ID = "50-node";

type IndexEntry = {
  version?: string;
  date?: string;
  security?: boolean;
};

type Update = {
  version: string;
  date: string;
  security: boolean;
};

/**
 * The newest release on the current major. Security releases count right
 * away; the rest wait like other releases. The flag covers every release up
 * to the target, so a security release followed by a newer regular one is
 * still flagged. maintenance-updates.yml has a copy; keep the two in step.
 */
const update = (
  index: IndexEntry[],
  current: string,
  cutoff: number,
): Update | null => {
  const cur = parse(current) ?? [0, 0, 0];
  const newer: { v: Version; entry: IndexEntry }[] = [];
  for (const entry of index) {
    const v = parse((entry.version ?? "").replace(/^v/, ""));
    if (v !== null && v[0] === cur[0] && compare(v, cur) > 0) {
      newer.push({ v, entry });
    }
  }
  let target: { v: Version; entry: IndexEntry } | null = null;
  for (const n of newer) {
    const due =
      n.entry.security === true || stamp(`${n.entry.date}T00:00:00Z`) <= cutoff;
    if (due && (target === null || compare(n.v, target.v) > 0)) {
      target = n;
    }
  }
  if (target === null) {
    return null;
  }
  const tv = target.v;
  return {
    version: tv.join("."),
    date: target.entry.date ?? "",
    security: newer.some(
      (n) => compare(n.v, tv) <= 0 && n.entry.security === true,
    ),
  };
};

type ScheduleEntry = {
  start?: string;
  lts?: string;
  maintenance?: string;
  end?: string;
};

type Schedule = Record<string, ScheduleEntry>;

type Lifecycle = {
  phase: "unknown" | "eol" | "supported";
  text: string;
};

/** Where the major is in its lifecycle, and a newer LTS major if any. */
const lifecycle = (
  schedule: Schedule,
  major: number,
  today: string,
): Lifecycle => {
  const phase = (s: ScheduleEntry): string => {
    if (s.end !== undefined && today >= s.end) {
      return "past end of life";
    }
    if (s.maintenance !== undefined && today >= s.maintenance) {
      return "in maintenance";
    }
    if (s.lts !== undefined && today >= s.lts) {
      return "Active LTS";
    }
    return "Current";
  };
  const s = schedule[`v${major}`];
  let lts: { major: number; entry: ScheduleEntry } | null = null;
  for (const [key, entry] of Object.entries(schedule)) {
    const m = /^v([0-9]+)$/.exec(key);
    if (
      m === null ||
      entry.lts === undefined ||
      entry.lts > today ||
      entry.end === undefined ||
      today >= entry.end
    ) {
      continue;
    }
    const n = Number(m[1]);
    if (lts === null || n > lts.major) {
      lts = { major: n, entry };
    }
  }
  if (s === undefined) {
    return {
      phase: "unknown",
      text: `Node.js ${major} is not in the release schedule`,
    };
  }
  const eol = s.end !== undefined && today >= s.end;
  let text = eol
    ? `end of life since ${s.end}`
    : `${phase(s)}, end of life ${s.end}`;
  if (lts !== null && lts.major > major) {
    text += ` · Node.js ${lts.major} is ${phase(lts.entry)}`;
  }
  return { phase: eol ? "eol" : "supported", text };
};

const status = (
  current: string,
  found: Update | null,
  life: Lifecycle,
): Status => {
  let state: State = "ok";
  let summary = "up to date";
  let details = current;
  if (found !== null) {
    state = "update";
    summary = `${found.version} available`;
    details = `${current} → ${found.version} (${found.date})`;
    if (found.security) {
      state = "warn";
      summary = `${found.version} available, includes a security release`;
      details += ", security release";
    }
  }
  if (life.phase === "eol") {
    summary =
      state === "warn" ? `past end of life, ${summary}` : "past end of life";
    state = "warn";
  }
  return { state, text: summary, details: `${details} · ${life.text}` };
};

const node = async (): Promise<void> => {
  const ctx = context();
  requireSetup(ctx.src);
  const file = `${ctx.src}/${FILES.nvmrc}`;
  if (!existsSync(file)) {
    writeSection(
      ctx.sections,
      ID,
      "**Node.js:** not applicable, no `.nvmrc`.\n",
      {
        state: "na",
        text: "not applicable",
        details: "no .nvmrc",
      },
    );
    return;
  }
  const current = readFileSync(file, "utf8")
    .replaceAll(/\s/g, "")
    .replace(/^v/, "");
  if (parse(current) === null) {
    throw new Fail(
      `.nvmrc must hold an exact version such as 24.22.1, found '${current}'.`,
    );
  }
  const index = await fetchJson<IndexEntry[]>(
    "https://nodejs.org/dist/index.json",
  );
  const found = update(index, current, readCutoff(ctx.src));
  const schedule = await fetchJson<Schedule>(
    "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json",
  );
  const today = new Date().toISOString().slice(0, 10);
  const life = lifecycle(schedule, Number(current.split(".")[0]), today);
  writeSection(ctx.sections, ID, "", status(current, found, life));
};

export { update, lifecycle, status, node };
