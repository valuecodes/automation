import assert from "node:assert/strict";
import { test } from "node:test";
import { newer, parse, stamp } from "./versions.ts";
import type { Packument } from "./versions.ts";

const day = 86_400;
const pack: Packument = {
  versions: {
    "1.0.0": {},
    "1.1.0": {},
    "1.2.0": { deprecated: "broken" },
    "1.3.0": {},
    "2.0.0": {},
    "3.0.0-beta.1": {},
    "3.0.0": {},
  },
  time: {
    "1.0.0": "2026-01-01T00:00:00.000Z",
    "1.1.0": "2026-01-10T00:00:00.000Z",
    "1.2.0": "2026-01-11T00:00:00.000Z",
    "1.3.0": "2026-02-01T00:00:00.000Z",
    "2.0.0": "2026-01-20T00:00:00.000Z",
    "3.0.0-beta.1": "2026-01-21T00:00:00.000Z",
    "3.0.0": "2026-01-22T00:00:00.000Z",
  },
};

test("parse accepts exact versions only", () => {
  assert.deepEqual(parse("26.12.1"), [26, 12, 1]);
  assert.equal(parse("v1.2.3"), null);
  assert.equal(parse("1.2"), null);
  assert.equal(parse("1.2.3-beta"), null);
});

test("stamp reads timestamps with and without fractions", () => {
  assert.equal(
    stamp("2026-01-01T00:00:00Z"),
    stamp("2026-01-01T00:00:00.000Z"),
  );
});

test("newer skips deprecated, prerelease and too-new versions", () => {
  const cutoff = stamp("2026-01-25T00:00:00Z");
  assert.deepEqual(newer(pack, "p", "1.0.0", cutoff, null), {
    name: "p",
    current: "1.0.0",
    inMajor: "1.1.0",
    inMajorDate: "2026-01-10",
    major: "3.0.0",
    majorDate: "2026-01-22",
  });
});

test("newer caps the major and reports nothing when current", () => {
  const cutoff = stamp("2026-03-01T00:00:00Z");
  const capped = newer(pack, "p", "1.0.0", cutoff, 2);
  assert.equal(capped.inMajor, "1.3.0");
  assert.equal(capped.major, "2.0.0");
  const current = newer(pack, "p", "3.0.0", cutoff, null);
  assert.equal(current.inMajor, null);
  assert.equal(current.major, null);
  assert.equal(
    newer(pack, "p", "1.0.0", stamp("2025-12-01T00:00:00Z") - day, null)
      .inMajor,
    null,
  );
});
