// `pnpm-lock.yaml` as the checks read it: its version, the registry packages
// it locks (for osv.dev), the pnpm it pins, and the lockfile without pnpm's
// own entries (what a pnpm update may not change). pnpm 12 writes several
// YAML documents (the package manager's own dependencies, then the project),
// so every function takes them all.

import { NAME } from "./npm.ts";
import { byCodePoint } from "./markdown.ts";
import { asRecord } from "./yaml.ts";

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/;

type LockedPackage = { name: string; version: string };

type LockfileEntry = LockedPackage | { skipped: string };

const lockfileVersion = (docs: unknown[]): string => {
  const version = asRecord(docs[0])?.lockfileVersion;
  return typeof version === "string" || typeof version === "number"
    ? String(version)
    : "null";
};

const supportedVersion = (version: string): boolean =>
  /^[69]\.[0-9]+$/.test(version);

const isSkipped = (entry: LockfileEntry): entry is { skipped: string } =>
  "skipped" in entry;

/**
 * Every `packages:` key of every document, as a package or a skipped key.
 * v6 keys are `/name@1.2.3`, v9 keys `name@1.2.3(peer@x)`. Git and tarball
 * entries have no registry version, so they are only counted.
 */
const lockfileEntries = (docs: unknown[]): LockfileEntry[] => {
  const seen = new Set<string>();
  const out: LockfileEntry[] = [];
  for (const doc of docs) {
    const packages = asRecord(asRecord(doc)?.packages) ?? {};
    for (const key of Object.keys(packages)) {
      const bare = key.replace(/^\//, "").replace(/\(.*$/, "");
      const m = /^(.+)@([^@]+)$/.exec(bare);
      const name = m?.[1] ?? "";
      const version = m?.[2] ?? "";
      const entry: LockfileEntry =
        NAME.test(name) && VERSION.test(version)
          ? { name, version }
          : { skipped: key };
      const id = JSON.stringify(entry);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(entry);
      }
    }
  }
  return out.sort((a, b) => {
    if (isSkipped(a) || isSkipped(b)) {
      if (isSkipped(a) && isSkipped(b)) {
        return byCodePoint(a.skipped, b.skipped);
      }
      return isSkipped(a) ? 1 : -1;
    }
    return byCodePoint(a.name, b.name) || byCodePoint(a.version, b.version);
  });
};

const lockedPackages = (docs: unknown[]): LockedPackage[] =>
  lockfileEntries(docs).filter((e): e is LockedPackage => !isSkipped(e));

/** The pnpm version the project's importer pins, or an empty string. */
const pinnedPnpm = (docs: unknown[]): string => {
  const importers = asRecord(asRecord(docs[0])?.importers);
  const deps = asRecord(asRecord(importers?.["."])?.packageManagerDependencies);
  const version = asRecord(deps?.pnpm)?.version;
  return typeof version === "string" || typeof version === "number"
    ? String(version)
    : "";
};

const mine = (key: string): boolean => /^\/?(pnpm|@pnpm\/[^@/]+)@/.test(key);

/** The documents without pnpm's own pin, packages and snapshots. */
const withoutPnpm = (docs: unknown[]): unknown[] =>
  docs.map((original) => {
    const doc = asRecord(structuredClone(original));
    if (doc === null) {
      return original;
    }
    const dot = asRecord(asRecord(doc.importers)?.["."]);
    if (dot !== null) {
      delete dot.packageManagerDependencies;
    }
    for (const section of ["packages", "snapshots"]) {
      const entries = asRecord(doc[section]);
      if (entries !== null) {
        for (const key of Object.keys(entries)) {
          if (mine(key)) {
            delete entries[key];
          }
        }
      }
    }
    return doc;
  });

export {
  lockfileVersion,
  supportedVersion,
  lockfileEntries,
  lockedPackages,
  pinnedPnpm,
  withoutPnpm,
};
export type { LockedPackage };
