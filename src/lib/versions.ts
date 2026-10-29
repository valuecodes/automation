// Exact semantic versions, and the one question every version check asks:
// which newer stable, old-enough release exists on the current major and on
// a higher one. maintenance-updates.yml has a copy of this rule in jq; keep
// the two in step.

const EXACT = /^[0-9]+\.[0-9]+\.[0-9]+$/;

type Version = [number, number, number];

const parse = (text: string): Version | null => {
  if (!EXACT.test(text)) {
    return null;
  }
  const [a, b, c] = text.split(".").map(Number);
  return [a ?? 0, b ?? 0, c ?? 0];
};

const compare = (a: Version, b: Version): number => {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
};

/** Seconds since the epoch of an ISO timestamp, with or without fractions. */
const stamp = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

type PackumentVersion = {
  deprecated?: unknown;
  dist?: { attestations?: unknown };
  _npmUser?: { name?: string; trustedPublisher?: { id?: string } };
};

type Packument = {
  versions?: Record<string, PackumentVersion>;
  time?: Record<string, string>;
  maintainers?: { name?: string }[];
};

type Newer = {
  name: string;
  current: string;
  inMajor: string | null;
  inMajorDate: string | null;
  major: string | null;
  majorDate: string | null;
};

/**
 * From a packument: the newest stable, non-deprecated version released by
 * `cutoff` (seconds) on the current major and on a higher one, the latter
 * capped by `maxMajor` when given.
 */
const newer = (
  pack: Packument,
  name: string,
  current: string,
  cutoff: number,
  maxMajor: number | null,
): Newer => {
  const cur = parse(current) ?? [0, 0, 0];
  const time = pack.time ?? {};
  const candidates: Version[] = [];
  for (const [key, value] of Object.entries(pack.versions ?? {})) {
    const v = parse(key);
    if (v === null || Boolean(value.deprecated)) {
      continue;
    }
    if (compare(v, cur) <= 0 || v[0] > (maxMajor ?? v[0])) {
      continue;
    }
    const released = time[key];
    if (released === undefined || stamp(released) > cutoff) {
      continue;
    }
    candidates.push(v);
  }
  const best = (keep: (v: Version) => boolean): string | null => {
    let top: Version | null = null;
    for (const v of candidates) {
      if (keep(v) && (top === null || compare(v, top) > 0)) {
        top = v;
      }
    }
    return top === null ? null : top.join(".");
  };
  const inMajor = best((v) => v[0] === cur[0]);
  const major = best((v) => v[0] > cur[0]);
  return {
    name,
    current,
    inMajor,
    inMajorDate: inMajor === null ? null : (time[inMajor] ?? "").slice(0, 10),
    major,
    majorDate: major === null ? null : (time[major] ?? "").slice(0, 10),
  };
};

export { EXACT, parse, compare, stamp, newer };
export type { Version, Packument, Newer };
