import assert from "node:assert/strict";
import { test } from "node:test";
import { failingPackage, pickView, registryView } from "./diagnose.ts";

test("failingPackage reads pnpm's wrapped message", () => {
  const log = [
    " ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @types/node@26.12.1",
    "",
    "This error happened while installing a direct dependency of /work",
  ].join("\n");
  assert.deepEqual(failingPackage(log), {
    name: "@types/node",
    spec: "26.12.1",
  });
  const wrapped = [
    "│ ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @scope/",
    "│ package@^1.2.3 ",
  ].join("\n");
  assert.deepEqual(failingPackage(wrapped), {
    name: "@scope/package",
    spec: "^1.2.3",
  });
  assert.equal(failingPackage("something else went wrong"), null);
  assert.equal(
    failingPackage("No matching version found for ../evil@1 "),
    null,
  );
});

const pack = {
  "dist-tags": { latest: "1.2.0", next: "2.0.0-beta.1" },
  versions: {
    "1.0.0": {
      dist: { tarball: "https://r/1.0.0.tgz", integrity: "sha512-a" },
    },
    "1.2.0": {},
  },
  time: {
    modified: "2026-10-01T00:00:00.000Z",
    created: "2020-01-01T00:00:00.000Z",
    "1.0.0": "2025-01-01T00:00:00.000Z",
    "1.2.0": "2026-10-01T00:00:00.000Z",
  },
};

test("registryView and pickView describe the package", () => {
  assert.deepEqual(registryView(pack, "1.1.0"), [
    "dist-tags: latest=1.2.0 next=2.0.0-beta.1",
    "versions: 2, time.modified: 2026-10-01T00:00:00.000Z",
    "has versions[1.1.0]: false, has time[1.1.0]: false",
    "newest by publish time: 1.0.0 2025-01-01T00:00:00.000Z, 1.2.0 2026-10-01T00:00:00.000Z",
  ]);
  assert.deepEqual(pickView(pack, "1.0.0"), [
    "  versions: 2, has versions[1.0.0]: true, has time[1.0.0]: true",
    '  versions[1.0.0]: {"time":"2025-01-01T00:00:00.000Z","tarball":"https://r/1.0.0.tgz","integrity":"sha512-a","publisher":null,"attestations":false}',
  ]);
  assert.equal(pickView(pack, "9.9.9")[1], "  versions[9.9.9]: absent");
});
