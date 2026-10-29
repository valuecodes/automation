// Workflow commands and files of the runner. Messages go to stdout as
// `::error::` and `::warning::` lines, which the Actions UI turns into
// annotations; locally they are just lines.

import { appendFileSync } from "node:fs";

const error = (message: string): void => {
  console.log(`::error::${message}`);
};

const warning = (message: string): void => {
  console.log(`::warning::${message}`);
};

/** Appends to one of the files the runner names in the environment. */
const appendRunnerFile = (name: string, text: string): void => {
  const file = process.env[name];
  if (file === undefined) {
    throw new Error(`${name} is not set.`);
  }
  appendFileSync(file, text);
};

export { error, warning, appendRunnerFile };
