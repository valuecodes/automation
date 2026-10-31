import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Api } from "../lib/github.ts";
import { captureLog } from "../lib/capture-log.ts";
import { HttpError } from "../lib/http.ts";
import {
  build,
  content,
  footer,
  headline,
  publish,
  readSections,
  unchanged,
} from "./issue.ts";
import type { Section } from "./issue.ts";

const runs = "https://runs";

const section = (
  id: string,
  state: Section["status"] extends infer S
    ? S extends { state: infer T }
      ? T
      : never
    : never,
  text = "",
  details = "",
): Section => {
  const name =
    {
      "10-security": "Security",
      "15-supply-chain": "Supply chain",
      "20-catalog": "Dependencies",
      "30-pnpm": "pnpm",
      "50-node": "Node.js",
    }[id] ?? id;
  return {
    id,
    name,
    status: { state, text, details },
    markdown: "",
    rows: null,
    failed: state === "failed",
  };
};

test("headline names the worst state", () => {
  assert.equal(
    headline([
      section("10-security", "alert"),
      section("15-supply-chain", "alert"),
    ]),
    "🔴 Security alert, malicious package in lockfile",
  );
  assert.equal(
    headline([section("20-catalog", "failed"), section("30-pnpm", "failed")]),
    "❌ Dependencies, pnpm checks failed",
  );
  assert.equal(
    headline([section("50-node", "warn")]),
    "⚠️ Node.js needs attention",
  );
  assert.equal(
    headline([section("30-pnpm", "update"), section("50-node", "update")]),
    "⬆️ 2 updates",
  );
  assert.equal(headline([section("30-pnpm", "ok")]), "✅ all current");
});

test("build writes alerts, the table and the fragments, and cuts the rows", () => {
  const sections: Section[] = [
    section(
      "10-security",
      "alert",
      "2 vulnerabilities",
      "2 vulnerabilities (2 high)",
    ),
    {
      ...section("20-catalog", "update", "1 of 2 outdated", "1 of 2 outdated"),
      markdown: "### Deps\n\n| a |\n",
      rows: ["| r1 |", "| r2 |", "| r3 |"],
    },
    section(
      "50-node",
      "warn",
      "past end of life",
      "20.0.0 · end of life since 2026-04-30",
    ),
  ];
  const body = build(sections, runs, 1);
  assert.equal(
    body,
    [
      "> [!CAUTION]",
      "> 2 vulnerabilities (2 high) in `pnpm-lock.yaml`, see Security below.",
      "",
      "> [!WARNING]",
      "> Node.js: past end of life.",
      "",
      "| Check | Status | Details |",
      "| --- | --- | --- |",
      "| Security | 🔴 alert | 2 vulnerabilities (2 high) |",
      "| Dependencies | ⬆️ update | 1 of 2 outdated |",
      "| Node.js | ⚠️ attention | 20.0.0 · end of life since 2026-04-30 |",
      "",
      "### Deps",
      "",
      "| a |",
      "| r1 |",
      "| … 2 more, see [the latest run's summary](https://runs) |",
    ].join("\n"),
  );
  const { full, fitted } = content(sections, runs);
  assert.equal(full, fitted);
  assert.match(full, /\| r3 \|$/);
});

test("content cuts the catalog rows until the body fits", () => {
  const rows = Array.from(
    { length: 2000 },
    (_, i) => `| ${"x".repeat(60)} ${i} |`,
  );
  const sections: Section[] = [
    { ...section("20-catalog", "update"), markdown: "### Deps\n", rows },
  ];
  const { full, fitted } = content(sections, runs);
  assert.ok(full.length > 60_000);
  assert.ok(fitted.length <= 60_000);
  assert.match(fitted, /more, see \[the latest run's summary\]/);
});

test("readSections treats a missing section or status as a failed check", (t) => {
  const out = captureLog(t);
  const dir = mkdtempSync(join(tmpdir(), "sections-"));
  writeFileSync(join(dir, "10-security.md"), "**Security:** fine\n");
  writeFileSync(
    join(dir, "10-security.status"),
    "ok\tno known vulnerabilities\t\n",
  );
  writeFileSync(join(dir, "20-catalog.md"), "half written");
  // An empty fragment without a status is a disabled check, left out.
  writeFileSync(join(dir, "30-pnpm.md"), "");
  const sections = readSections(dir, runs);
  assert.deepEqual(
    sections.map((s) => [s.id, s.status?.state, s.failed]),
    [
      ["10-security", "ok", false],
      ["15-supply-chain", "failed", true],
      ["20-catalog", "failed", true],
      ["50-node", "failed", true],
    ],
  );
  assert.equal(
    sections[2]?.markdown,
    "**catalog:** check failed, see [the latest run](https://runs).\n",
  );
  assert.deepEqual(out, [
    "::error::The Supply chain check failed.",
    "::error::The Dependencies check failed.",
    "::error::The Node.js check failed.",
  ]);
});

test("footer and unchanged agree on the marker", () => {
  const body = footer("content", "2026-10-29", runs, "note");
  assert.match(
    body,
    /^content\n\n---\nLast changed: 2026-10-29 · \[Workflow runs\]\(https:\/\/runs\) · Source: /,
  );
  assert.match(body, /\nnote\n<!-- maintenance-dashboard:[0-9a-f]{64} -->\n$/);
  assert.equal(
    unchanged(
      { number: 1, title: "t", body: body.replaceAll("\n", "\r\n") },
      "t",
      "content",
      "note",
    ),
    true,
  );
  assert.equal(
    unchanged({ number: 1, title: "t", body }, "other", "content", "note"),
    false,
  );
  assert.equal(
    unchanged({ number: 1, title: "t", body }, "t", "edited", "note"),
    false,
  );
});

const fakeApi = (
  issues: {
    number: number;
    title: string;
    body: string;
    pull_request?: unknown;
  }[],
) => {
  const calls: string[] = [];
  const api: Api = <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    calls.push(`${method} ${path}`);
    if (method === "POST" && path.endsWith("/labels")) {
      return Promise.reject(new HttpError(path, 422, "exists"));
    }
    if (method === "GET" && path.includes("/issues?")) {
      return Promise.resolve(issues as T);
    }
    if (method === "GET") {
      return Promise.resolve(
        issues.find((i) => path.endsWith(`/${i.number}`)) as T,
      );
    }
    if (method === "POST") {
      return Promise.resolve({
        number: 9,
        html_url: "https://issue/9",
        ...(body as object),
      } as T);
    }
    return Promise.resolve(undefined as T);
  };
  return { api, calls };
};

test("publish creates, edits or leaves the issue", async (t) => {
  const out = captureLog(t);
  const body = footer("content", "2026-10-29", runs, "note");
  const logs: string[] = [];
  const log = (l: string): void => {
    logs.push(l);
  };
  const empty = fakeApi([]);
  await publish(empty.api, "o/r", "t", "content", body, "note", log);
  assert.deepEqual(empty.calls, [
    "POST repos/o/r/labels",
    "PATCH repos/o/r/labels/maintenance-dashboard",
    "GET repos/o/r/issues?labels=maintenance-dashboard&state=open&per_page=100",
    "POST repos/o/r/issues",
  ]);
  assert.deepEqual(logs, [
    "Created https://issue/9. Pin it in the repo's issue list.",
  ]);
  const same = fakeApi([
    { number: 7, title: "pr", body: "", pull_request: {} },
    { number: 5, title: "t", body },
    { number: 3, title: "t", body },
  ]);
  await publish(same.api, "o/r", "t", "content", body, "note", log);
  assert.equal(same.calls.at(-1), "GET repos/o/r/issues/3");
  assert.equal(logs.at(-1), "Issue #3 is unchanged.");
  assert.deepEqual(out, [
    "::warning::Several open issues carry the maintenance-dashboard label; editing #3 and leaving the rest.",
  ]);
  const stale = fakeApi([{ number: 3, title: "old", body }]);
  await publish(stale.api, "o/r", "t", "content", body, "note", log);
  assert.equal(stale.calls.at(-1), "PATCH repos/o/r/issues/3");
  assert.equal(logs.at(-1), "Updated issue #3.");
});
