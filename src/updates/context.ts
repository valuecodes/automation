// The update job's environment: the common inputs, the kind this job runs
// (one job per kind), and the work directories under `RUNNER_TEMP`. The
// setup step saves what it resolved in `$OUT/setup.json` for the steps after.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Fail, common, env } from "../lib/env.ts";
import type { Common } from "../lib/env.ts";

const KINDS = ["node", "pnpm", "gitleaks", "catalog"] as const;
type Kind = (typeof KINDS)[number];

const isKind = (value: string): value is Kind =>
  (KINDS as readonly string[]).includes(value);

type Dirs = {
  temp: string;
  /** The repo files read in the setup step. */
  src: string;
  /** The update: state, title, content and the old and new files. */
  out: string;
  npm: string;
};

type UpdateContext = {
  kind: Kind;
  ciWorkflow: string;
} & Common &
  Dirs;

const updateContext = (): UpdateContext => {
  const kind = env("KIND");
  if (!isKind(kind)) {
    throw new Fail(`Unknown kind '${kind}'; one of: ${KINDS.join(", ")}.`);
  }
  const temp = env("RUNNER_TEMP");
  return {
    ...common(),
    kind,
    ciWorkflow: env("CI_WORKFLOW"),
    temp,
    src: `${temp}/src`,
    out: `${temp}/update`,
    npm: `${temp}/npm`,
  };
};

/**
 * The script path lands in an API URL and in local paths, so it must be a
 * plain relative path. Returns what is wrong with it, or null.
 */
const validateGitleaksScript = (path: string): string | null => {
  if (path === "") {
    return null;
  }
  if (
    !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    return `gitleaks-script must be a relative path such as .github/scripts/secrets-scan.sh, got '${path}'.`;
  }
  return null;
};

const validateCiWorkflow = (file: string): string | null =>
  file === "" || /^[A-Za-z0-9._-]+\.ya?ml$/.test(file)
    ? null
    : `ci-workflow must be a workflow file name such as ci.yml, got '${file}'.`;

/** What the setup step resolved: the base branch, its head, the dashboard. */
type Meta = {
  base: string;
  baseSha: string;
  dashboard: number | null;
};

const writeMeta = (out: string, meta: Meta): void => {
  writeFileSync(`${out}/setup.json`, JSON.stringify(meta));
};

const readMeta = (out: string): Meta => {
  const file = `${out}/setup.json`;
  if (!existsSync(file)) {
    throw new Fail("The setup step wrote no result; see the step before.");
  }
  return JSON.parse(readFileSync(file, "utf8")) as Meta;
};

export {
  updateContext,
  validateGitleaksScript,
  validateCiWorkflow,
  writeMeta,
  readMeta,
};
export type { Kind, UpdateContext, Meta };
