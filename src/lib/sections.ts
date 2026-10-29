// Each section step writes `$SECTIONS/NN-name.md` and a one-line
// `NN-name.status` (`state<TAB>status<TAB>details`) for the summary table.
// Both land through a rename, so a step that dies halfway leaves no partial
// fragment behind and the last step counts it as failed.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const STATES = ["ok", "na", "update", "warn", "alert", "failed"] as const;
type State = (typeof STATES)[number];

type Status = {
  state: State;
  text: string;
  details: string;
};

const isState = (value: string): value is State =>
  (STATES as readonly string[]).includes(value);

const formatStatus = (status: Status): string =>
  `${status.state}\t${status.text}\t${status.details}\n`;

const parseStatus = (line: string): Status | null => {
  const [state = "", text = "", details = ""] = line
    .replace(/\n$/, "")
    .split("\t");
  return isState(state) ? { state, text, details } : null;
};

const readStatus = (dir: string, id: string): Status | null => {
  try {
    return parseStatus(readFileSync(`${dir}/${id}.status`, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Writes the fragment and, when given, the status. The fragment alone with
 * no status means the check is disabled and gets no row.
 */
const writeSection = (
  dir: string,
  id: string,
  markdown: string,
  status: Status | null,
): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${id}.md.tmp`, markdown);
  if (status !== null) {
    writeFileSync(`${dir}/${id}.status.tmp`, formatStatus(status));
    renameSync(`${dir}/${id}.status.tmp`, `${dir}/${id}.status`);
  }
  renameSync(`${dir}/${id}.md.tmp`, `${dir}/${id}.md`);
};

/** Marks a check as failed for the last step, which reports and exits 1. */
const markFailed = (dir: string, id: string): void => {
  writeFileSync(`${dir}/${id}.failed`, "");
};

export { parseStatus, readStatus, writeSection, markFailed };
export type { State, Status };
