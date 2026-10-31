import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCiWorkflow } from "./context.ts";
import { filesFor } from "./setup.ts";

test("the ci-workflow input is a workflow file name", () => {
  assert.equal(validateCiWorkflow(""), null);
  assert.equal(validateCiWorkflow("ci.yml"), null);
  assert.match(
    validateCiWorkflow(".github/workflows/ci.yml") ?? "",
    /file name/,
  );
  assert.match(validateCiWorkflow("ci") ?? "", /file name/);
});

test("filesFor names each kind's files", () => {
  assert.deepEqual(filesFor("node"), [[".nvmrc", ".nvmrc"]]);
  assert.deepEqual(filesFor("pnpm"), [["package.json", "package.json"]]);
  assert.equal(filesFor("catalog").length, 3);
});
