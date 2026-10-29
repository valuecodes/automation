// The release-age cutoff, written by a setup step and read by the steps
// after it, so every pick in one run uses the same moment.

import { readFileSync, writeFileSync } from "node:fs";
import { Fail } from "./env.ts";

const writeCutoff = (src: string, minAgeDays: number): number => {
  const cutoff = Math.floor(Date.now() / 1000) - minAgeDays * 86_400;
  writeFileSync(`${src}/cutoff`, `${cutoff}\n`);
  return cutoff;
};

const readCutoff = (src: string): number => {
  const text = readFileSync(`${src}/cutoff`, "utf8").trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new Fail("The cutoff from the setup step is not a number.");
  }
  return Number(text);
};

export { writeCutoff, readCutoff };
