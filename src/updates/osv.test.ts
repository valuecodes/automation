import assert from "node:assert/strict";
import { test } from "node:test";
import { hitSummary } from "./osv.ts";

test("hitSummary names up to five hits once each, in a stable order", () => {
  const hits = [
    { name: "b", version: "1.0.0", id: "MAL-2026-2" },
    { name: "a", version: "1.0.0", id: "MAL-2026-1" },
    { name: "a", version: "1.0.0", id: "MAL-2026-1" },
  ];
  assert.equal(hitSummary(hits), "a@1.0.0 (MAL-2026-1), b@1.0.0 (MAL-2026-2)");
  const many = Array.from({ length: 7 }, (_, i) => ({
    name: `p${i}`,
    version: "1.0.0",
    id: "MAL-2026-1",
  }));
  assert.equal(hitSummary(many).split(", ").length, 5);
});
