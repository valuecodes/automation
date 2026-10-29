import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lockedPackages,
  lockfileEntries,
  lockfileVersion,
  pinnedPnpm,
  supportedVersion,
  withoutPnpm,
} from "./lockfile.ts";

const v9 = [
  {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        packageManagerDependencies: {
          pnpm: { specifier: "12.11.2", version: "12.11.2" },
        },
      },
    },
    packages: {
      "pnpm@12.11.2": {},
      "@pnpm/exe.linux-x64@12.11.2": {},
    },
  },
  {
    lockfileVersion: "9.0",
    importers: { ".": { dependencies: { knip: { version: "6.41.0" } } } },
    packages: {
      "knip@6.41.0": {},
      "tar@7.5.3(peer@1.0.0)": {},
      "tar@7.5.3(peer@2.0.0)": {},
      "@scope/x@1.0.0-beta.1": {},
      "https://codeload.github.com/o/r/tar.gz/abc": {},
      "left-pad@github.com/x/y/abc": {},
    },
    snapshots: { "knip@6.41.0": {}, "@pnpm/foo@1.0.0": {} },
  },
];

test("lockfileEntries lists each package once and counts the rest", () => {
  assert.deepEqual(lockfileEntries(v9), [
    { name: "@pnpm/exe.linux-x64", version: "12.11.2" },
    { name: "@scope/x", version: "1.0.0-beta.1" },
    { name: "knip", version: "6.41.0" },
    { name: "pnpm", version: "12.11.2" },
    { name: "tar", version: "7.5.3" },
    { skipped: "https://codeload.github.com/o/r/tar.gz/abc" },
    { skipped: "left-pad@github.com/x/y/abc" },
  ]);
  assert.equal(lockedPackages(v9).length, 5);
  const v6 = [{ lockfileVersion: "6.0", packages: { "/knip@6.41.0": {} } }];
  assert.deepEqual(lockedPackages(v6), [{ name: "knip", version: "6.41.0" }]);
});

test("lockfileVersion and supportedVersion read the first document", () => {
  assert.equal(lockfileVersion(v9), "9.0");
  assert.equal(lockfileVersion([{}]), "null");
  assert.equal(lockfileVersion([{ lockfileVersion: 5.4 }]), "5.4");
  assert.equal(supportedVersion("9.0"), true);
  assert.equal(supportedVersion("6.1"), true);
  assert.equal(supportedVersion("5.4"), false);
  assert.equal(supportedVersion("9.foo"), false);
});

test("pinnedPnpm and withoutPnpm see pnpm's own entries", () => {
  assert.equal(pinnedPnpm(v9), "12.11.2");
  assert.equal(pinnedPnpm([{}]), "");
  const stripped = withoutPnpm(v9);
  assert.deepEqual(stripped, [
    { lockfileVersion: "9.0", importers: { ".": {} }, packages: {} },
    {
      ...v9[1],
      packages: Object.fromEntries(
        Object.entries(v9[1]?.packages ?? {}).filter(
          ([k]) => k !== "pnpm@12.11.2",
        ),
      ),
      snapshots: { "knip@6.41.0": {} },
    },
  ]);
  // The input is left alone.
  assert.equal(pinnedPnpm(v9), "12.11.2");
});
