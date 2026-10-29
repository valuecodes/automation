import assert from "node:assert/strict";
import { test } from "node:test";
import { breakdown, render, table } from "./security.ts";
import type { Audit } from "./security.ts";

const audit: Audit = {
  advisories: {
    "1": {
      severity: "moderate",
      module_name: "zod",
      patched_versions: ">=3.22.3",
      github_advisory_id: "GHSA-m95q",
      url: "https://github.com/advisories/GHSA-m95q",
      findings: [{ version: "3.22.2", paths: [".>knip>zod", "apps__web>zod"] }],
    },
    "2": {
      severity: "high",
      module_name: "zod",
      patched_versions: ">=3.22.3",
      github_advisory_id: "GHSA-a1b2",
      url: "https://github.com/advisories/GHSA-a1b2",
      findings: [{ version: "3.22.2", paths: ["apps__web>zod", ".>knip>zod"] }],
    },
    "3": {
      severity: "critical",
      module_name: "sharp",
      patched_versions: null,
      id: 42,
      url: "https://example.test/42",
      findings: [
        { version: "0.1.0", paths: ["apps__playground>wrangler>sharp"] },
      ],
    },
  },
};

test("table groups advisories that one update clears and sorts by severity", () => {
  assert.deepEqual(table(audit), [
    "| 🟥 critical | `sharp` 0.1.0 | none | apps/playground: wrangler > sharp | [42](https://example.test/42) |",
    "| 🟧 high | `zod` 3.22.2 | >=3.22.3 | knip > zod (+1 more) | [GHSA-a1b2](https://github.com/advisories/GHSA-a1b2), [GHSA-m95q](https://github.com/advisories/GHSA-m95q) |",
  ]);
  assert.equal(breakdown(audit), "1 critical, 1 high, 1 moderate");
});

test("table links an advisory only when its id and URL fit a Markdown link", () => {
  const odd: Audit = {
    advisories: {
      "1": {
        severity: "low",
        module_name: "a",
        github_advisory_id: "GHSA-x",
        url: "javascript:alert(1)",
        findings: [{ version: "1.0.0", paths: [".>a"] }],
      },
      "2": {
        severity: "low",
        module_name: "b",
        github_advisory_id: "GHSA-y",
        url: "https://example.test/x)[evil](https://evil.test",
        findings: [{ version: "1.0.0", paths: [".>b"] }],
      },
      "3": {
        severity: "low",
        module_name: "c",
        github_advisory_id: "](https://evil.test)|",
        url: "https://github.com/advisories/GHSA-z",
        findings: [{ version: "1.0.0", paths: [".>c"] }],
      },
      "4": {
        severity: "low",
        module_name: "d",
        github_advisory_id: "GHSA-w",
        url: "https://example.test/x|y",
        findings: [{ version: "1.0.0", paths: [".>d"] }],
      },
    },
  };
  assert.deepEqual(table(odd), [
    "| ⬜ low | `a` 1.0.0 | none | a (direct) | GHSA-x |",
    "| ⬜ low | `b` 1.0.0 | none | b (direct) | GHSA-y |",
    "| ⬜ low | `c` 1.0.0 | none | c (direct) | ](https://evil.test)\\| |",
    "| ⬜ low | `d` 1.0.0 | none | d (direct) | GHSA-w |",
  ]);
});

test("render covers every audit status", () => {
  assert.deepEqual(render("skipped: no pnpm-lock.yaml", null, "u").status, {
    state: "na",
    text: "not applicable",
    details: "no pnpm-lock.yaml",
  });
  const failed = render(
    "failed: pnpm audit exited with 2",
    null,
    "https://runs",
  );
  assert.equal(failed.status.state, "failed");
  assert.equal(failed.failed, true);
  assert.match(
    failed.markdown,
    /\(pnpm audit exited with 2\), see \[the latest run\]\(https:\/\/runs\)/,
  );
  assert.equal(render("ok", { advisories: {} }, "u").status.state, "ok");
  const alert = render("ok", audit, "u");
  assert.deepEqual(alert.status, {
    state: "alert",
    text: "3 vulnerabilities",
    details: "3 vulnerabilities (1 critical, 1 high, 1 moderate)",
  });
  assert.match(alert.markdown, /^### Security \(pnpm audit\)\n\n\| Severity/);
  assert.throws(
    () => render("odd", null, "u"),
    /Unexpected audit status 'odd'/,
  );
});
