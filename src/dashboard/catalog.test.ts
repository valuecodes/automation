import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeMajor, parseCatalog, render, tableRows } from "./catalog.ts";
import type { Row } from "./catalog.ts";

test("parseCatalog reads plain and quoted entries and stops at the block end", () => {
  const yaml = [
    "# header",
    "catalog:",
    "  '@types/node': 26.6.5",
    '  "oxfmt": "0.72.0" # pinned',
    "",
    "  typescript: ^7.0.2",
    "catalogMode: strict",
    "  not: here",
  ].join("\n");
  assert.deepEqual(
    [...parseCatalog(yaml)],
    [
      ["@types/node", "26.6.5"],
      ["oxfmt", "0.72.0"],
      ["typescript", "^7.0.2"],
    ],
  );
  assert.equal(parseCatalog("packages:\n  - apps/*\n").size, 0);
  assert.equal(parseCatalog("catalog: {}\n").size, 0);
  assert.throws(
    () => parseCatalog("catalog:\n  nested:\n    a: 1\n"),
    /Cannot read/,
  );
});

test("nodeMajor reads .nvmrc", () => {
  assert.equal(nodeMajor("v26.12.1\n"), 26);
  assert.equal(nodeMajor("lts/*"), null);
  assert.equal(nodeMajor(null), null);
});

const outdated: Row = {
  name: "a",
  current: "1.0.0",
  inMajor: "1.2.0",
  inMajorDate: "2026-01-02",
  major: null,
  majorDate: null,
};
const current: Row = {
  name: "b",
  current: "2.0.0",
  inMajor: null,
  inMajorDate: null,
  major: null,
  majorDate: null,
};
const unparsed: Row = { name: "c|d", current: "^3", unparsed: true };
const rows: Row[] = [outdated, current, unparsed];

test("tableRows leaves out the major column when no row fills it", () => {
  assert.deepEqual(tableRows(rows), [
    "| `a` | 1.0.0 | 1.2.0 | 2026-01-02 |",
    "| `c\\|d` | `^3` | not an exact version |  |",
  ]);
  const withMajor: Row[] = [
    {
      name: "a",
      current: "1.0.0",
      inMajor: null,
      inMajorDate: null,
      major: "2.0.0",
      majorDate: "2026-02-02",
    },
  ];
  assert.deepEqual(tableRows(withMajor), [
    "| `a` | 1.0.0 |  | ⚠️ 2.0.0 | 2026-02-02 |",
  ]);
});

test("render says up to date, or counts outdated and unparsed entries", () => {
  const ok = render([current], 14, null, false);
  assert.equal(ok.status.state, "ok");
  assert.equal(ok.status.details, "1 package");
  assert.equal(ok.rows, null);
  const out = render(rows, 14, 26, true);
  assert.deepEqual(out.status, {
    state: "update",
    text: "1 of 3 outdated",
    details: "1 of 3 outdated, 1 not an exact version",
  });
  assert.match(
    out.markdown,
    /1 of 3 packages have an update at least 14 days old\./,
  );
  assert.match(out.markdown, /1 entry is not an exact version/);
  assert.match(out.markdown, /capped at the `\.nvmrc` major \(26\)/);
  assert.match(
    out.markdown,
    /\| Package \| Current \| Latest in major \| Released \|\n/,
  );
  const warn = render([unparsed], 14, null, false);
  assert.equal(warn.status.state, "warn");
});
