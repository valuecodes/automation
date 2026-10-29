// gitleaks releases on GitHub, and the two lines a secrets script pins:
// `GITLEAKS_VERSION="x.y.z"` and, when it runs the container,
// `GITLEAKS_DIGEST="sha256:…"`.

import { compare, parse, stamp } from "./versions.ts";

const VERSION_LINE = /^GITLEAKS_VERSION="([0-9]+\.[0-9]+\.[0-9]+)"/m;
const DIGEST_LINE = /^GITLEAKS_DIGEST="(sha256:[0-9a-f]{64})"/m;

type Release = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
};

type Found = { version: string; date: string };

/**
 * The newest stable release after `current` published by `cutoff`. The
 * dashboard lists a new major too; the update workflow stays on the current
 * one with `sameMajor`.
 */
const newest = (
  releases: Release[],
  current: string,
  cutoff: number,
  options: { sameMajor: boolean } = { sameMajor: false },
): Found | null => {
  const cur = parse(current) ?? [0, 0, 0];
  let best: Found | null = null;
  for (const r of releases) {
    if (
      r.draft === true ||
      r.prerelease === true ||
      r.published_at === undefined
    ) {
      continue;
    }
    const tag = (r.tag_name ?? "").replace(/^v/, "");
    const v = parse(tag);
    if (v === null || compare(v, cur) <= 0 || stamp(r.published_at) > cutoff) {
      continue;
    }
    if (options.sameMajor && v[0] !== cur[0]) {
      continue;
    }
    if (best === null || compare(v, parse(best.version) ?? [0, 0, 0]) > 0) {
      best = { version: tag, date: r.published_at.slice(0, 10) };
    }
  }
  return best;
};

export { VERSION_LINE, DIGEST_LINE, newest };
export type { Release };
