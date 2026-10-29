// Update signals: what a packument says about an update candidate that hints
// at a hijacked account. The dashboard lists a flagged candidate, the update
// workflow leaves it out of its PR.

import { esc } from "./markdown.ts";
import { stamp } from "./versions.ts";
import type { Packument } from "./versions.ts";

const present = (value: unknown): boolean =>
  value !== undefined && value !== null;

/**
 * The signals of one update candidate, from its packument. Missing
 * provenance alone is not a signal: most of npm has none. Losing it, a
 * different publisher, a publisher who is not a maintainer, or a release
 * after a long silence is.
 */
const signals = (
  pack: Packument,
  current: string,
  target: string,
): string[] => {
  const versions = pack.versions ?? {};
  const time = pack.time ?? {};
  const t = versions[target];
  const c = versions[current];
  const released = time[target];
  if (t === undefined || released === undefined) {
    return [];
  }
  const tt = stamp(released);
  const who = (v: string): string | null => {
    const u = versions[v]?._npmUser;
    if (u === undefined) {
      return null;
    }
    if (u.trustedPublisher) {
      return `trusted publishing (${u.trustedPublisher.id ?? "?"})`;
    }
    return u.name ?? null;
  };
  let prev: number | null = null;
  for (const [key, value] of Object.entries(time)) {
    if (!/^[0-9]+\./.test(key) || typeof value !== "string") {
      continue;
    }
    const s = stamp(value);
    if (s < tt && (prev === null || s > prev)) {
      prev = s;
    }
  }
  const pub = who(target);
  const curPub = who(current);
  const maintainers = (pack.maintainers ?? []).map((m) => m.name);
  const found: string[] = [];
  if (present(c?.dist?.attestations) && !present(t.dist?.attestations)) {
    found.push("provenance dropped");
  }
  if (pub !== null && curPub !== null && pub !== curPub) {
    found.push(`new publisher ${esc(pub)}`);
  }
  if (
    pub !== null &&
    !present(t._npmUser?.trustedPublisher) &&
    !maintainers.includes(pub)
  ) {
    found.push(`publisher ${esc(pub)} is not a maintainer`);
  }
  if (prev !== null && tt - prev > 365 * 86_400) {
    found.push(
      `first release in ${Math.floor((tt - prev) / 2_629_800)} months`,
    );
  }
  return found;
};

/** The table row both workflows print for a flagged candidate. */
const signalRow = (
  name: string,
  current: string,
  target: string,
  found: string[],
): string =>
  `| \`${esc(name)}\` | ${current} → ${target} | ${found.join(", ")} |`;

export { signals, signalRow };
