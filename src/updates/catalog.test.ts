import assert from "node:assert/strict";
import { test } from "node:test";
import { stamp } from "../lib/versions.ts";
import type { Packument } from "../lib/versions.ts";
import {
  catalogTitle,
  currentReason,
  guard,
  pick,
  renderCatalog,
} from "./catalog.ts";
import type { Picks } from "./catalog.ts";

test("guard needs a long enough cooldown and the trust policy", () => {
  assert.equal(
    guard({ minimumReleaseAge: 20_160, trustPolicy: "no-downgrade" }, 14),
    20_160,
  );
  assert.equal(
    guard({ minimumReleaseAge: "20160", trustPolicy: "no-downgrade" }, 14),
    20_160,
  );
  assert.equal(
    guard({ minimumReleaseAge: 20_159, trustPolicy: "no-downgrade" }, 14),
    null,
  );
  assert.equal(guard({ minimumReleaseAge: 20_160 }, 14), null);
  assert.equal(
    guard({ minimumReleaseAge: "a lot", trustPolicy: "no-downgrade" }, 14),
    null,
  );
  assert.equal(guard(null, 14), null);
  assert.equal(guard({ trustPolicy: "no-downgrade" }, 0), 0);
});

// A trimmed `@types/node`: the pick must stay on 26, never read `6.6.5`
// out of `^26.6.5` and land on 6.14.13 (PR #23).
const typesNode: Packument = {
  name: "@types/node",
  "dist-tags": { latest: "26.12.1" },
  maintainers: [{ name: "types" }],
  versions: {
    "6.14.13": { _npmUser: { name: "types" } },
    "26.6.5": { _npmUser: { name: "types" } },
    "26.10.0": { _npmUser: { name: "types" } },
    "26.12.1": { _npmUser: { name: "types" } },
    "27.0.0": { _npmUser: { name: "types" } },
  },
  time: {
    "6.14.13": "2020-01-01T00:00:00.000Z",
    "26.6.5": "2026-08-01T00:00:00.000Z",
    "26.10.0": "2026-09-01T00:00:00.000Z",
    "26.12.1": "2026-10-20T00:00:00.000Z",
    "27.0.0": "2026-10-01T00:00:00.000Z",
  },
};
const flagged: Packument = {
  name: "knip",
  maintainers: [{ name: "lars" }],
  versions: {
    "6.41.0": { _npmUser: { name: "lars" } },
    "6.42.0": { _npmUser: { name: "mallory" } },
  },
  time: {
    "6.41.0": "2026-09-01T00:00:00.000Z",
    "6.42.0": "2026-09-15T00:00:00.000Z",
  },
};
const packs: Record<string, Packument> = {
  "@types/node": typesNode,
  knip: flagged,
};

test("pick stays on the major, reads the prefix, caps @types/node and flags signals", () => {
  const lines: string[] = [];
  const picks = pick(
    [
      ["@types/node", "^26.6.5"],
      ["knip", "6.41.0"],
      ["oxfmt", "latest"],
    ],
    (name) => packs[name] ?? {},
    stamp("2026-10-15T00:00:00Z"),
    26,
    (l) => lines.push(l),
  );
  assert.deepEqual(picks, {
    total: 3,
    kept: [
      {
        name: "@types/node",
        prefix: "^",
        current: "26.6.5",
        target: "26.10.0",
        date: "2026-09-01",
      },
    ],
    flagged: [
      "| `knip` | 6.41.0 → 6.42.0 | new publisher mallory, publisher mallory is not a maintainer |",
    ],
    majors: 0,
  });
  assert.equal(lines.length, 2);
  assert.match(
    lines[0] ?? "",
    /^@types\/node: picked 26\.10\.0 over 26\.6\.5, published 2026-09-01T00:00:00\.000Z, tarball \?, publisher types, 5 versions, latest 26\.12\.1$/,
  );
  // Without the cap, the new major counts.
  const uncapped = pick(
    [["@types/node", "^26.6.5"]],
    (name) => packs[name] ?? {},
    stamp("2026-10-15T00:00:00Z"),
    null,
    (l) => lines.push(l),
  );
  assert.equal(uncapped.majors, 1);
  assert.equal(uncapped.kept[0]?.target, "26.10.0");
});

test("currentReason and catalogTitle name the outcome", () => {
  const base: Picks = { total: 4, kept: [], flagged: [], majors: 0 };
  assert.equal(
    currentReason(base),
    "the 4 catalog packages are up to date on their majors",
  );
  assert.equal(
    currentReason({ ...base, flagged: ["| x |"], majors: 2 }),
    "1 catalog updates are held back by update signals, see the dashboard; new majors stay on the dashboard",
  );
  const one = {
    name: "knip",
    prefix: "",
    current: "6.41.0",
    target: "6.42.0",
    date: "d",
  };
  assert.equal(catalogTitle([one]), "Update knip to 6.42.0");
  assert.equal(catalogTitle([one, one]), "Update 2 catalog packages");
});

test("renderCatalog lists the picks, the lockfile changes and what was left out", () => {
  const picks: Picks = {
    total: 2,
    kept: [
      {
        name: "a|b",
        prefix: "^",
        current: "1.0.0",
        target: "1.1.0",
        date: "2026-01-01",
      },
    ],
    flagged: ["| `knip` | 6.41.0 → 6.42.0 | new publisher mallory |"],
    majors: 0,
  };
  const added = Array.from({ length: 101 }, (_, i) => ({
    name: `p${i}`,
    version: "1.0.0",
  }));
  const { content, summary } = renderCatalog(picks, added, "https://runs");
  assert.deepEqual(content.slice(0, 5), [
    "> [!WARNING]",
    "> 1 package was left out because of update signals, see below.",
    "",
    "| Package | Current | Update | Released |",
    "| --- | --- | --- | --- |",
  ]);
  assert.equal(content[5], "| `a\\|b` | ^1.0.0 | ^1.1.0 | 2026-01-01 |");
  assert.ok(
    content.includes(
      "101 new locked versions, all checked on osv.dev: none is in the OpenSSF malicious-packages database.",
    ),
  );
  assert.ok(content.includes("| `p99` | 1.0.0 |"));
  assert.ok(!content.includes("| `p100` | 1.0.0 |"));
  assert.ok(
    content.includes(
      "| … 1 more, see [the latest run's summary](https://runs) |",
    ),
  );
  assert.deepEqual(content.slice(-5), [
    "### Left out",
    "",
    "| Package | Update | Signals |",
    "| --- | --- | --- |",
    "| `knip` | 6.41.0 → 6.42.0 | new publisher mallory |",
  ]);
  assert.equal(summary.length, 103);
  assert.equal(summary[2], "- `p0` 1.0.0");
  const one = renderCatalog(
    { ...picks, flagged: [] },
    [added[0] ?? { name: "", version: "" }],
    "u",
  );
  assert.equal(one.content[0], "| Package | Current | Update | Released |");
  assert.ok(
    one.content.includes(
      "1 new locked version, all checked on osv.dev: none is in the OpenSSF malicious-packages database.",
    ),
  );
});
