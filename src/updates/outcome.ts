// The files a kind's steps hand to the PR step, under `$OUT`: `state` (the
// state and a reason), and for an update `title` (a plain sentence),
// `content.md`, the changed `paths` with each one's `old/` and `new/`
// content, and optionally `osv-queries.jsonl` and `summary.md` (run summary
// only).

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Fail } from "../lib/env.ts";

const STATES = ["update", "current", "na", "blocked"] as const;
type State = (typeof STATES)[number];

type Outcome = { state: State; reason: string };

type Query = { name: string; version: string };

const writeState = (out: string, state: State, reason = ""): void => {
  const outcome: Outcome = { state, reason };
  writeFileSync(`${out}/state`, JSON.stringify(outcome));
};

const readState = (out: string): Outcome | null => {
  const file = `${out}/state`;
  if (!existsSync(file)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Outcome>;
  const state = parsed.state ?? "";
  if (!(STATES as readonly string[]).includes(state)) {
    throw new Fail(`Unexpected state '${state}' in ${file}.`);
  }
  return { state: state as State, reason: parsed.reason ?? "" };
};

/** Replaces the one occurrence of `from`; a repeated pin is not edited. */
const replaceOnce = (
  text: string,
  from: string,
  to: string,
  what: string,
): string => {
  const parts = text.split(from);
  if (parts.length === 1) {
    throw new Fail(`${what} does not hold ${from}.`);
  }
  if (parts.length > 2) {
    throw new Fail(`${what} holds ${from} more than once.`);
  }
  return parts.join(to);
};

/** Records a changed file: its content before and after, and its path. */
const addFile = (
  out: string,
  path: string,
  before: Buffer | string,
  after: Buffer | string,
): void => {
  for (const [dir, content] of [
    ["old", before],
    ["new", after],
  ] as const) {
    mkdirSync(dirname(`${out}/${dir}/${path}`), { recursive: true });
    writeFileSync(`${out}/${dir}/${path}`, content);
  }
  appendFileSync(`${out}/paths`, `${path}\n`);
};

const readPaths = (out: string): string[] =>
  readFileSync(`${out}/paths`, "utf8")
    .split("\n")
    .filter((l) => l !== "");

const writeTitle = (out: string, title: string): void => {
  writeFileSync(`${out}/title`, `${title}\n`);
};

const readTitle = (out: string): string =>
  readFileSync(`${out}/title`, "utf8").replace(/\n+$/, "");

const writeContent = (out: string, lines: string[]): void => {
  writeFileSync(`${out}/content.md`, `${lines.join("\n")}\n`);
};

const appendContent = (out: string, lines: string[]): void => {
  appendFileSync(`${out}/content.md`, `${lines.join("\n")}\n`);
};

/** The content without trailing newlines, as the shell's `$(< file)`. */
const readContent = (out: string): string =>
  readFileSync(`${out}/content.md`, "utf8").replace(/\n+$/, "");

const appendQueries = (out: string, queries: Query[]): void => {
  appendFileSync(
    `${out}/osv-queries.jsonl`,
    queries.map((q) => `${JSON.stringify(q)}\n`).join(""),
  );
};

const readQueries = (out: string): Query[] => {
  const file = `${out}/osv-queries.jsonl`;
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Query);
};

const writeSummary = (out: string, lines: string[]): void => {
  writeFileSync(`${out}/summary.md`, `${lines.join("\n")}\n`);
};

const readSummary = (out: string): string | null => {
  const file = `${out}/summary.md`;
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

export {
  writeState,
  readState,
  replaceOnce,
  addFile,
  readPaths,
  writeTitle,
  readTitle,
  writeContent,
  appendContent,
  readContent,
  appendQueries,
  readQueries,
  writeSummary,
  readSummary,
};
export type { Outcome, Query };
