import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "./node.ts";

test("status combines the update and the lifecycle", () => {
  const life = {
    phase: "supported" as const,
    text: "Active LTS, end of life 2029-04-30",
  };
  assert.deepEqual(status("26.12.1", null, life), {
    state: "ok",
    text: "up to date",
    details: "26.12.1 · Active LTS, end of life 2029-04-30",
  });
  assert.deepEqual(
    status(
      "26.12.1",
      { version: "26.12.2", date: "2026-10-01", security: true },
      life,
    ),
    {
      state: "warn",
      text: "26.12.2 available, includes a security release",
      details:
        "26.12.1 → 26.12.2 (2026-10-01), security release · Active LTS, end of life 2029-04-30",
    },
  );
  const eol = status("20.0.0", null, {
    phase: "eol",
    text: "end of life since 2026-04-30",
  });
  assert.equal(eol.state, "warn");
  assert.equal(eol.text, "past end of life");
});
