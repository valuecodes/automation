// "Section: Node.js": the `.nvmrc` pin against the release index, and where
// its major is in the release schedule. The summary row is the only place
// Node.js is shown, so the fragment is empty.

import { existsSync, readFileSync } from "node:fs";
import { readCutoff } from "../lib/cutoff.ts";
import { Fail, context } from "../lib/env.ts";
import { fetchJson } from "../lib/http.ts";
import { lifecycle, update } from "../lib/nodejs.ts";
import type { IndexEntry, Lifecycle, Schedule, Update } from "../lib/nodejs.ts";
import { writeSection } from "../lib/sections.ts";
import type { State, Status } from "../lib/sections.ts";
import { parse } from "../lib/versions.ts";
import { FILES, requireSetup } from "./setup.ts";

const ID = "50-node";

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

export { status, node };
