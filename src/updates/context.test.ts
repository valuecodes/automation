import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCiWorkflow, validateGitleaksScript } from "./context.ts";
import { filesFor } from "./setup.ts";

test("the inputs are plain paths and file names", () => {
  assert.equal(validateGitleaksScript(""), null);
  assert.equal(validateGitleaksScript(".github/scripts/secrets-scan.sh"), null);
  assert.match(validateGitleaksScript("../x.sh") ?? "", /relative path/);
  assert.match(validateGitleaksScript("a/./b.sh") ?? "", /relative path/);
  assert.match(validateGitleaksScript("/etc/x") ?? "", /relative path/);
  assert.match(validateGitleaksScript("a b.sh") ?? "", /relative path/);
  assert.equal(validateCiWorkflow(""), null);
  assert.equal(validateCiWorkflow("ci.yml"), null);
  assert.match(
    validateCiWorkflow(".github/workflows/ci.yml") ?? "",
    /file name/,
  );
  assert.match(validateCiWorkflow("ci") ?? "", /file name/);
});

test("filesFor names each kind's files", () => {
  assert.deepEqual(filesFor("node", ""), [[".nvmrc", ".nvmrc"]]);
  assert.deepEqual(filesFor("gitleaks", ""), []);
  assert.deepEqual(filesFor("gitleaks", "x/scan.sh"), [
    ["x/scan.sh", "gitleaks-script"],
  ]);
  assert.equal(filesFor("catalog", "").length, 3);
});
