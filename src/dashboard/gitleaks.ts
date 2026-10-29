// "Section: gitleaks": the `GITLEAKS_VERSION` pin in the secrets script
// against the GitHub releases. maintenance-updates.yml has a copy, limited
// to the current major; keep the two in step.

import { existsSync, readFileSync } from "node:fs";
import { Fail, context } from "../lib/env.ts";
import { api } from "../lib/github.ts";
import { writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { compare, parse, stamp } from "../lib/versions.ts";
import { FILES, readCutoff, requireSetup } from "./setup.ts";

const ID = "40-gitleaks";

type Release = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
};

/** The newest stable release after `current` published by `cutoff`. */
const newest = (
  releases: Release[],
  current: string,
  cutoff: number,
): { version: string; date: string } | null => {
  const cur = parse(current) ?? [0, 0, 0];
  let best: { version: string; date: string } | null = null;
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
    if (best === null || compare(v, parse(best.version) ?? [0, 0, 0]) > 0) {
      best = { version: tag, date: r.published_at.slice(0, 10) };
    }
  }
  return best;
};

const status = (
  current: string,
  update: { version: string; date: string } | null,
): Status => {
  if (update === null) {
    return { state: "ok", text: "up to date", details: current };
  }
  return {
    state: "update",
    text: `${update.version} available`,
    details: `${current} → ${update.version} (${update.date})`,
  };
};

const gitleaks = async (): Promise<void> => {
  const ctx = context();
  requireSetup(ctx.src);
  // Disabled: an empty fragment and no status, so the check has no row.
  if (ctx.gitleaksScript === "") {
    writeSection(ctx.sections, ID, "", null);
    return;
  }
  const file = `${ctx.src}/${FILES.gitleaksScript}`;
  if (!existsSync(file)) {
    writeSection(
      ctx.sections,
      ID,
      `**gitleaks:** not applicable, \`${ctx.gitleaksScript}\` is not in the repo.\n`,
      {
        state: "na",
        text: "not applicable",
        details: `${ctx.gitleaksScript} is not in the repo`,
      },
    );
    return;
  }
  const m = /^GITLEAKS_VERSION="([0-9]+\.[0-9]+\.[0-9]+)"/m.exec(
    readFileSync(file, "utf8"),
  );
  if (m === null) {
    throw new Fail(
      `${ctx.gitleaksScript} has no GITLEAKS_VERSION="x.y.z" line.`,
    );
  }
  const releases = await api<Release[]>(
    "GET",
    "repos/gitleaks/gitleaks/releases?per_page=100",
  );
  writeSection(
    ctx.sections,
    ID,
    "",
    status(m[1] ?? "", newest(releases, m[1] ?? "", readCutoff(ctx.src))),
  );
};

export { gitleaks };
