// Entry point of the update steps: `node src/updates/main.ts <step>`. One
// job per kind runs setup, that kind's pick, the lockfile resolve when the
// pick needs one, the osv.dev check and the PR step. A failed step prints
// `::error::` and exits 1, which ends its kind's job.

import { error as annotate } from "../lib/actions.ts";
import { Fail } from "../lib/env.ts";
import { catalog } from "./catalog.ts";
import { gitleaks } from "./gitleaks.ts";
import { node } from "./node.ts";
import { osv } from "./osv.ts";
import { pnpm } from "./pnpm.ts";
import { pr } from "./pr.ts";
import { resolve } from "./resolve.ts";
import { setup } from "./setup.ts";

const steps: Record<string, () => Promise<void>> = {
  setup: () => setup(),
  node,
  pnpm,
  gitleaks: () => gitleaks(),
  catalog,
  resolve,
  osv,
  pr: () => pr(),
};

const name = process.argv[2] ?? "";
const step = steps[name];
if (step === undefined) {
  annotate(`Unknown step '${name}'; one of: ${Object.keys(steps).join(", ")}.`);
  process.exit(2);
}
try {
  await step();
} catch (error) {
  if (error instanceof Fail) {
    annotate(error.message);
  } else {
    annotate(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  process.exit(1);
}
