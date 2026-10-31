import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { Api } from "../lib/github.ts";
import { captureLog } from "../lib/capture-log.ts";
import { HttpError } from "../lib/http.ts";
import { modeOk } from "./commit.ts";
import type { Meta, UpdateContext } from "./context.ts";
import { body, commitMessage, label, ours, publish, unchanged } from "./pr.ts";
import type { Pull } from "./pr.ts";

const BOT = "github-actions[bot]";
const input = {
  ciWorkflow: "ci.yml",
  dashboard: 12,
  caller: ".github/workflows/updates.yml",
  runsUrl: "https://runs",
  date: "2026-10-29",
};

test("label, commitMessage and modeOk", () => {
  assert.equal(label("node"), "Node.js");
  assert.equal(label("catalog"), "Dependencies");
  assert.equal(label("pnpm"), "pnpm");
  assert.equal(
    commitMessage("Update Node.js to 26.12.3", "node"),
    "chore: update Node.js to 26.12.3\n\nMaintain-Kit-Updates:node",
  );
  assert.equal(modeOk("100644"), true);
  assert.equal(modeOk("100755"), true);
  assert.equal(modeOk("120000"), false);
});

test("body adds the notes and a marker that ignores the date", () => {
  const a = body("t", "content", input);
  const b = body("t", "content", { ...input, date: "2027-01-01" });
  assert.equal(a.marker, b.marker);
  assert.match(a.marker, /^<!-- maintain-kit-updates:[0-9a-f]{64} -->$/);
  assert.match(
    a.content,
    /^content\n\nCI runs through `workflow_dispatch` of `ci\.yml`/,
  );
  assert.match(a.content, /\n\nDashboard: #12$/);
  assert.equal(
    a.body,
    `${a.content}\n\n---\nLast changed: 2026-10-29 · [Workflow runs](https://runs) · Source: [valuecodes/maintain-kit](https://github.com/valuecodes/maintain-kit)\n\n${a.note}\n${a.marker}\n`,
  );
  const plain = body("t", "content", {
    ...input,
    ciWorkflow: "",
    dashboard: null,
  });
  assert.match(plain.content, /approves them: use \*\*Approve workflows/);
  assert.doesNotMatch(plain.content, /Dashboard:/);
  assert.notEqual(plain.marker, a.marker);
});

test("unchanged compares title, content, footer and marker", () => {
  const built = body("t", "content", input);
  const pr: Pull = {
    number: 1,
    title: "t",
    body: built.body.replaceAll("\n", "\r\n"),
  };
  assert.equal(unchanged(pr, "t", built), true);
  assert.equal(unchanged({ ...pr, title: "other" }, "t", built), false);
  assert.equal(unchanged(pr, "t", body("t", "edited", input)), false);
  assert.equal(unchanged({ ...pr, body: null }, "t", built), false);
});

test("ours needs the bot author and the trailer on every commit", () => {
  const good = {
    author: { login: BOT },
    commit: { message: "chore: x\n\nMaintain-Kit-Updates:node" },
  };
  assert.equal(ours({ total_commits: 1, commits: [good] }, "node"), true);
  assert.equal(ours({ total_commits: 1, commits: [good] }, "pnpm"), false);
  assert.equal(
    ours({ commits: [good, { ...good, author: { login: "human" } }] }, "node"),
    false,
  );
  assert.equal(
    ours(
      { commits: [good, { ...good, commit: { message: "merge" } }] },
      "node",
    ),
    false,
  );
  // The compare API caps the commits it returns, so a longer history fails closed.
  assert.equal(ours({ total_commits: 251, commits: [good] }, "node"), false);
  assert.equal(ours({ commits: [] }, "node"), true);
});

type Fake = {
  pr?: Pull;
  closed?: Pull[];
  tip?: string | null;
  ours?: boolean;
  holds?: boolean;
  moved?: boolean;
};

const fakeApi = (f: Fake): { api: Api; calls: string[] } => {
  const calls: string[] = [];
  let refReads = 0;
  const api: Api = <T>(method: string, path: string): Promise<T> => {
    calls.push(`${method} ${path}`);
    const r = (v: unknown): Promise<T> => Promise.resolve(v as T);
    if (method === "GET" && path.includes("/pulls?")) {
      const open = f.pr === undefined ? [] : [f.pr];
      return r(path.includes("state=open") ? open : (f.closed ?? []));
    }
    if (method === "GET" && path.includes("/git/ref/heads/")) {
      if (f.tip === null || f.tip === undefined) {
        return Promise.reject(new HttpError(path, 404, "not found"));
      }
      refReads += 1;
      return r({
        object: { sha: f.moved === true && refReads > 1 ? "moved" : f.tip },
      });
    }
    if (method === "GET" && path.includes("/compare/")) {
      return r({
        total_commits: 1,
        commits: [
          {
            author: { login: f.ours === false ? "human" : BOT },
            commit: { message: "chore: x\n\nMaintain-Kit-Updates:node" },
          },
        ],
      });
    }
    if (method === "GET" && path.endsWith("/git/commits/base")) {
      return r({ tree: { sha: "basetree" } });
    }
    if (method === "GET" && path.includes("/git/commits/")) {
      return r({
        tree: { sha: f.holds === true ? "tree1" : "other" },
        parents: [{ sha: "base" }],
      });
    }
    if (method === "GET" && path.includes("/git/trees/")) {
      return r({
        tree: [
          { path: ".nvmrc", type: "blob", mode: "100644" },
          { path: ".github", type: "tree", sha: "t2" },
          { path: "scripts", type: "tree", sha: "t3" },
          { path: "scan.sh", type: "blob", mode: "100755" },
        ],
      });
    }
    if (method === "POST" && path.endsWith("/git/blobs")) {
      return r({ sha: "blob1" });
    }
    if (method === "POST" && path.endsWith("/git/trees")) {
      return r({ sha: "tree1" });
    }
    if (method === "POST" && path.endsWith("/git/commits")) {
      return r({ sha: "commit1" });
    }
    if (
      method === "POST" &&
      path.endsWith("/labels") &&
      !path.includes("/issues/")
    ) {
      return Promise.reject(new HttpError(path, 422, "exists"));
    }
    if (method === "POST" && path.endsWith("/pulls")) {
      return r({ number: 9, html_url: "https://pr/9" });
    }
    return r(undefined);
  };
  return { api, calls };
};

const meta: Meta = { base: "main", baseSha: "base", dashboard: 12 };

/** A context and a filled `$OUT` for a Node.js update. */
const fixture = (
  dryRun: boolean,
): { ctx: UpdateContext; logs: string[]; summary: string } => {
  const temp = mkdtempSync(`${tmpdir()}/pr-`);
  const out = `${temp}/update`;
  mkdirSync(`${out}/old/.github/scripts`, { recursive: true });
  mkdirSync(`${out}/new/.github/scripts`, { recursive: true });
  writeFileSync(`${out}/title`, "Update Node.js to 26.12.3\n");
  writeFileSync(
    `${out}/content.md`,
    "| Node.js | ⬆️ update | 26.12.1 → 26.12.3 |\n",
  );
  writeFileSync(`${out}/paths`, ".nvmrc\n.github/scripts/scan.sh\n");
  writeFileSync(`${out}/old/.nvmrc`, "26.12.1\n");
  writeFileSync(`${out}/new/.nvmrc`, "26.12.3\n");
  writeFileSync(`${out}/old/.github/scripts/scan.sh`, "a\n");
  writeFileSync(`${out}/new/.github/scripts/scan.sh`, "b\n");
  const summary = `${temp}/summary.md`;
  writeFileSync(summary, "");
  process.env.GITHUB_STEP_SUMMARY = summary;
  const ctx: UpdateContext = {
    repo: "o/r",
    caller: input.caller,
    runsUrl: input.runsUrl,
    minAgeDays: 14,
    dryRun,
    kind: "node",
    ciWorkflow: "ci.yml",
    temp,
    src: `${temp}/src`,
    out,
    npm: `${temp}/npm`,
  };
  return { ctx, logs: [], summary };
};

const run = async (
  f: Fake,
  dryRun: boolean,
  outcome: {
    state: "update" | "current" | "na" | "blocked";
    reason: string;
  } = {
    state: "update",
    reason: "",
  },
): Promise<{ calls: string[]; logs: string[]; summary: string }> => {
  const { ctx, logs, summary } = fixture(dryRun);
  const { api, calls } = fakeApi(f);
  await publish(api, ctx, meta, outcome, (l) => logs.push(l));
  return { calls, logs, summary: readFileSync(summary, "utf8") };
};

test("publish creates the commit, branch, label, PR and CI run", async () => {
  const { calls, logs } = await run({ tip: null }, false);
  assert.deepEqual(
    calls.filter((c) => !c.startsWith("GET")),
    [
      "POST repos/o/r/git/blobs",
      "POST repos/o/r/git/blobs",
      "POST repos/o/r/git/trees",
      "POST repos/o/r/git/commits",
      "POST repos/o/r/git/refs",
      "POST repos/o/r/labels",
      "PATCH repos/o/r/labels/maintain-kit-updates",
      "POST repos/o/r/pulls",
      "POST repos/o/r/issues/9/labels",
      "POST repos/o/r/actions/workflows/ci.yml/dispatches",
    ],
  );
  assert.deepEqual(logs, [
    "Pushed commit1 to maintain-kit/node.",
    "Opened https://pr/9.",
    "Started ci.yml on maintain-kit/node.",
  ]);
});

test("publish leaves an unchanged PR alone and edits a changed one", async () => {
  const built = body(
    "Update Node.js to 26.12.3",
    "| Node.js | ⬆️ update | 26.12.1 → 26.12.3 |",
    input,
  );
  const pr: Pull = {
    number: 4,
    title: "Update Node.js to 26.12.3",
    body: built.body,
    user: { login: BOT },
    head: { repo: { full_name: "o/r" } },
  };
  const same = await run({ pr, tip: "tip", holds: true }, false);
  // The tree is built to compare it with the branch's; nothing else is sent.
  assert.deepEqual(
    same.calls.filter(
      (c) =>
        !c.startsWith("GET") &&
        !c.endsWith("/git/blobs") &&
        !c.endsWith("/git/trees"),
    ),
    [],
  );
  assert.deepEqual(same.logs, [
    "maintain-kit/node already holds this update.",
    "PR #4 is unchanged.",
  ]);
  const stale = await run({ pr: { ...pr, body: "old" }, tip: "tip" }, false);
  assert.ok(
    stale.calls.includes("PATCH repos/o/r/git/refs/heads/maintain-kit/node"),
  );
  assert.ok(stale.calls.includes("PATCH repos/o/r/pulls/4"));
  assert.equal(stale.logs.at(-1), "Started ci.yml on maintain-kit/node.");
  // A fork's PR on the same branch name is not ours to edit.
  const fork = await run(
    {
      pr: { ...pr, head: { repo: { full_name: "fork/r" } } },
      tip: "tip",
      holds: true,
    },
    false,
  );
  assert.ok(fork.calls.includes("POST repos/o/r/pulls"));
});

test("publish stops for someone else's commits, a moved branch or a closed PR", async (t) => {
  const out = captureLog(t);
  const other = await run({ tip: "tip", ours: false }, false);
  assert.deepEqual(
    other.calls.filter((c) => !c.startsWith("GET")),
    [],
  );
  const moved = await run({ tip: "tip", moved: true }, false);
  assert.ok(!moved.calls.some((c) => c.startsWith("PATCH repos/o/r/git/refs")));
  assert.ok(!moved.calls.includes("POST repos/o/r/pulls"));
  const built = body(
    "Update Node.js to 26.12.3",
    "| Node.js | ⬆️ update | 26.12.1 → 26.12.3 |",
    input,
  );
  const closed = await run(
    {
      tip: null,
      closed: [
        {
          number: 2,
          body: `x ${built.marker}`,
          merged_at: null,
          user: { login: BOT },
          head: { repo: { full_name: "o/r" } },
        },
      ],
    },
    false,
  );
  assert.deepEqual(
    closed.calls.filter((c) => !c.startsWith("GET")),
    [],
  );
  assert.deepEqual(closed.logs, [
    "A closed PR already proposed this exact update; not reopening it.",
  ]);
  assert.match(out.join(), /not made by this workflow.*moved while this run/);
});

test("a dry run writes the PR and its diff to the summary only", async () => {
  const { calls, logs, summary } = await run({ tip: null }, true);
  assert.deepEqual(
    calls.filter((c) => !c.startsWith("GET")),
    [],
  );
  assert.deepEqual(logs, [
    "Dry run: the planned PR is in the run summary; nothing was pushed.",
  ]);
  assert.match(summary, /^## Update Node\.js to 26\.12\.3\n\n\| Node\.js/);
  assert.match(summary, /```diff\n--- a\/\.nvmrc\n\+\+\+ b\/\.nvmrc\n/);
  assert.match(summary, /-26\.12\.1\n\+26\.12\.3\n/);
  assert.match(summary, /--- a\/\.github\/scripts\/scan\.sh\n/);
});

test("when nothing is due, this workflow's PR is closed and its branch deleted", async (t) => {
  captureLog(t);
  const pr: Pull = {
    number: 4,
    user: { login: BOT },
    head: { repo: { full_name: "o/r" } },
  };
  const current = {
    state: "current" as const,
    reason: "Node.js 26.12.1 is up to date",
  };
  const closed = await run({ pr, tip: "tip" }, false, current);
  assert.deepEqual(
    closed.calls.filter((c) => !c.startsWith("GET")),
    [
      "POST repos/o/r/issues/4/comments",
      "PATCH repos/o/r/pulls/4",
      "DELETE repos/o/r/git/refs/heads/maintain-kit/node",
    ],
  );
  assert.deepEqual(closed.logs, ["Closed #4: Node.js 26.12.1 is up to date."]);
  assert.equal(closed.summary, "**Node.js:** Node.js 26.12.1 is up to date.\n");
  const orphan = await run({ tip: "tip" }, false, current);
  assert.deepEqual(
    orphan.calls.filter((c) => !c.startsWith("GET")),
    ["DELETE repos/o/r/git/refs/heads/maintain-kit/node"],
  );
  const dry = await run({ pr, tip: "tip" }, true, current);
  assert.deepEqual(
    dry.calls.filter((c) => !c.startsWith("GET")),
    [],
  );
  assert.deepEqual(dry.logs, [
    "Dry run: would close #4 and delete maintain-kit/node.",
  ]);
  const theirs = await run({ pr, tip: "tip", ours: false }, false, current);
  assert.deepEqual(
    theirs.calls.filter((c) => !c.startsWith("GET")),
    [],
  );
  const none = await run({ tip: null }, false, {
    state: "na",
    reason: "no .nvmrc",
  });
  assert.deepEqual(
    none.calls.filter((c) => !c.startsWith("GET")),
    [],
  );
  const blocked = await run({ tip: null }, true, {
    state: "blocked",
    reason: "bad",
  });
  assert.equal(blocked.summary, "**Node.js:** bad.\n");
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});
