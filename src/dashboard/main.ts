// Entry point of the dashboard steps: `node src/dashboard/main.ts <step>`.
// The workflow runs one step per section with `continue-on-error`, so a
// failed step prints `::error::` and exits 1 while the others still run.

import { error as annotate } from "../lib/actions.ts";
import { Fail } from "../lib/env.ts";
import { catalog } from "./catalog.ts";
import { gitleaks } from "./gitleaks.ts";
import { issue } from "./issue.ts";
import { node } from "./node.ts";
import { pnpm } from "./pnpm.ts";
import { security } from "./security.ts";
import { setup } from "./setup.ts";
import { supplyChain } from "./supply-chain.ts";

const steps: Record<string, () => Promise<void> | void> = {
  setup,
  security,
  catalog,
  "supply-chain": supplyChain,
  pnpm,
  gitleaks,
  node,
  issue: () => issue(),
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
