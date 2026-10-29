import assert from "node:assert/strict";
import { test } from "node:test";
import { signalRow, signals } from "./signals.ts";
import type { Packument } from "./versions.ts";

const pack: Packument = {
  maintainers: [{ name: "alice" }],
  versions: {
    "1.0.0": { dist: { attestations: {} }, _npmUser: { name: "alice" } },
    "1.1.0": { _npmUser: { name: "mallory" } },
    "1.2.0": {
      _npmUser: { name: "alice", trustedPublisher: { id: "github" } },
    },
  },
  time: {
    created: "2024-01-01T00:00:00.000Z",
    "1.0.0": "2024-01-01T00:00:00.000Z",
    "1.1.0": "2026-01-01T00:00:00.000Z",
    "1.2.0": "2026-01-02T00:00:00.000Z",
  },
};

test("signals flags dropped provenance, a new publisher and a long silence", () => {
  assert.deepEqual(signals(pack, "1.0.0", "1.1.0"), [
    "provenance dropped",
    "new publisher mallory",
    "publisher mallory is not a maintainer",
    "first release in 24 months",
  ]);
  assert.deepEqual(signals(pack, "1.1.0", "1.2.0"), [
    "new publisher trusted publishing (github)",
  ]);
  assert.deepEqual(signals(pack, "1.0.0", "9.9.9"), []);
});

test("signalRow escapes the name and joins the signals", () => {
  assert.equal(
    signalRow("a|b", "1.0.0", "1.1.0", ["provenance dropped", "x"]),
    "| `a\\|b` | 1.0.0 → 1.1.0 | provenance dropped, x |",
  );
});
