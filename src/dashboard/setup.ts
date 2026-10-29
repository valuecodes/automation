// "Read the repo files at this commit": the files every section reads, the
// release-age cutoff, and the `.ok` marker the sections require.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Fail, context } from "../lib/env.ts";
import { repoFile } from "../lib/github.ts";

const FILES = {
  workspace: "pnpm-workspace.yaml",
  packageJson: "package.json",
  nvmrc: ".nvmrc",
  gitleaksScript: "gitleaks-script",
} as const;

const setup = async (): Promise<void> => {
  const ctx = context();
  mkdirSync(ctx.src, { recursive: true });
  mkdirSync(ctx.sections, { recursive: true });
  const cutoff = Math.floor(Date.now() / 1000) - ctx.minAgeDays * 86_400;
  writeFileSync(`${ctx.src}/cutoff`, `${cutoff}\n`);

  // A missing file makes its check "not applicable"; other errors fail.
  const fetchInto = async (path: string, dest: string): Promise<void> => {
    const bytes = await repoFile(ctx.repo, path, ctx.sha);
    if (bytes === null) {
      console.log(`${path} is not in the repo.`);
      return;
    }
    writeFileSync(`${ctx.src}/${dest}`, bytes);
  };
  await fetchInto("pnpm-workspace.yaml", FILES.workspace);
  await fetchInto("package.json", FILES.packageJson);
  await fetchInto(".nvmrc", FILES.nvmrc);
  if (ctx.gitleaksScript !== "") {
    await fetchInto(ctx.gitleaksScript, FILES.gitleaksScript);
  }
  writeFileSync(`${ctx.src}/.ok`, "");
};

/** The sections refuse to run on a failed setup. */
const requireSetup = (src: string): void => {
  if (!existsSync(`${src}/.ok`)) {
    throw new Fail("The repo files were not read; see the step before.");
  }
};

const readCutoff = (src: string): number => {
  const text = readFileSync(`${src}/cutoff`, "utf8").trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new Fail("The cutoff from the setup step is not a number.");
  }
  return Number(text);
};

export { FILES, setup, requireSetup, readCutoff };
