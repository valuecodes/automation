// "Section: pnpm": the `packageManager` pin against the registry. The
// summary row holds all there is to say, so the fragment is empty.

import { existsSync, readFileSync } from "node:fs";
import { context } from "../lib/env.ts";
import { fetchJson } from "../lib/http.ts";
import { writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { newer } from "../lib/versions.ts";
import type { Newer, Packument } from "../lib/versions.ts";
import { FILES, readCutoff, requireSetup } from "./setup.ts";

const ID = "30-pnpm";

const status = (n: Newer): Status => {
  if (n.inMajor === null && n.major === null) {
    return { state: "ok", text: "up to date", details: n.current };
  }
  const target = n.inMajor ?? n.major;
  const date = n.inMajorDate ?? n.majorDate;
  const extra =
    n.inMajor !== null && n.major !== null
      ? `, new major ${n.major} (${n.majorDate})`
      : "";
  return {
    state: "update",
    text: `${target} available`,
    details: `${n.current} → ${target} (${date})${extra}`,
  };
};

const pnpm = async (): Promise<void> => {
  const ctx = context();
  requireSetup(ctx.src);
  const file = `${ctx.src}/${FILES.packageJson}`;
  if (!existsSync(file)) {
    writeSection(
      ctx.sections,
      ID,
      "**pnpm:** not applicable, no `package.json`.\n",
      {
        state: "na",
        text: "not applicable",
        details: "no package.json",
      },
    );
    return;
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    packageManager?: unknown;
  };
  const pm =
    typeof parsed.packageManager === "string" ? parsed.packageManager : "";
  const m = /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)/.exec(pm);
  if (m === null) {
    writeSection(
      ctx.sections,
      ID,
      "**pnpm:** not applicable, `packageManager` in `package.json` does not pin pnpm.\n",
      {
        state: "na",
        text: "not applicable",
        details: "packageManager does not pin pnpm",
      },
    );
    return;
  }
  const pack = await fetchJson<Packument>("https://registry.npmjs.org/pnpm", {
    headers: { accept: "application/json" },
  });
  writeSection(
    ctx.sections,
    ID,
    "",
    status(newer(pack, "pnpm", m[1] ?? "", readCutoff(ctx.src), null)),
  );
};

export { pnpm };
