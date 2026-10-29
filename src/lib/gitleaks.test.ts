import assert from "node:assert/strict";
import { test } from "node:test";
import { DIGEST_LINE, VERSION_LINE, newest } from "./gitleaks.ts";
import { stamp } from "./versions.ts";

const releases = [
  { tag_name: "v9.0.0", published_at: "2026-10-01T00:00:00Z" },
  { tag_name: "v8.30.0", published_at: "2026-09-20T00:00:00Z" },
  { tag_name: "v8.29.0", published_at: "2026-09-01T00:00:00Z" },
  { tag_name: "v8.31.0", published_at: "2026-10-25T00:00:00Z" },
  { tag_name: "v8.28.0-rc1", published_at: "2026-08-01T00:00:00Z" },
  { tag_name: "v8.32.0", published_at: "2026-09-25T00:00:00Z", draft: true },
  {
    tag_name: "v8.33.0",
    published_at: "2026-09-25T00:00:00Z",
    prerelease: true,
  },
];

test("newest picks the newest old-enough stable release, on any or the same major", () => {
  const cutoff = stamp("2026-10-15T00:00:00Z");
  assert.deepEqual(newest(releases, "8.28.0", cutoff), {
    version: "9.0.0",
    date: "2026-10-01",
  });
  assert.deepEqual(newest(releases, "8.28.0", cutoff, { sameMajor: true }), {
    version: "8.30.0",
    date: "2026-09-20",
  });
  assert.equal(newest(releases, "8.30.0", cutoff, { sameMajor: true }), null);
});

test("the pinned lines are read at the start of a line", () => {
  const script =
    '#!/bin/sh\nGITLEAKS_VERSION="8.28.0"\nGITLEAKS_DIGEST="sha256:' +
    `${"a".repeat(64)}"\n`;
  assert.equal(VERSION_LINE.exec(script)?.[1], "8.28.0");
  assert.equal(DIGEST_LINE.exec(script)?.[1], `sha256:${"a".repeat(64)}`);
  assert.equal(VERSION_LINE.exec('x GITLEAKS_VERSION="8.28.0"'), null);
});
