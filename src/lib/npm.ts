// Packuments from the npm registry, saved under `$RUNNER_TEMP/npm` so the
// supply chain step can read what the catalog step downloaded.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchText } from "./http.ts";
import type { Packument } from "./versions.ts";

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const encodeName = (name: string): string => name.replaceAll("/", "%2F");

/** Downloads the full packuments (they carry `time`), six at a time. */
const downloadPackuments = async (
  dir: string,
  names: string[],
): Promise<void> => {
  mkdirSync(dir, { recursive: true });
  const queue = [...names];
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const text = await fetchText(
        `https://registry.npmjs.org/${encodeName(name)}`,
        {
          headers: { accept: "application/json" },
        },
      );
      writeFileSync(`${dir}/${encodeName(name)}.json`, text);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
};

const readPackument = (dir: string, name: string): Packument =>
  JSON.parse(
    readFileSync(`${dir}/${encodeName(name)}.json`, "utf8"),
  ) as Packument;

export { NAME, downloadPackuments, readPackument };
