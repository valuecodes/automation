// For tests that exercise a failure path. The `::error::` and `::warning::`
// lines it prints would otherwise reach the CI log, where the runner turns
// them into real annotations on the test job.

import type { TestContext } from "node:test";

/** Swaps console.log for the rest of the test and returns what it printed. */
const captureLog = (t: TestContext): string[] => {
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => {
    lines.push(line);
  });
  return lines;
};

export { captureLog };
