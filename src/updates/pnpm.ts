// "pnpm: find the update": the `packageManager` pin against the registry,
// held back by update signals, with the `+sha512` hash moved along.

import { existsSync, readFileSync } from "node:fs";
import { appendRunnerFile } from "../lib/actions.ts";
import { readCutoff } from "../lib/cutoff.ts";
import { Fail } from "../lib/env.ts";
import { fetchJson } from "../lib/http.ts";
import { signals } from "../lib/signals.ts";
import { newer } from "../lib/versions.ts";
import type { Packument } from "../lib/versions.ts";
import { updateContext } from "./context.ts";
import {
  addFile,
  appendQueries,
  replaceOnce,
  writeContent,
  writeState,
  writeTitle,
} from "./outcome.ts";
import { FILES } from "./setup.ts";

type PackageManager = { pm: string; version: string; hashed: boolean };

/** The pnpm pin of a `package.json`, or null when it does not pin pnpm. */
const parsePackageManager = (json: string): PackageManager | null => {
  const parsed = JSON.parse(json) as { packageManager?: unknown };
  const pm =
    typeof parsed.packageManager === "string" ? parsed.packageManager : "";
  const m = /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)(\+.+)?$/.exec(pm);
  if (m === null) {
    return null;
  }
  return { pm, version: m[1] ?? "", hashed: m[2] !== undefined };
};

/**
 * Corepack checks the tarball against the hash in `packageManager`, so a
 * pinned hash moves with the version. It is the registry's sha512
 * integrity, in hex.
 */
const integrityHex = (pack: Packument, version: string): string | null => {
  const integrity = pack.versions?.[version]?.dist?.integrity ?? "";
  if (!integrity.startsWith("sha512-")) {
    return null;
  }
  const hex = Buffer.from(integrity.slice("sha512-".length), "base64").toString(
    "hex",
  );
  return /^[0-9a-f]{128}$/.test(hex) ? hex : null;
};

const edit = (json: string, pm: string, newPm: string): string =>
  replaceOnce(json, `"${pm}"`, `"${newPm}"`, "package.json");

type Rendered = { title: string; content: string[] };

const render = (
  current: string,
  version: string,
  date: string,
  hashed: boolean,
): Rendered => {
  const content = [
    "| Package | Current | Update | Released |",
    "| --- | --- | --- | --- |",
    `| pnpm | ${current} | ${version} | ${date} |`,
    "",
    `Release notes: [v${version}](https://github.com/pnpm/pnpm/releases/tag/v${version}).`,
  ];
  if (hashed) {
    content.push(
      `The \`packageManager\` hash is the npm registry's sha512 integrity for pnpm ${version}.`,
    );
  }
  return { title: `Update pnpm to ${version}`, content };
};

const pnpm = async (): Promise<void> => {
  const ctx = updateContext();
  const file = `${ctx.src}/${FILES.packageJson}`;
  if (!existsSync(file)) {
    writeState(ctx.out, "na", "no package.json");
    return;
  }
  const json = readFileSync(file, "utf8");
  const pin = parsePackageManager(json);
  if (pin === null) {
    writeState(ctx.out, "na", "packageManager does not pin pnpm");
    return;
  }
  const pack = await fetchJson<Packument>("https://registry.npmjs.org/pnpm", {
    headers: { accept: "application/json" },
  });
  const found = newer(pack, "pnpm", pin.version, readCutoff(ctx.src), null);
  if (found.inMajor === null) {
    const major =
      found.major === null
        ? ""
        : ` on its major (pnpm ${found.major} stays on the dashboard)`;
    writeState(ctx.out, "current", `pnpm ${pin.version} is up to date${major}`);
    return;
  }
  const version = found.inMajor;
  if (signals(pack, pin.version, version).length > 0) {
    writeState(
      ctx.out,
      "current",
      `pnpm ${version} is held back by update signals, see the dashboard`,
    );
    return;
  }
  let newPm = `pnpm@${version}`;
  if (pin.hashed) {
    const hex = integrityHex(pack, version);
    if (hex === null) {
      throw new Fail(
        `The npm registry has no sha512 integrity for pnpm ${version}.`,
      );
    }
    newPm = `${newPm}+sha512.${hex}`;
  }
  addFile(ctx.out, "package.json", json, edit(json, pin.pm, newPm));
  appendQueries(ctx.out, [{ name: "pnpm", version }]);
  appendRunnerFile("GITHUB_ENV", "RESOLVE=true\n");
  const rendered = render(
    pin.version,
    version,
    found.inMajorDate ?? "",
    pin.hashed,
  );
  writeTitle(ctx.out, rendered.title);
  writeContent(ctx.out, rendered.content);
  writeState(ctx.out, "update");
};

export { parsePackageManager, integrityHex, edit, render, pnpm };
