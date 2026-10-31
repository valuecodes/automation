// "Read the repo files at this commit": the files every section reads, the
// release-age cutoff, and the `.ok` marker the sections require.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { writeCutoff } from "../lib/cutoff.ts";
import { Fail, context } from "../lib/env.ts";
import { repoFile } from "../lib/github.ts";

const FILES = {
  workspace: "pnpm-workspace.yaml",
  packageJson: "package.json",
  nvmrc: ".nvmrc",
} as const;

const setup = async (): Promise<void> => {
  const ctx = context();
  mkdirSync(ctx.src, { recursive: true });
  mkdirSync(ctx.sections, { recursive: true });
  writeCutoff(ctx.src, ctx.minAgeDays);

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
  writeFileSync(`${ctx.src}/.ok`, "");
};

/** The sections refuse to run on a failed setup. */
const requireSetup = (src: string): void => {
  if (!existsSync(`${src}/.ok`)) {
    throw new Fail("The repo files were not read; see the step before.");
  }
};

export { FILES, setup, requireSetup };
