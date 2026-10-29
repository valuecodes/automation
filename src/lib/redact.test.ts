import assert from "node:assert/strict";
import { test } from "node:test";
import { excerpt, redact } from "./redact.ts";

test("redact masks credentials in URLs, settings and token shapes", () => {
  assert.equal(
    redact("registry=https://user:pw@npm.example.com/x"),
    "registry=https://***@npm.example.com/x",
  );
  assert.equal(
    redact("//npm.example.com/:_authToken=abc"),
    "//npm.example.com/:_authToken=***",
  );
  assert.equal(redact("  _password=secret"), "  _password=***");
  assert.equal(redact('  "npmToken": "abc",'), '  "npmToken": "***"');
  assert.equal(
    redact(
      `token ${"npm_".padEnd(40, "a")} and ${"ghp_".padEnd(40, "b")} and github_pat_${"c".repeat(22)}`,
    ),
    "token *** and *** and ***",
  );
  assert.equal(redact("plain=value\nname=x"), "plain=value\nname=x");
});

test("excerpt titles, caps and indents a block", () => {
  assert.equal(excerpt("T", "a\nb\n"), "\n**T**\n\n    a\n    b\n\n");
  assert.equal(excerpt("T", "a"), "\n**T**\n\n    a\n\n");
  assert.equal(excerpt("T", ""), "\n**T**\n\n\n");
  const long = excerpt("T", "x".repeat(30_000));
  assert.equal(long.length, "\n**T**\n\n    ".length + 20_000 + 2);
});
