import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  addFile,
  appendQueries,
  readContent,
  readPaths,
  readQueries,
  readState,
  replaceOnce,
  writeContent,
  writeState,
} from "./outcome.ts";

test("replaceOnce edits exactly one occurrence", () => {
  assert.equal(
    replaceOnce("v26.6.5\n", "26.6.5", "26.12.1", ".nvmrc"),
    "v26.12.1\n",
  );
  assert.throws(
    () => replaceOnce("a 1.0.0 b 1.0.0", "1.0.0", "2.0.0", "the file"),
    /the file holds 1\.0\.0 more than once/,
  );
  assert.throws(
    () => replaceOnce("nothing", "1.0.0", "2.0.0", "the file"),
    /the file does not hold 1\.0\.0/,
  );
});

test("the hand-off files round-trip", () => {
  const out = mkdtempSync(`${tmpdir()}/outcome-`);
  assert.equal(readState(out), null);
  writeState(out, "current", "all good");
  assert.deepEqual(readState(out), { state: "current", reason: "all good" });
  addFile(out, ".github/scripts/x.sh", "old", "new");
  addFile(out, "package.json", Buffer.from("{}"), "{ }");
  assert.deepEqual(readPaths(out), [".github/scripts/x.sh", "package.json"]);
  assert.equal(readFileSync(`${out}/new/.github/scripts/x.sh`, "utf8"), "new");
  writeContent(out, ["a", "b"]);
  assert.equal(readContent(out), "a\nb");
  appendQueries(out, [{ name: "a", version: "1.0.0" }]);
  appendQueries(out, [{ name: "b", version: "2.0.0" }]);
  assert.deepEqual(readQueries(out), [
    { name: "a", version: "1.0.0" },
    { name: "b", version: "2.0.0" },
  ]);
});
