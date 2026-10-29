// "Section: gitleaks": the `GITLEAKS_VERSION` pin in the secrets script
// against the GitHub releases, a new major included.

import { existsSync, readFileSync } from "node:fs";
import { readCutoff } from "../lib/cutoff.ts";
import { Fail, context } from "../lib/env.ts";
import { VERSION_LINE, newest } from "../lib/gitleaks.ts";
import type { Release } from "../lib/gitleaks.ts";
import { api } from "../lib/github.ts";
import { writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { FILES, requireSetup } from "./setup.ts";

const ID = "40-gitleaks";

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
  const m = VERSION_LINE.exec(readFileSync(file, "utf8"));
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
