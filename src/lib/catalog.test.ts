import assert from "node:assert/strict";
import { test } from "node:test";
import { editCatalog, nodeMajor, parseCatalog, parseSpec } from "./catalog.ts";

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

test("parseSpec splits the prefix from an exact version", () => {
  assert.deepEqual(parseSpec("^26.6.5"), { prefix: "^", current: "26.6.5" });
  assert.deepEqual(parseSpec("~1.2.3"), { prefix: "~", current: "1.2.3" });
  assert.deepEqual(parseSpec("1.2.3"), { prefix: "", current: "1.2.3" });
  assert.equal(parseSpec(">=1.2.3"), null);
  assert.equal(parseSpec("1.2"), null);
  assert.equal(parseSpec("2^6.6.5"), null);
});

const workspace = [
  "# Versions",
  "catalog:",
  '  "@types/node": ^26.6.5',
  "  knip: 6.41.0 # tool",
  "",
  "  oxfmt: '0.72.0'",
  "",
  "catalogMode: strict",
  "other:",
  "  knip: 6.41.0",
].join("\n");

test("editCatalog changes only the version and keeps the rest of the line", () => {
  const edited = editCatalog(
    workspace,
    new Map([
      ["@types/node", { current: "26.6.5", target: "26.12.1" }],
      ["knip", { current: "6.41.0", target: "6.42.0" }],
    ]),
  );
  assert.equal(
    edited,
    workspace
      .replace('"@types/node": ^26.6.5', '"@types/node": ^26.12.1')
      .replace("  knip: 6.41.0 # tool", "  knip: 6.42.0 # tool"),
  );
  assert.equal(editCatalog(workspace, new Map()), workspace);
});

test("editCatalog rejects a version that is only part of the line's value", () => {
  // `6.6.5` is inside `26.6.5`; replacing it there once produced `26.14.13`.
  assert.throws(
    () =>
      editCatalog(
        workspace,
        new Map([["@types/node", { current: "6.6.5", target: "6.14.13" }]]),
      ),
    /@types\/node: the catalog line holds 26\.6\.5, not 6\.6\.5/,
  );
  assert.throws(
    () =>
      editCatalog(
        workspace,
        new Map([["oxfmt", { current: "0.71.0", target: "0.72.0" }]]),
      ),
    /oxfmt: 0\.71\.0 is not on its catalog line/,
  );
  // The entry under `other:` is not in the catalog.
  assert.throws(
    () =>
      editCatalog(
        workspace,
        new Map([["missing", { current: "1.0.0", target: "1.0.1" }]]),
      ),
    /not every update was found under catalog:/,
  );
});
