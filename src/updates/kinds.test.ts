import assert from "node:assert/strict";
import { test } from "node:test";
import { edit as editScript, render as renderGitleaks } from "./gitleaks.ts";
import { edit as editNvmrc, render as renderNode } from "./node.ts";
import {
  edit as editPackageJson,
  integrityHex,
  parsePackageManager,
  render as renderPnpm,
} from "./pnpm.ts";

test("the Node.js update edits .nvmrc and renders the PR", () => {
  assert.equal(editNvmrc("v26.12.1\n", "26.12.1", "26.12.3"), "v26.12.3\n");
  const plain = renderNode(
    "26.12.1",
    { version: "26.12.3", date: "2026-10-28", security: false },
    "Active LTS, end of life 2029-04-30",
  );
  assert.equal(plain.title, "Update Node.js to 26.12.3");
  assert.deepEqual(plain.content.slice(0, 3), [
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    "| Node.js | ⬆️ update | 26.12.1 → 26.12.3 (2026-10-28) · Active LTS, end of life 2029-04-30 |",
  ]);
  assert.match(plain.content.at(-2) ?? "", /CHANGELOG_V26\.md/);
  const security = renderNode(
    "26.12.1",
    { version: "26.12.2", date: "2026-10-01", security: true },
    "x",
  );
  assert.deepEqual(security.content.slice(0, 2), [
    "> [!WARNING]",
    "> This update includes a Node.js security release.",
  ]);
  assert.match(
    security.content[5] ?? "",
    /⚠️ attention \| 26\.12\.1 → 26\.12\.2 \(2026-10-01\), security release · x/,
  );
});

test("the pnpm update reads the pin, moves the hash and edits package.json", () => {
  const hash = `+sha512.${"a".repeat(128)}`;
  const json = `{\n  "packageManager": "pnpm@12.11.2${hash}"\n}\n`;
  assert.deepEqual(parsePackageManager(json), {
    pm: `pnpm@12.11.2${hash}`,
    version: "12.11.2",
    hashed: true,
  });
  assert.deepEqual(parsePackageManager('{"packageManager": "pnpm@12.11.2"}'), {
    pm: "pnpm@12.11.2",
    version: "12.11.2",
    hashed: false,
  });
  assert.equal(parsePackageManager('{"packageManager": "yarn@4.0.0"}'), null);
  assert.equal(parsePackageManager("{}"), null);
  const digest = Buffer.from("b".repeat(128), "hex");
  const pack = {
    versions: {
      "12.12.0": { dist: { integrity: `sha512-${digest.toString("base64")}` } },
      "12.12.1": { dist: { integrity: "sha1-abc" } },
    },
  };
  assert.equal(integrityHex(pack, "12.12.0"), digest.toString("hex"));
  assert.equal(integrityHex(pack, "12.12.1"), null);
  assert.equal(integrityHex(pack, "12.12.2"), null);
  assert.equal(
    editPackageJson(json, `pnpm@12.11.2${hash}`, "pnpm@12.12.0+sha512.x"),
    '{\n  "packageManager": "pnpm@12.12.0+sha512.x"\n}\n',
  );
  const rendered = renderPnpm("12.11.2", "12.12.0", "2026-10-01", true);
  assert.equal(rendered.title, "Update pnpm to 12.12.0");
  assert.equal(
    rendered.content[2],
    "| pnpm | ⬆️ update | 12.11.2 → 12.12.0 (2026-10-01) |",
  );
  assert.match(
    rendered.content.at(-1) ?? "",
    /sha512 integrity for pnpm 12\.12\.0/,
  );
  assert.equal(renderPnpm("1", "2", "d", false).content.length, 5);
});

test("the gitleaks update edits the version and digest lines", () => {
  const script = `#!/bin/sh\nGITLEAKS_VERSION="8.28.0"\nGITLEAKS_DIGEST="sha256:${"a".repeat(64)}"\n`;
  assert.equal(
    editScript(script, "8.28.0", "8.30.0", null),
    script.replace("8.28.0", "8.30.0"),
  );
  assert.equal(
    editScript(script, "8.28.0", "8.30.0", {
      old: `sha256:${"a".repeat(64)}`,
      new: `sha256:${"b".repeat(64)}`,
    }),
    script.replace("8.28.0", "8.30.0").replace("a".repeat(64), "b".repeat(64)),
  );
  assert.throws(
    () =>
      editScript(
        `${script}GITLEAKS_VERSION="8.28.0"\n`,
        "8.28.0",
        "8.30.0",
        null,
      ),
    /the script holds GITLEAKS_VERSION="8\.28\.0" more than once/,
  );
  const rendered = renderGitleaks("8.28.0", "8.30.0", "2026-09-20", true);
  assert.equal(rendered.title, "Update gitleaks to 8.30.0");
  assert.match(
    rendered.content.at(-1) ?? "",
    /digest ghcr\.io serves for `gitleaks:v8\.30\.0`/,
  );
  assert.equal(
    renderGitleaks("8.28.0", "8.30.0", "2026-09-20", false).content.length,
    5,
  );
});
