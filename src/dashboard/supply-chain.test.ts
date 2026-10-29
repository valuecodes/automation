import assert from "node:assert/strict";
import { test } from "node:test";
import type { Packument } from "../lib/versions.ts";
import { hitNames, render, signals } from "./supply-chain.ts";
import type { Hit } from "./supply-chain.ts";

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

const candidateHit: Hit = {
  name: "evil",
  version: "1.0.0",
  where: "update candidate",
  id: "MAL-2026-2",
};
const hits: Hit[] = [
  candidateHit,
  {
    name: "bad",
    version: "0.1.0",
    where: "`pnpm-lock.yaml`",
    id: "MAL-2026-1",
  },
];

test("hitNames lists up to three names", () => {
  assert.equal(hitNames(hits, "all"), "bad, evil");
  assert.equal(hitNames(hits, "locked"), "bad");
});

test("render reports clean, candidate-only and locked hits", () => {
  const base = {
    catalogStatus: null,
    candidates: [],
    lockNote: "",
    locked: 3,
    skipped: 1,
    hits: [],
    flagged: [],
  };
  const clean = render(base);
  assert.equal(
    clean.markdown,
    "**Supply chain:** no hits in the OpenSSF malicious-packages database (osv.dev); no pending catalog updates to check for signals.\n",
  );
  assert.deepEqual(clean.status, {
    state: "ok",
    text: "no findings",
    details: "3 locked packages (1 git or tarball entry not checked) checked",
  });
  const na = render({
    ...base,
    lockNote: "no pnpm-lock.yaml",
    locked: 0,
    skipped: 0,
  });
  assert.equal(na.status.state, "na");
  const candidate = render({
    ...base,
    candidates: [{ name: "evil", current: "0.9.0", version: "1.0.0" }],
    hits: [candidateHit],
  });
  assert.deepEqual(candidate.status, {
    state: "warn",
    text: "malicious: 1 update candidate",
    details: "do not update evil",
  });
  assert.match(candidate.markdown, /Do not update to them\./);
  assert.match(
    candidate.markdown,
    /\*\*Update signals:\*\* no signals on the 1 update candidate\./,
  );
  const locked = render({
    ...base,
    hits,
    flagged: ["| `x` | 1 → 2 | provenance dropped |"],
  });
  assert.deepEqual(locked.status, {
    state: "alert",
    text: "malicious: 2 packages",
    details: "1 malicious package in pnpm-lock.yaml: bad",
  });
  assert.match(locked.markdown, /Remove them before anything else\./);
  assert.match(
    locked.markdown,
    /\| 🟥 `bad` \| 0\.1\.0 \| `pnpm-lock\.yaml` \| \[MAL-2026-1\]/,
  );
  assert.match(locked.markdown, /### Update signals \(npm registry\)/);
});
