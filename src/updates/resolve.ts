// "Lockfile: resolve": in the checkout of the base commit, the update's edit
// and `pnpm install --lockfile-only`. Nothing is downloaded or unpacked, and
// neither lifecycle scripts nor `.pnpmfile.cjs` run; the pnpm that resolves
// is the one the repo pinned before this update. This step runs caller
// code's package manager in the caller's tree, so it has no token.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { editCatalog, parseCatalog } from "../lib/catalog.ts";
import { Fail, env } from "../lib/env.ts";
import { git, pnpm as runPnpm } from "../lib/exec.ts";
import {
  lockedPackages,
  lockfileVersion,
  pinnedPnpm,
  supportedVersion,
  withoutPnpm,
} from "../lib/lockfile.ts";
import type { LockedPackage } from "../lib/lockfile.ts";
import { byCodePoint } from "../lib/markdown.ts";
import { asRecord, parseYaml } from "../lib/yaml.ts";
import { catalogTitle, readPicks, renderCatalog } from "./catalog.ts";
import type { Picks } from "./catalog.ts";
import { readMeta, updateContext } from "./context.ts";
import type { UpdateContext } from "./context.ts";
import { diagnose } from "./diagnose.ts";
import {
  addFile,
  appendContent,
  appendQueries,
  writeContent,
  writeState,
  writeSummary,
  writeTitle,
} from "./outcome.ts";
import { parsePackageManager } from "./pnpm.ts";
import { FILES } from "./setup.ts";

const INSTALL = [
  "install",
  "--lockfile-only",
  "--no-frozen-lockfile",
  "--ignore-scripts",
  "--ignore-pnpmfile",
];

/** The `git status --porcelain` lines the kind may not produce. */
const unexpected = (status: string, allowed: RegExp): string[] =>
  status.split("\n").filter((l) => l !== "" && !allowed.test(l));

/**
 * A package in `minimumReleaseAgeExclude` or `trustPolicyExclude` skips the
 * guard the pick step checked, so a new version of one is left to a person.
 * Entries are a name, `name@version` or a `*` pattern.
 */
const excludePatterns = (doc: unknown): RegExp[] => {
  const settings = asRecord(doc);
  const lists = ["minimumReleaseAgeExclude", "trustPolicyExclude"].flatMap(
    (key) => {
      const list = settings?.[key];
      return Array.isArray(list) ? (list as unknown[]) : [];
    },
  );
  return lists.map((entry) => {
    const text = String(entry);
    const name = text.replace(/@[^@]*$/, "");
    const pattern = (name === "" ? text : name)
      .replaceAll(/[.+?^$()[\]{}|\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${pattern}$`);
  });
};

/** Up to five `name@version` of the added packages an exclusion covers. */
const excluded = (added: LockedPackage[], patterns: RegExp[]): string[] =>
  [
    ...new Set(
      added
        .filter((a) => patterns.some((p) => p.test(a.name)))
        .map((a) => `${a.name}@${a.version}`),
    ),
  ]
    .sort(byCodePoint)
    .slice(0, 5);

const locked = (text: string, what: string): LockedPackage[] => {
  const docs = parseYaml(text);
  if (!supportedVersion(lockfileVersion(docs))) {
    throw new Fail(`${what} is not lockfile version 6 or 9.`);
  }
  return lockedPackages(docs);
};

const sameBytes = (a: Buffer, b: Buffer): boolean => a.equals(b);

type Edit = {
  allowed: RegExp;
  /** The catalog the workspace file must parse to after the edit. */
  expected: Map<string, string> | null;
  picks: Picks | null;
};

/** The pnpm kind's edit: the new `package.json` in place. */
const editPnpm = (ctx: UpdateContext, dir: string): Edit => {
  if (
    !sameBytes(
      readFileSync(`${dir}/package.json`),
      readFileSync(`${ctx.out}/old/package.json`),
    )
  ) {
    throw new Fail(
      "The checkout's package.json is not the one the update was built from.",
    );
  }
  writeFileSync(
    `${dir}/package.json`,
    readFileSync(`${ctx.out}/new/package.json`),
  );
  return {
    allowed: /^ M (package\.json|pnpm-lock\.yaml)$/,
    expected: null,
    picks: null,
  };
};

const checkCatalog = (yaml: string, expected: Map<string, string>): void => {
  const got = parseCatalog(yaml);
  const same =
    got.size === expected.size &&
    [...expected].every(([k, v]) => got.get(k) === v);
  if (!same) {
    throw new Fail(
      "The catalog in pnpm-workspace.yaml is not the expected one after the edit.",
    );
  }
};

/** The catalog kind's edit: the picked versions on their lines. */
const editWorkspace = (ctx: UpdateContext, dir: string): Edit => {
  const source = readFileSync(`${ctx.src}/${FILES.workspace}`);
  if (!sameBytes(readFileSync(`${dir}/pnpm-workspace.yaml`), source)) {
    throw new Fail("The checkout is not the commit the catalog was read from.");
  }
  const picks = readPicks(ctx.npm);
  const yaml = source.toString("utf8");
  const expected = parseCatalog(yaml);
  for (const k of picks.kept) {
    expected.set(k.name, `${k.prefix}${k.target}`);
  }
  const edited = editCatalog(
    yaml,
    new Map(
      picks.kept.map((k) => [k.name, { current: k.current, target: k.target }]),
    ),
  );
  checkCatalog(edited, expected);
  writeFileSync(`${dir}/pnpm-workspace.yaml`, edited);
  return {
    allowed: /^ M (pnpm-lock|pnpm-workspace)\.yaml$/,
    expected,
    picks,
  };
};

const resolve = async (): Promise<void> => {
  const ctx = updateContext();
  const meta = readMeta(ctx.out);
  const dir = env("CHECKOUT");
  mkdirSync(ctx.npm, { recursive: true });
  const head = (await git(dir, "rev-parse", "HEAD")).stdout.trim();
  if (head !== meta.baseSha) {
    throw new Fail("The checkout is not the commit the files were read from.");
  }
  if (!existsSync(`${dir}/pnpm-lock.yaml`)) {
    // Without a lockfile, the pnpm update is `package.json` alone.
    if (ctx.kind === "catalog") {
      writeState(ctx.out, "na", "no pnpm-lock.yaml");
    }
    return;
  }
  const edit =
    ctx.kind === "pnpm" ? editPnpm(ctx, dir) : editWorkspace(ctx, dir);

  const before = (await git(dir, "show", "HEAD:pnpm-lock.yaml")).stdout;
  const lockedBefore = locked(before, "HEAD:pnpm-lock.yaml");

  // The pnpm that runs must be the one the repo pinned before this update;
  // `pm-on-fail=warn` keeps it from switching to the edited pin.
  const trusted = /^pnpm@([0-9.]+)/.exec(
    (
      JSON.parse((await git(dir, "show", "HEAD:package.json")).stdout) as {
        packageManager?: string;
      }
    ).packageManager ?? "",
  )?.[1];
  const ran = (await runPnpm(dir, "--version")).stdout.trim();
  if (trusted === undefined || ran !== trusted) {
    throw new Fail(
      `pnpm ${ran} would resolve the lockfile, not the pinned ${trusted ?? "null"}.`,
    );
  }
  // CI sets `--frozen-lockfile` by default, so it is turned off here.
  const install = await runPnpm(dir, ...INSTALL);
  const log = `${install.stdout}${install.stderr}`;
  writeFileSync(`${ctx.npm}/pnpm.log`, log);
  process.stdout.write(log);
  if (install.code !== 0) {
    await diagnose(ctx, dir, log);
    throw new Fail(
      `pnpm could not resolve the lockfile for the ${ctx.kind} update (see above and the run summary); the dashboard still lists it.`,
    );
  }
  if (edit.expected !== null) {
    checkCatalog(
      readFileSync(`${dir}/pnpm-workspace.yaml`, "utf8"),
      edit.expected,
    );
  }
  const status = (
    await git(dir, "status", "--porcelain", "--untracked-files=all")
  ).stdout;
  const other = unexpected(status, edit.allowed);
  if (other.length > 0) {
    throw new Fail(
      `Resolving the lockfile changed other files: ${other.join("\n")}`,
    );
  }
  const after = readFileSync(`${dir}/pnpm-lock.yaml`, "utf8");
  const known = new Set(lockedBefore.map((p) => `${p.name}@${p.version}`));
  const added = locked(after, "pnpm-lock.yaml").filter(
    (p) => !known.has(`${p.name}@${p.version}`),
  );

  if (ctx.kind === "pnpm") {
    // A lockfile without the pin stays as it was.
    if (after === before) {
      return;
    }
    const version =
      parsePackageManager(readFileSync(`${dir}/package.json`, "utf8"))
        ?.version ?? "";
    const pinned = pinnedPnpm(parseYaml(after));
    if (pinned !== version) {
      throw new Fail(
        `pnpm-lock.yaml pins pnpm '${pinned}' after resolving, not ${version}.`,
      );
    }
    // The whole lockfile, not only its keys, must be unchanged apart from
    // pnpm's own pin and packages.
    if (
      JSON.stringify(withoutPnpm(parseYaml(before))) !==
      JSON.stringify(withoutPnpm(parseYaml(after)))
    ) {
      throw new Fail(
        `Resolving for pnpm ${version} changed more of pnpm-lock.yaml than pnpm's own entries.`,
      );
    }
    appendQueries(ctx.out, added);
    addFile(ctx.out, "pnpm-lock.yaml", before, after);
    appendContent(ctx.out, [
      "",
      `\`pnpm-lock.yaml\` pins pnpm itself, so it is resolved again: ${added.length} new locked versions of pnpm's own packages, all checked on osv.dev.`,
    ]);
    return;
  }

  const workspace = readFileSync(`${dir}/pnpm-workspace.yaml`, "utf8");
  const left = excluded(added, excludePatterns(parseYaml(workspace)[0]));
  if (left.length > 0) {
    writeState(
      ctx.out,
      "current",
      `the update adds versions that pnpm-workspace.yaml excludes from its cooldown or trust check (${left.join(", ")}); update those by hand`,
    );
    return;
  }
  appendQueries(ctx.out, added);
  addFile(
    ctx.out,
    "pnpm-workspace.yaml",
    readFileSync(`${ctx.src}/${FILES.workspace}`),
    workspace,
  );
  addFile(ctx.out, "pnpm-lock.yaml", before, after);
  const picks = edit.picks ?? readPicks(ctx.npm);
  writeTitle(ctx.out, catalogTitle(picks.kept));
  const rendered = renderCatalog(picks, added, ctx.runsUrl);
  writeSummary(ctx.out, rendered.summary);
  writeContent(ctx.out, rendered.content);
  writeState(ctx.out, "update");
};

export { unexpected, excludePatterns, excluded, resolve };
