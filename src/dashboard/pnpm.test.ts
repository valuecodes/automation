import assert from "node:assert/strict";
import { test } from "node:test";
import type { Newer } from "../lib/versions.ts";
import { status } from "./pnpm.ts";

const current: Newer = {
  name: "pnpm",
  current: "12.11.2",
  inMajor: null,
  inMajorDate: null,
  major: null,
  majorDate: null,
};

test("status warns about a version the registry does not serve", () => {
  assert.deepEqual(status(current), {
    state: "ok",
    text: "up to date",
    details: "12.11.2",
  });
  assert.deepEqual(status(current, ["12.99.0"]), {
    state: "warn",
    text: "1 not served",
    details: "12.11.2; the registry lists 12.99.0 but does not serve it",
  });
  assert.deepEqual(
    status({ ...current, major: "13.0.0", majorDate: "2026-10-01" }, [
      "12.99.0",
    ]),
    {
      state: "update",
      text: "13.0.0 available",
      details:
        "12.11.2 → 13.0.0 (2026-10-01); the registry lists 12.99.0 but does not serve it",
    },
  );
});
