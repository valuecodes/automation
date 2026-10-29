import assert from "node:assert/strict";
import { test } from "node:test";
import { notPnpm } from "./audit.ts";

test("notPnpm says why a project is not a pnpm one", () => {
  assert.equal(notPnpm('{"packageManager": "pnpm@12.11.2"}'), null);
  assert.equal(
    notPnpm('{"packageManager": "yarn@4.0.0"}'),
    "package.json has no pnpm packageManager",
  );
  assert.equal(notPnpm("{}"), "package.json has no pnpm packageManager");
  assert.equal(notPnpm(null), "package.json has no pnpm packageManager");
  assert.throws(() => notPnpm("not json"));
});
