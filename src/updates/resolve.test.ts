import assert from "node:assert/strict";
import { test } from "node:test";
import { excludePatterns, excluded, unexpected } from "./resolve.ts";

test("unexpected lists the status lines the kind may not produce", () => {
  const status =
    " M pnpm-lock.yaml\n M pnpm-workspace.yaml\n?? .maintain-kit/x\n M src/a.ts\n";
  assert.deepEqual(
    unexpected(status, /^ M (pnpm-lock|pnpm-workspace)\.yaml$/),
    ["?? .maintain-kit/x", " M src/a.ts"],
  );
  assert.deepEqual(
    unexpected(" M package.json\n", /^ M (package\.json|pnpm-lock\.yaml)$/),
    [],
  );
  assert.deepEqual(unexpected("", /x/), []);
});

test("excludePatterns and excluded match names, name@version and * patterns", () => {
  const patterns = excludePatterns({
    minimumReleaseAgeExclude: ["left-pad", "@scope/*", "x.y@1.0.0"],
    trustPolicyExclude: ["@types/node@26.0.0"],
  });
  assert.equal(patterns.length, 4);
  const added = [
    { name: "left-pad", version: "1.3.0" },
    { name: "left-pad", version: "1.2.0" },
    { name: "@scope/a", version: "1.0.0" },
    { name: "x.y", version: "2.0.0" },
    { name: "xzy", version: "2.0.0" },
    { name: "@types/node", version: "26.12.1" },
    { name: "other", version: "1.0.0" },
  ];
  assert.deepEqual(excluded(added, patterns), [
    "@scope/a@1.0.0",
    "@types/node@26.12.1",
    "left-pad@1.2.0",
    "left-pad@1.3.0",
    "x.y@2.0.0",
  ]);
  assert.deepEqual(excluded(added, excludePatterns({})), []);
  assert.deepEqual(
    excluded(added, excludePatterns({ minimumReleaseAgeExclude: "x" })),
    [],
  );
});
