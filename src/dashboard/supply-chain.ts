// "Section: supply chain": two checks against public APIs that need no
// token. Malicious packages: every locked version plus the catalog's update
// candidates against the OpenSSF malicious-packages feed on osv.dev. Update
// signals: what the packument says about each candidate that hints at a
// hijacked account. Runs after the catalog step because it reuses its rows
// and downloaded packuments.

import { existsSync, readFileSync } from "node:fs";
import { Fail, context } from "../lib/env.ts";
import { byCodePoint, esc, plural } from "../lib/markdown.ts";
import { readPackument } from "../lib/npm.ts";
import { queryMalicious } from "../lib/osv.ts";
import { readStatus, writeSection } from "../lib/sections.ts";
import type { Status } from "../lib/sections.ts";
import { signalRow, signals } from "../lib/signals.ts";
import { ID as CATALOG, isUnparsed } from "./catalog.ts";
import type { Row } from "./catalog.ts";
import { requireSetup } from "./setup.ts";

const ID = "15-supply-chain";

const present = (value: unknown): boolean =>
  value !== undefined && value !== null;

type Candidate = {
  name: string;
  current: string;
  version: string;
};

type Hit = {
  name: string;
  version: string;
  where: string;
  id: string;
};

type LockedPackage = {
  name?: string;
  version?: string;
  skipped?: string;
};

const sortHits = (hits: Hit[]): Hit[] =>
  [...hits].sort(
    (a, b) =>
      byCodePoint(a.name, b.name) ||
      byCodePoint(a.version, b.version) ||
      byCodePoint(a.where, b.where) ||
      byCodePoint(a.id, b.id),
  );

/** Up to three names of the hits, of the locked ones only with `locked`. */
const hitNames = (hits: Hit[], which: "all" | "locked"): string => {
  const names = [
    ...new Set(
      hits
        .filter((h) => which !== "locked" || h.where !== "update candidate")
        .map((h) => h.name),
    ),
  ];
  return esc(names.sort(byCodePoint).slice(0, 3).join(", "));
};

type Input = {
  catalogStatus: Status | null;
  candidates: Candidate[];
  lockNote: string;
  locked: number;
  skipped: number;
  hits: Hit[];
  /** Table rows of the candidates with signals. */
  flagged: string[];
};

type Rendered = {
  markdown: string;
  status: Status;
};

const render = (input: Input): Rendered => {
  const { candidates, lockNote, locked, skipped, flagged } = input;
  const hits = sortHits(input.hits);
  const lockedHits = hits.filter((h) => h.where !== "update candidate").length;
  let lockCoverage = "";
  if (lockNote === "") {
    lockCoverage = plural(locked, "locked package");
    if (skipped === 1) {
      lockCoverage += " (1 git or tarball entry not checked)";
    } else if (skipped > 1) {
      lockCoverage += ` (${skipped} git or tarball entries not checked)`;
    }
  }
  let coverage = lockCoverage;
  if (candidates.length > 0) {
    coverage = `${coverage ? `${coverage} and ` : ""}${plural(candidates.length, "update candidate")}`;
  }
  const notChecked = lockNote ? ` (lockfile not checked: ${lockNote})` : "";
  const out: string[] = [];
  if (coverage === "") {
    out.push(`**Malicious packages (osv.dev):** not applicable, ${lockNote}.`);
  } else if (hits.length === 0) {
    out.push(
      `**Malicious packages (osv.dev):** none of the ${coverage} is in the OpenSSF malicious-packages database${notChecked}.`,
    );
  } else {
    const advice =
      lockedHits > 0
        ? "Remove them before anything else."
        : "Do not update to them.";
    out.push(
      "### Malicious packages (osv.dev)",
      "",
      `${hits.length} of the ${coverage} are in the OpenSSF malicious-packages database${notChecked}. ${advice}`,
      "",
      "| Package | Version | Where | Advisory |",
      "| --- | --- | --- | --- |",
      ...hits.map(
        (h) =>
          `| 🟥 \`${esc(h.name)}\` | ${esc(h.version)} | ${h.where} | [${h.id}](https://osv.dev/vulnerability/${h.id}) |`,
      ),
    );
  }

  let signalsText: string;
  if (input.catalogStatus?.state === "na") {
    signalsText = `update signals not applicable, ${input.catalogStatus.details}`;
  } else if (candidates.length === 0) {
    signalsText = "no pending catalog updates to check for signals";
  } else {
    signalsText = `no signals on the ${plural(candidates.length, "update candidate")}`;
  }
  // With nothing found, one line says it all; a table only when there is
  // something to show. The summary table has the count, so the line only
  // names the source.
  let markdown: string;
  if (hits.length === 0 && flagged.length === 0) {
    markdown =
      coverage === ""
        ? `**Supply chain:** not applicable, ${lockNote}; ${signalsText}.\n`
        : `**Supply chain:** no hits in the OpenSSF malicious-packages database (osv.dev)${lockNote ? `; lockfile not checked: ${lockNote}` : ""}; ${signalsText}.\n`;
  } else if (flagged.length === 0) {
    markdown = `${out.join("\n")}\n\n**Update signals:** ${signalsText}.\n`;
  } else {
    markdown = `${[
      ...out,
      "",
      "### Update signals (npm registry)",
      "",
      `${flagged.length} of the ${plural(candidates.length, "update candidate")} carry a signal worth a look before updating.`,
      "",
      "| Package | Update | Signals |",
      "| --- | --- | --- |",
      ...flagged,
    ].join("\n")}\n`;
  }

  // A malicious version in the lockfile is installed, so it is an alert. One
  // that is only an update candidate is not installed yet: the issue says
  // not to update, and the last step still fails the run. The status text
  // starts with "malicious" in both cases; the last step relies on that.
  let status: Status;
  if (lockedHits > 0) {
    status = {
      state: "alert",
      text: `malicious: ${plural(hits.length, "package")}`,
      details: `${plural(lockedHits, "malicious package")} in pnpm-lock.yaml: ${hitNames(hits, "locked")}`,
    };
  } else if (hits.length > 0) {
    status = {
      state: "warn",
      text: `malicious: ${plural(hits.length, "update candidate")}`,
      details: `do not update ${hitNames(hits, "all")}`,
    };
  } else if (flagged.length > 0) {
    status = {
      state: "warn",
      text: "update signals",
      details: `${flagged.length} of ${plural(candidates.length, "update")} with signals`,
    };
  } else if (coverage === "") {
    status = { state: "na", text: "not applicable", details: lockNote };
  } else {
    status = {
      state: "ok",
      text: "no findings",
      details: `${lockCoverage || coverage} checked`,
    };
  }
  return { markdown, status };
};

const supplyChain = async (): Promise<void> => {
  const ctx = context();
  requireSetup(ctx.src);

  // The catalog step's status says whether update candidates exist; a failed
  // catalog check leaves them unknown, so this check fails too instead of
  // reporting a clean result it could not verify.
  const catalogStatus = readStatus(ctx.sections, CATALOG);
  const candidates: Candidate[] = [];
  switch (catalogStatus?.state) {
    case "na": {
      break;
    }
    case "ok":
    case "update":
    case "warn": {
      const rows = JSON.parse(
        readFileSync(`${ctx.npm}/rows.json`, "utf8"),
      ) as Row[];
      for (const row of rows) {
        if (isUnparsed(row)) {
          continue;
        }
        for (const version of [row.inMajor, row.major]) {
          if (version !== null) {
            candidates.push({ name: row.name, current: row.current, version });
          }
        }
      }
      break;
    }
    case "alert":
    case "failed":
    case undefined: {
      throw new Fail(
        "The dependencies check failed, so the update candidates are unknown.",
      );
    }
  }

  // Locked packages come from the audit job; "skipped" entries are git and
  // tarball dependencies, which have no registry version to look up.
  if (!existsSync(`${ctx.audit}/status`)) {
    throw new Fail("The audit job produced no result.");
  }
  const auditStatus = readFileSync(`${ctx.audit}/status`, "utf8").trim();
  let lockNote = "";
  let locked = 0;
  let skipped = 0;
  const queries: { name: string; version: string; where: string }[] = [];
  if (auditStatus.startsWith("skipped: ")) {
    lockNote = auditStatus.slice("skipped: ".length);
  } else if (existsSync(`${ctx.audit}/packages.status`)) {
    lockNote = readFileSync(`${ctx.audit}/packages.status`, "utf8").trim();
  } else if (!existsSync(`${ctx.audit}/packages.json`)) {
    throw new Fail("The audit job produced no package list.");
  } else {
    const packages = JSON.parse(
      readFileSync(`${ctx.audit}/packages.json`, "utf8"),
    ) as LockedPackage[];
    for (const p of packages) {
      if (present(p.skipped)) {
        skipped += 1;
      } else {
        queries.push({
          name: p.name ?? "",
          version: p.version ?? "",
          where: "`pnpm-lock.yaml`",
        });
      }
    }
    locked = queries.length;
  }
  for (const c of candidates) {
    queries.push({
      name: c.name,
      version: c.version,
      where: "update candidate",
    });
  }
  const unique = [
    ...new Map(queries.map((q) => [JSON.stringify(q), q])).values(),
  ];
  const malicious = await queryMalicious(unique);
  const hits: Hit[] = [];
  for (const [index, ids] of malicious) {
    const q = unique[index];
    if (q === undefined) {
      continue;
    }
    for (const id of ids) {
      hits.push({ name: q.name, version: q.version, where: q.where, id });
    }
  }

  const flagged: string[] = [];
  for (const c of candidates) {
    const found = signals(readPackument(ctx.npm, c.name), c.current, c.version);
    if (found.length > 0) {
      flagged.push(signalRow(c.name, c.current, c.version, found));
    }
  }
  const rendered = render({
    catalogStatus,
    candidates,
    lockNote,
    locked,
    skipped,
    hits,
    flagged,
  });
  writeSection(ctx.sections, ID, rendered.markdown, rendered.status);
};

export { hitNames, render, supplyChain };
export type { Hit };
