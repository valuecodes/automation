// "Node.js: find the update": the `.nvmrc` pin against the release index,
// the same rule as the dashboard's row, and the edited file.

import { existsSync, readFileSync } from "node:fs";
import { readCutoff } from "../lib/cutoff.ts";
import { Fail } from "../lib/env.ts";
import { fetchJson } from "../lib/http.ts";
import { lifecycle, update, validSchedule } from "../lib/nodejs.ts";
import type { IndexEntry, Update } from "../lib/nodejs.ts";
import { parse } from "../lib/versions.ts";
import { updateContext } from "./context.ts";
import {
  addFile,
  replaceOnce,
  writeContent,
  writeState,
  writeTitle,
} from "./outcome.ts";
import { FILES } from "./setup.ts";

const edit = (nvmrc: string, current: string, version: string): string =>
  replaceOnce(nvmrc, current, version, ".nvmrc");

type Rendered = { title: string; content: string[] };

const render = (current: string, found: Update, life: string): Rendered => {
  const major = current.split(".")[0] ?? "";
  // The warning above the table is the one place that names a security
  // release, so the row keeps the same columns as the other kinds.
  const content = found.security
    ? ["> [!WARNING]", "> This update includes a Node.js security release.", ""]
    : [];
  content.push(
    "| Package | Current | Update | Released | Support |",
    "| --- | --- | --- | --- | --- |",
    `| Node.js | ${current} | ${found.version} | ${found.date} | ${life} |`,
    "",
    `Release notes: [v${found.version}](https://github.com/nodejs/node/releases/tag/v${found.version}) · [every v${major} release](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V${major}.md).`,
    "Also update any Node.js pin outside the repo, such as a hosting build variable.",
  );
  return { title: `Update Node.js to ${found.version}`, content };
};

const node = async (): Promise<void> => {
  const ctx = updateContext();
  const file = `${ctx.src}/${FILES.nvmrc}`;
  if (!existsSync(file)) {
    writeState(ctx.out, "na", "no .nvmrc");
    return;
  }
  const nvmrc = readFileSync(file, "utf8");
  const current = nvmrc.replaceAll(/\s/g, "").replace(/^v/, "");
  if (parse(current) === null) {
    throw new Fail(
      `.nvmrc must hold an exact version such as 24.22.1, found '${current}'.`,
    );
  }
  const index = await fetchJson<IndexEntry[]>(
    "https://nodejs.org/dist/index.json",
  );
  const found = update(index, current, readCutoff(ctx.src));
  if (found === null) {
    writeState(ctx.out, "current", `Node.js ${current} is up to date`);
    return;
  }
  // The schedule's dates land in the PR body, so an entry whose dates are
  // not plain dates counts as missing.
  const schedule = validSchedule(
    await fetchJson<Record<string, unknown>>(
      "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json",
    ),
  );
  const today = new Date().toISOString().slice(0, 10);
  const life = lifecycle(schedule, Number(current.split(".")[0]), today);
  addFile(ctx.out, ".nvmrc", nvmrc, edit(nvmrc, current, found.version));
  const rendered = render(current, found, life.text);
  writeTitle(ctx.out, rendered.title);
  writeContent(ctx.out, rendered.content);
  writeState(ctx.out, "update");
};

export { edit, render, node };
