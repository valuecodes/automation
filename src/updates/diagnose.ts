// A failed resolution leaves its evidence in the run summary: what the run
// changed, what pnpm saw, the registry's view of the package pnpm named, and
// whether the unchanged lockfile still resolves here. That last check tells
// a bad update from a bad runner or registry view; it discards the edit, so
// it runs last. Nothing here may fail the step on its own.

import { existsSync, readFileSync } from "node:fs";
import { appendRunnerFile } from "../lib/actions.ts";
import { git, pnpm as runPnpm, run } from "../lib/exec.ts";
import { byCodePoint } from "../lib/markdown.ts";
import { encodeName, packumentUrl } from "../lib/npm.ts";
import { excerpt } from "../lib/redact.ts";
import { request } from "../lib/http.ts";
import type { Packument } from "../lib/versions.ts";
import type { UpdateContext } from "./context.ts";

type Failing = { name: string; spec: string };

const NAME_RE = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const SPEC_RE = /^[0-9A-Za-z.+*^~<>=|:-]{1,64}$/;

/**
 * The package pnpm could not resolve. pnpm wraps its message and prefixes
 * box-drawing characters, so each line loses everything before its first
 * word (byte-wise, as the prefixes are multibyte), the lines are joined and
 * a scope split at `/` is re-joined. The name and spec are untrusted until
 * they match the regexes.
 */
const failingPackage = (log: string): Failing | null => {
  const joined = Buffer.from(log, "utf8")
    .toString("latin1")
    .split("\n")
    .map((l) => l.replace(/^[^A-Za-z0-9@^~<>=*.]*/, ""))
    .join(" ")
    .replaceAll(/\/ +/g, "/");
  const m = /No matching version found for ([^ ]+) /.exec(joined);
  if (m === null) {
    return null;
  }
  const full = m[1] ?? "";
  const at = full.lastIndexOf("@");
  const name = at === -1 ? full : full.slice(0, at);
  const spec = at === -1 ? full : full.slice(at + 1);
  return NAME_RE.test(name) && SPEC_RE.test(spec) ? { name, spec } : null;
};

const tail = (text: string, lines: number): string =>
  text.replace(/\n$/, "").split("\n").slice(-lines).join("\n");

/** What the registry says about the package now. */
const registryView = (pack: Packument, spec: string): string[] => {
  const time = pack.time ?? {};
  const newest = Object.entries(time)
    .filter(([k]) => /^[0-9]/.test(k))
    .sort((a, b) => byCodePoint(a[1], b[1]))
    .slice(-5)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return [
    `dist-tags: ${Object.entries(pack["dist-tags"] ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
    `versions: ${Object.keys(pack.versions ?? {}).length}, time.modified: ${time.modified ?? "null"}`,
    `has versions[${spec}]: ${Object.hasOwn(pack.versions ?? {}, spec)}, has time[${spec}]: ${Object.hasOwn(time, spec)}`,
    `newest by publish time: ${newest}`,
  ];
};

/** What the pick step saw: the entry it picked, to compare with the above. */
const pickView = (pack: Packument, spec: string): string[] => {
  const versions = pack.versions ?? {};
  const time = pack.time ?? {};
  const v = Object.hasOwn(versions, spec) ? versions[spec] : undefined;
  const entry =
    v === undefined
      ? "absent"
      : JSON.stringify({
          time: time[spec] ?? "absent",
          tarball: v.dist?.tarball ?? null,
          integrity: v.dist?.integrity ?? null,
          publisher: v._npmUser ?? null,
          attestations: v.dist?.attestations !== undefined,
        });
  return [
    `  versions: ${Object.keys(versions).length}, has versions[${spec}]: ${Object.hasOwn(versions, spec)}, has time[${spec}]: ${Object.hasOwn(time, spec)}`,
    `  versions[${spec}]: ${entry}`,
  ];
};

const rcKeys = (file: string): string => {
  if (!existsSync(file)) {
    return `${file}: absent`;
  }
  const keys = readFileSync(file, "utf8")
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => l.split("=")[0] ?? "");
  return `${file}: keys ${keys.join(",")}`;
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One titled block of the summary; a failure inside becomes its text. */
const section = async (
  title: string,
  body: () => Promise<string> | string,
): Promise<void> => {
  let text: string;
  try {
    text = await body();
  } catch (error) {
    text = `(failed: ${describe(error)})`;
  }
  appendRunnerFile("GITHUB_STEP_SUMMARY", excerpt(title, text));
};

const both = (r: { stdout: string; stderr: string }): string =>
  `${r.stdout}${r.stderr}`;

const diagnose = async (
  ctx: Pick<UpdateContext, "kind" | "npm">,
  dir: string,
  log: string,
): Promise<void> => {
  appendRunnerFile(
    "GITHUB_STEP_SUMMARY",
    `## Lockfile resolution failed (${ctx.kind})\n`,
  );
  await section(
    "Versions (pnpm, Node.js)",
    async () =>
      both(await runPnpm(dir, "--version")) +
      both(await run("node", ["--version"])),
  );
  if (existsSync(`${ctx.npm}/packuments.log`)) {
    await section(
      "Packument downloads of this run (URL, status, edge, cached object)",
      () => readFileSync(`${ctx.npm}/packuments.log`, "utf8"),
    );
  }
  await section("The update's edit", async () =>
    both(await git(dir, "diff", "--", "pnpm-workspace.yaml", "package.json")),
  );
  await section("pnpm's view of the config", async () =>
    both(await runPnpm(dir, "config", "list")),
  );
  await section("Runner configuration (names only)", () => {
    const names = Object.keys(process.env)
      .filter((n) => /^(npm_config_|NPM_CONFIG_|PNPM_|COREPACK_|NODE_)/.test(n))
      .sort(byCodePoint);
    const home = process.env.HOME ?? "";
    const config = process.env.XDG_CONFIG_HOME ?? `${home}/.config`;
    return [
      ...names,
      rcKeys(`${home}/.npmrc`),
      rcKeys(`${config}/pnpm/rc`),
    ].join("\n");
  });
  const failing = failingPackage(log);
  await section("Registry view of the failing package", async () => {
    if (failing === null) {
      return "pnpm named no package, or its name or spec did not validate";
    }
    const lines = [
      `${failing.name}@${failing.spec} on registry.npmjs.org (not the caller's registry, if it uses another)`,
    ];
    try {
      // One attempt, as curl's `--max-time 60`: this is evidence, not a step.
      const response = await request(
        packumentUrl(failing.name),
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(60_000),
        },
        0,
      );
      for (const h of [
        "date",
        "cf-cache-status",
        "age",
        "last-modified",
        "etag",
        "cf-ray",
      ]) {
        const value = response.headers.get(h);
        if (value !== null) {
          lines.push(`${h}: ${value}`);
        }
      }
      lines.push(
        ...registryView((await response.json()) as Packument, failing.spec),
      );
    } catch {
      lines.push("the packument request failed");
    }
    const saved = `${ctx.npm}/${encodeName(failing.name)}.json`;
    if (existsSync(saved)) {
      lines.push(
        "",
        "the pick step's packument:",
        ...pickView(
          JSON.parse(readFileSync(saved, "utf8")) as Packument,
          failing.spec,
        ),
      );
    }
    return lines.join("\n");
  });
  // Only tracked files can be restored (the pnpm kind runs without a
  // `pnpm-workspace.yaml`), and the control runs only on a verified
  // restore, so it never judges an edited tree. A pass here does not clear
  // the registry either: a satisfied lockfile may skip the very request the
  // update needed.
  const files = ["pnpm-workspace.yaml", "package.json", "pnpm-lock.yaml"];
  await section("Control: the unchanged lockfile", async () => {
    const tracked = (await git(dir, "ls-files", "-z", "--", ...files)).stdout
      .split("\0")
      .filter((f) => f !== "");
    if (tracked.length > 0) {
      await git(dir, "checkout", "--", ...tracked);
    }
    if (
      (await git(dir, "status", "--porcelain", "--", ...files)).stdout !== ""
    ) {
      return "skipped: the update's edit could not be restored";
    }
    const control = await run(
      "pnpm",
      [
        "--config.pm-on-fail=warn",
        "install",
        "--lockfile-only",
        "--no-frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
      ],
      { cwd: dir, timeoutMs: 300_000 },
    );
    const output = both(control);
    return control.code === 0
      ? `resolves on this runner; the update's own requests may still have failed\n${tail(output, 5)}`
      : `fails on this runner too: the runner or its registry view is broken, not only the update\n${tail(output, 40)}`;
  });
  await section("pnpm output", () => log);
};

export { failingPackage, registryView, pickView, diagnose };
