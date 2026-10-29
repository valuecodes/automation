// Packuments from the npm registry, saved under `$RUNNER_TEMP/npm` so a later
// step can read what an earlier one downloaded.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Fail } from "./env.ts";
import { request } from "./http.ts";
import type { Packument } from "./versions.ts";

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const encodeName = (name: string): string => name.replaceAll("/", "%2F");

const packumentUrl = (name: string): string =>
  `https://registry.npmjs.org/${encodeName(name)}`;

/**
 * Downloads the full packuments (they carry `time`), six at a time. One line
 * per download in `packuments.log` names the edge and the cached object it
 * served, so a wrong pick can be traced to what the registry answered.
 */
const downloadPackuments = async (
  dir: string,
  names: string[],
): Promise<string[]> => {
  mkdirSync(dir, { recursive: true });
  const queue = [...names];
  const log: string[] = [];
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const url = packumentUrl(name);
      const response = await request(url, {
        headers: { accept: "application/json" },
      });
      const h = (header: string): string => response.headers.get(header) ?? "";
      log.push(
        `${url} ${response.status} cf-ray=${h("cf-ray")} cf-cache-status=${h("cf-cache-status")} age=${h("age")} etag=${h("etag")}`,
      );
      writeFileSync(`${dir}/${encodeName(name)}.json`, await response.text());
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  writeFileSync(`${dir}/packuments.log`, log.map((l) => `${l}\n`).join(""));
  return log;
};

/**
 * The saved packument of `name`. It must be the packument of the package it
 * is named after, or every pick would read the wrong package's versions.
 */
const readPackument = (dir: string, name: string): Packument => {
  const pack = JSON.parse(
    readFileSync(`${dir}/${encodeName(name)}.json`, "utf8"),
  ) as Packument;
  if (pack.name !== name) {
    throw new Fail(
      `The packument saved for ${name} is for '${pack.name ?? ""}'.`,
    );
  }
  return pack;
};

export { NAME, downloadPackuments, readPackument };
