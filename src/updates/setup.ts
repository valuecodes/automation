// "Read the repo files on the default branch": the inputs checked, the base
// commit resolved, the kind's files fetched and the cutoff written. Every
// kind reads one commit of the default branch, and the update commit is
// built on that same commit, whatever ref the caller ran on.

import { mkdirSync, writeFileSync } from "node:fs";
import { appendRunnerFile } from "../lib/actions.ts";
import { writeCutoff } from "../lib/cutoff.ts";
import { Fail } from "../lib/env.ts";
import { api as githubApi, repoFile } from "../lib/github.ts";
import type { Api } from "../lib/github.ts";
import {
  updateContext,
  validateCiWorkflow,
  validateGitleaksScript,
  writeMeta,
} from "./context.ts";
import type { Kind } from "./context.ts";

const FILES = {
  workspace: "pnpm-workspace.yaml",
  packageJson: "package.json",
  nvmrc: ".nvmrc",
  gitleaksScript: "gitleaks-script",
} as const;

/** The repo files a kind reads, as `[path in the repo, name under $SRC]`. */
const filesFor = (kind: Kind, gitleaksScript: string): [string, string][] => {
  const files: Record<Kind, [string, string][]> = {
    node: [[".nvmrc", FILES.nvmrc]],
    pnpm: [["package.json", FILES.packageJson]],
    gitleaks:
      gitleaksScript === "" ? [] : [[gitleaksScript, FILES.gitleaksScript]],
    catalog: [
      ["pnpm-workspace.yaml", FILES.workspace],
      ["package.json", FILES.packageJson],
      [".nvmrc", FILES.nvmrc],
    ],
  };
  return files[kind];
};

type Issue = { number: number; pull_request?: unknown };

const setup = async (api: Api = githubApi): Promise<void> => {
  const ctx = updateContext();
  mkdirSync(ctx.src, { recursive: true });
  mkdirSync(ctx.out, { recursive: true });
  for (const check of [
    validateGitleaksScript(ctx.gitleaksScript),
    validateCiWorkflow(ctx.ciWorkflow),
  ]) {
    if (check !== null) {
      throw new Fail(check);
    }
  }
  const { default_branch: base } = await api<{ default_branch: string }>(
    "GET",
    `repos/${ctx.repo}`,
  );
  const ref = await api<{ object?: { sha?: string } }>(
    "GET",
    `repos/${ctx.repo}/git/ref/heads/${base}`,
  );
  const baseSha = ref.object?.sha ?? "";
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Fail(`Could not resolve the head of ${base}.`);
  }
  // The pinned dashboard issue, linked from each PR body when there is one.
  // The link is optional, so a repo with issues turned off still runs.
  let dashboard: number | null = null;
  try {
    const issues = await api<Issue[]>(
      "GET",
      `repos/${ctx.repo}/issues?labels=maintenance-dashboard&state=open&per_page=100`,
    );
    const numbers = issues
      .filter((i) => i.pull_request === undefined)
      .map((i) => i.number);
    dashboard = numbers.length === 0 ? null : Math.min(...numbers);
  } catch {
    dashboard = null;
  }
  writeMeta(ctx.out, { base, baseSha, dashboard });
  appendRunnerFile("GITHUB_OUTPUT", `base-sha=${baseSha}\n`);
  // The caller's own Node.js may replace this one on PATH later in the job
  // (the lockfile setup), so the steps after that run with this one, which
  // strips types.
  appendRunnerFile("GITHUB_ENV", `AUTOMATION_NODE=${process.execPath}\n`);
  writeCutoff(ctx.src, ctx.minAgeDays);

  // As in the dashboard: a missing file makes its kind "not applicable".
  for (const [path, dest] of filesFor(ctx.kind, ctx.gitleaksScript)) {
    const bytes = await repoFile(ctx.repo, path, baseSha);
    if (bytes === null) {
      console.log(`${path} is not in the repo.`);
      continue;
    }
    writeFileSync(`${ctx.src}/${dest}`, bytes);
  }
};

export { FILES, filesFor, setup };
