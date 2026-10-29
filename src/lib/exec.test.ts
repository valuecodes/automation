import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./exec.ts";

test("run returns the exit code and both streams", async () => {
  const ok = await run("sh", ["-c", "echo out; echo err >&2"]);
  assert.deepEqual(ok, { code: 0, stdout: "out\n", stderr: "err\n" });
  const failed = await run("sh", ["-c", "echo no; exit 3"]);
  assert.equal(failed.code, 3);
  assert.equal(failed.stdout, "no\n");
  const slow = await run("sh", ["-c", "sleep 5"], { timeoutMs: 100 });
  assert.equal(slow.code, 124);
  await assert.rejects(run("no-such-tool-here", []));
});
