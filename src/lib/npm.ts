// Packuments from the npm registry, saved under `$RUNNER_TEMP/npm` so the
// supply chain step can read what the catalog step downloaded, and the
// second question every pick has to pass: does the registry serve this
// version at all? A packument is one cached object, and one has listed a
// version the registry never had, so no version is used on its word alone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HttpError, request } from "./http.ts";
import type { Packument } from "./versions.ts";

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const REGISTRY = "https://registry.npmjs.org";

const encodeName = (name: string): string => name.replaceAll("/", "%2F");

/**
 * Which edge answered and which cached object it served: the evidence a
 * stale packument leaves behind, so the job log names it next time.
 */
const served = (response: Response): string =>
  ["cf-ray", "cf-cache-status", "age", "etag"]
    .map((header) => `${header}=${response.headers.get(header) ?? "-"}`)
    .join(" ");

/** Downloads the full packuments (they carry `time`), six at a time. */
const downloadPackuments = async (
  dir: string,
  names: string[],
): Promise<void> => {
  mkdirSync(dir, { recursive: true });
  const queue = [...names];
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const response = await request(`${REGISTRY}/${encodeName(name)}`, {
        headers: { accept: "application/json" },
      });
      console.log(`${name}: HTTP ${response.status} ${served(response)}`);
      writeFileSync(`${dir}/${encodeName(name)}.json`, await response.text());
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
};

const readPackument = (dir: string, name: string): Packument =>
  JSON.parse(
    readFileSync(`${dir}/${encodeName(name)}.json`, "utf8"),
  ) as Packument;

type Get = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Whether the registry serves this exact version, asked of its version
 * endpoint: a different URL and so a different cached object than the
 * packument the version was picked from. A 404 is "no"; any other failure
 * is an outage and propagates.
 */
const versionExists = async (
  name: string,
  version: string,
  get: Get = request,
): Promise<boolean> => {
  try {
    const response = await get(`${REGISTRY}/${encodeName(name)}/${version}`, {
      headers: { accept: "application/json" },
    });
    const body = (await response.json()) as { version?: unknown };
    return body.version === version;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return false;
    }
    throw error;
  }
};

export { NAME, downloadPackuments, readPackument, versionExists };
