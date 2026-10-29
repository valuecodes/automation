// Node.js releases: the newest release on the current major from the release
// index, and where a major is in the release schedule. The dashboard's row
// and the update PR both come from here.

import { compare, parse, stamp } from "./versions.ts";
import type { Version } from "./versions.ts";

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
 * still flagged.
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

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value);

/**
 * The schedule with only the entries whose dates are plain dates: they are
 * compared as strings and land in Markdown, so anything else counts as
 * missing.
 */
const validSchedule = (schedule: Record<string, unknown>): Schedule => {
  const out: Schedule = {};
  for (const [key, value] of Object.entries(schedule)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    const fields = ["start", "lts", "maintenance", "end"] as const;
    if (!fields.every((f) => entry[f] === undefined || isDate(entry[f]))) {
      continue;
    }
    const clean: ScheduleEntry = {};
    for (const f of fields) {
      const v = entry[f];
      if (isDate(v)) {
        clean[f] = v;
      }
    }
    out[key] = clean;
  }
  return out;
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

export { update, validSchedule, lifecycle };
export type { IndexEntry, Update, Schedule, Lifecycle };
