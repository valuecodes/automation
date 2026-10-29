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

test("status warns about a version pnpm cannot resolve", () => {
  assert.deepEqual(status(current), {
    state: "ok",
    text: "up to date",
    details: "12.11.2",
  });
  assert.deepEqual(status(current, ["12.99.0"]), {
    state: "warn",
    text: "1 not resolvable",
    details:
      "12.11.2; the full packument lists 12.99.0 but pnpm cannot resolve it",
  });
  assert.deepEqual(
    status({ ...current, major: "13.0.0", majorDate: "2026-10-01" }, [
      "12.99.0",
    ]),
    {
      state: "update",
      text: "13.0.0 available",
      details:
        "12.11.2 → 13.0.0 (2026-10-01); the full packument lists 12.99.0 but pnpm cannot resolve it",
    },
  );
});
