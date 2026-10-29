// "Section: pnpm": the `packageManager` pin against the registry. The
// summary row holds all there is to say, so the fragment is empty.

import { existsSync, readFileSync } from "node:fs";
import { warning } from "../lib/actions.ts";
import { context } from "../lib/env.ts";
import { fetchJson } from "../lib/http.ts";
import { resolvable } from "../lib/npm.ts";
import { writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { dropVersion, newer } from "../lib/versions.ts";
import type { Newer, Packument } from "../lib/versions.ts";
import { FILES, readCutoff, requireSetup } from "./setup.ts";

const ID = "30-pnpm";

const status = (n: Newer, unserved: string[] = []): Status => {
  const note =
    unserved.length === 0
      ? ""
      : `; the full packument lists ${unserved.join(", ")} but pnpm cannot resolve it`;
  if (n.inMajor === null && n.major === null) {
    return unserved.length === 0
      ? { state: "ok", text: "up to date", details: n.current }
      : {
          state: "warn",
          text: `${unserved.length} not resolvable`,
          details: `${n.current}${note}`,
        };
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
    details: `${n.current} → ${target} (${date})${extra}${note}`,
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
  let picked = newer(pack, "pnpm", m[1] ?? "", readCutoff(ctx.src), null);
  // The full packument's word is not enough: the abbreviated one, which pnpm
  // resolves from, has to list each pick too, as in the catalog step.
  const targets = [picked.inMajor, picked.major].filter((v) => v !== null);
  const served = await Promise.all(targets.map((v) => resolvable("pnpm", v)));
  const unserved = targets.filter((_, i) => served[i] === false);
  for (const version of unserved) {
    warning(
      `The full packument lists pnpm ${version} but the abbreviated one pnpm resolves from does not; ignored.`,
    );
    picked = dropVersion(picked, version);
  }
  writeSection(ctx.sections, ID, "", status(picked, unserved));
};

export { status, pnpm };
