import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYaml } from "./yaml.ts";

const lockfile = [
  "---",
  "lockfileVersion: '9.0'",
  "",
  "importers:",
  "",
  "  .:",
  "    configDependencies: {}",
  "    packageManagerDependencies:",
  "      pnpm:",
  "        specifier: 12.11.2",
  "        version: 12.11.2",
  "",
  "packages:",
  "",
  "  '@pnpm/exe.linux-x64@12.11.2':",
  "    resolution: {integrity: sha512-abc==}",
  "    cpu: [x64]",
  "    os: [linux]",
  "    libc: [glibc]",
  "",
  "---",
  "lockfileVersion: '9.0'",
  "",
  "settings:",
  "  autoInstallPeers: true",
  "  excludeLinksFromLockfile: false",
  "  minimumReleaseAge: 20160",
  "",
  "packages:",
  "",
  "  knip@6.41.0:",
  "    resolution: {integrity: sha512-def==}",
  "    engines: {node: '>=20.18.0'}",
  "    hasBin: true",
  "",
  "  'tar@7.5.3(peer@1.0.0)':",
  "    resolution: {integrity: sha512-ghi==, tarball: 'https://x/y#z'}",
  "",
  "snapshots:",
  "",
  "  knip@6.41.0(typescript@7.0.2):",
  "    dependencies:",
  "      typescript: 7.0.2",
  "    optionalDependencies:",
  "      fsevents: 2.3.3",
  "",
].join("\n");

test("parseYaml reads a pnpm lockfile's documents", () => {
  const docs = parseYaml(lockfile);
  assert.equal(docs.length, 2);
  assert.deepEqual(docs[0], {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        configDependencies: {},
        packageManagerDependencies: {
          pnpm: { specifier: "12.11.2", version: "12.11.2" },
        },
      },
    },
    packages: {
      "@pnpm/exe.linux-x64@12.11.2": {
        resolution: { integrity: "sha512-abc==" },
        cpu: ["x64"],
        os: ["linux"],
        libc: ["glibc"],
      },
    },
  });
  assert.deepEqual(docs[1], {
    lockfileVersion: "9.0",
    settings: {
      autoInstallPeers: true,
      excludeLinksFromLockfile: false,
      minimumReleaseAge: 20_160,
    },
    packages: {
      "knip@6.41.0": {
        resolution: { integrity: "sha512-def==" },
        engines: { node: ">=20.18.0" },
        hasBin: true,
      },
      "tar@7.5.3(peer@1.0.0)": {
        resolution: { integrity: "sha512-ghi==", tarball: "https://x/y#z" },
      },
    },
    snapshots: {
      "knip@6.41.0(typescript@7.0.2)": {
        dependencies: { typescript: "7.0.2" },
        optionalDependencies: { fsevents: "2.3.3" },
      },
    },
  });
});

test("parseYaml reads a workspace file with comments, lists and quotes", () => {
  const docs = parseYaml(
    [
      "# Versions",
      "packages:",
      "  - apps/*",
      '  - "packages/*" # all',
      "catalog:",
      '  "@types/node": 26.6.5',
      "  knip: 6.41.0 # tool",
      "  note: it's fine",
      "catalogMode: strict",
      "minimumReleaseAge: 20160",
      "trustPolicy: no-downgrade",
      "minimumReleaseAgeExclude:",
      "- '@scope/*'",
      "- name@1.0.0",
      "empty:",
      "items:",
      "  - name: a",
      "    version: 1",
      "  - name: b",
      "",
    ].join("\n"),
  );
  assert.deepEqual(docs, [
    {
      packages: ["apps/*", "packages/*"],
      catalog: { "@types/node": "26.6.5", knip: "6.41.0", note: "it's fine" },
      catalogMode: "strict",
      minimumReleaseAge: 20_160,
      trustPolicy: "no-downgrade",
      minimumReleaseAgeExclude: ["@scope/*", "name@1.0.0"],
      empty: null,
      items: [{ name: "a", version: 1 }, { name: "b" }],
    },
  ]);
  assert.deepEqual(parseYaml(""), [null]);
  // Plain scalars run to the end of the line; numbers are integers only.
  assert.deepEqual(
    parseYaml(
      "deprecated: request has been deprecated, see https://x\nv: 1.10\nn: 9.0\ni: 42\n",
    ),
    [
      {
        deprecated: "request has been deprecated, see https://x",
        v: "1.10",
        n: "9.0",
        i: 42,
      },
    ],
  );
  assert.deepEqual(parseYaml("- a, b\n- {x: 1}\n"), [["a, b", { x: 1 }]]);
  assert.deepEqual(parseYaml("a: 'it''s'\nb: \"x\\ty\"\n"), [
    { a: "it's", b: "x\ty" },
  ]);
});

test("parseYaml reads literal and folded block scalars", () => {
  const text = [
    "packages:",
    "  request@2.88.2:",
    "    deprecated: >-",
    "      request has been deprecated, see",
    "      https://github.com/request/request/issues/3142",
    "    hasBin: true",
    "  other@1.0.0:",
    "    deprecated: |",
    "      line one # not a comment",
    "",
    "        indented",
    "      last",
    "",
    "    note: >+",
    "      kept",
    "",
    "    after: 1",
    "- end",
  ]
    .join("\n")
    .replace("\n- end", "");
  assert.deepEqual(parseYaml(text), [
    {
      packages: {
        "request@2.88.2": {
          deprecated:
            "request has been deprecated, see https://github.com/request/request/issues/3142",
          hasBin: true,
        },
        "other@1.0.0": {
          deprecated: "line one # not a comment\n\n  indented\nlast\n",
          note: "kept\n\n",
          after: 1,
        },
      },
    },
  ]);
  assert.deepEqual(parseYaml("- |\n  a\n  b\n- x\n"), [["a\nb\n", "x"]]);
  assert.deepEqual(parseYaml("a: >\n  one\n  two\n\n  three\nb: 2\n"), [
    { a: "one two\nthree\n", b: 2 },
  ]);
});

test("parseYaml refuses what it cannot read", () => {
  assert.throws(() => parseYaml("a: &x 1\n"), /unsupported/);
  assert.throws(() => parseYaml("a:\n\tb: 1\n"), /tabs/);
  assert.throws(() => parseYaml("a: 1\n  b: 2\n"), /unexpected indentation/);
  assert.throws(() => parseYaml("a: {b: 1\n"), /expected/);
});
