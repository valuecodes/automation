// The environment a step gets from the workflow (`env:` on the job) and the
// work directories under `RUNNER_TEMP`, which the steps use to hand each
// other files, like the shell steps did.

class Fail extends Error {}

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) {
    throw new Fail(`${name} is not set.`);
  }
  return value;
};

type Dirs = {
  temp: string;
  src: string;
  sections: string;
  audit: string;
  npm: string;
  osv: string;
};

const dirs = (): Dirs => {
  const temp = env("RUNNER_TEMP");
  return {
    temp,
    src: `${temp}/src`,
    sections: `${temp}/sections`,
    audit: `${temp}/audit`,
    npm: `${temp}/npm`,
    osv: `${temp}/osv`,
  };
};

/** The inputs and repo facts both workflows' jobs get. */
type Common = {
  repo: string;
  /** Path of the caller's workflow file, from `github.workflow_ref`. */
  caller: string;
  runsUrl: string;
  minAgeDays: number;
  gitleaksScript: string;
  dryRun: boolean;
};

const common = (): Common => {
  const repo = env("REPO");
  const serverUrl = env("SERVER_URL");
  // `github.workflow_ref` is `owner/repo/.github/workflows/x.yml@ref`. The
  // body links the runs page, not a run, so an unchanged failure hashes the
  // same.
  let caller = env("WORKFLOW_REF").replace(/@[^@]*$/, "");
  if (caller.startsWith(`${repo}/`)) {
    caller = caller.slice(repo.length + 1);
  }
  const minAge = env("MIN_AGE_DAYS");
  if (!/^[0-9]+$/.test(minAge)) {
    throw new Fail(
      `min-release-age-days must be a whole number, got '${minAge}'.`,
    );
  }
  return {
    repo,
    caller,
    runsUrl: `${serverUrl}/${repo}/actions/workflows/${caller.replace(/^.*\//, "")}`,
    minAgeDays: Number(minAge),
    gitleaksScript: env("GITLEAKS_SCRIPT"),
    dryRun: env("DRY_RUN") === "true",
  };
};

type Context = {
  sha: string;
} & Common &
  Dirs;

/** The dashboard job's context: the common part plus the commit it reads. */
const context = (): Context => ({
  ...dirs(),
  ...common(),
  sha: env("SHA"),
});

export { Fail, env, common, context };
export type { Common, Context };
