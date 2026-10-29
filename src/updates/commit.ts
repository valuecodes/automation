// The update as a commit through the API, on the base commit: blobs, a tree
// on the base tree, the commit, and the branch created or moved to it.

import { readFileSync } from "node:fs";
import { Fail } from "../lib/env.ts";
import type { Api } from "../lib/github.ts";
import type { Meta } from "./context.ts";

const modeOk = (mode: string): boolean => /^100(644|755)$/.test(mode);

type TreeEntry = { path?: string; type?: string; sha?: string; mode?: string };

type Update = {
  branch: string;
  /** The branch's current head, or null when it does not exist. */
  tip: string | null;
  paths: string[];
  out: string;
  message: string;
};

/**
 * Pushes the commit and returns its SHA; `holds` when the branch already
 * holds this exact update, `moved` when it moved while this ran. File modes
 * are copied from the base, so an executable script stays executable.
 */
const pushUpdate = async (
  api: Api,
  repo: string,
  meta: Meta,
  update: Update,
): Promise<string> => {
  const { branch, tip, paths, out } = update;
  const treeOf = async (sha: string): Promise<TreeEntry[]> =>
    (await api<{ tree: TreeEntry[] }>("GET", `repos/${repo}/git/trees/${sha}`))
      .tree;
  const baseTree = (
    await api<{ tree: { sha: string } }>(
      "GET",
      `repos/${repo}/git/commits/${meta.baseSha}`,
    )
  ).tree.sha;
  const modeOf = async (path: string): Promise<string | null> => {
    let tree = baseTree;
    const parts = path.split("/");
    const file = parts.pop() ?? "";
    for (const dir of parts) {
      const next = (await treeOf(tree)).find(
        (e) => e.path === dir && e.type === "tree",
      )?.sha;
      if (next === undefined) {
        return null;
      }
      tree = next;
    }
    return (
      (await treeOf(tree)).find((e) => e.path === file && e.type === "blob")
        ?.mode ?? null
    );
  };
  const entries: { path: string; mode: string; type: "blob"; sha: string }[] =
    [];
  for (const path of paths) {
    const mode = await modeOf(path);
    if (mode === null || !modeOk(mode)) {
      throw new Fail(`${path} is not a regular file at ${meta.baseSha}.`);
    }
    const blob = await api<{ sha: string }>("POST", `repos/${repo}/git/blobs`, {
      content: readFileSync(`${out}/new/${path}`).toString("base64"),
      encoding: "base64",
    });
    entries.push({ path, mode, type: "blob", sha: blob.sha });
  }
  const tree = (
    await api<{ sha: string }>("POST", `repos/${repo}/git/trees`, {
      base_tree: baseTree,
      tree: entries,
    })
  ).sha;

  if (tip !== null) {
    const head = await api<{
      tree: { sha: string };
      parents: { sha: string }[];
    }>("GET", `repos/${repo}/git/commits/${tip}`);
    if (
      head.tree.sha === tree &&
      head.parents.map((p) => p.sha).join(" ") === meta.baseSha
    ) {
      return "holds";
    }
  }
  const commit = (
    await api<{ sha: string }>("POST", `repos/${repo}/git/commits`, {
      message: update.message,
      tree,
      parents: [meta.baseSha],
    })
  ).sha;
  if (tip === null) {
    await api("POST", `repos/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit,
    });
    return commit;
  }
  // The REST API cannot update a ref only if it still points where it did,
  // so re-read it right before; a push in between is kept.
  const now = (
    await api<{ object?: { sha?: string } }>(
      "GET",
      `repos/${repo}/git/ref/heads/${branch}`,
    )
  ).object?.sha;
  if (now !== tip) {
    return "moved";
  }
  await api("PATCH", `repos/${repo}/git/refs/heads/${branch}`, {
    sha: commit,
    force: true,
  });
  return commit;
};

export { modeOk, pushUpdate };
