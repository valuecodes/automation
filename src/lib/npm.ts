// Packuments from the npm registry, saved under `$RUNNER_TEMP/npm` so the
// supply chain step can read what the catalog step downloaded, and the
// second question every pick has to pass: can pnpm resolve this version? A
// full packument is one cached object, and one has listed a version the
// registry never had, so no version is used on its word alone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "./http.ts";
import type { Packument } from "./versions.ts";

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const REGISTRY = "https://registry.npmjs.org";

/** The abbreviated packument, the document pnpm resolves from. */
const ABBREVIATED = "application/vnd.npm.install-v1+json";

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
 * Whether pnpm can resolve this exact version: whether the abbreviated
 * packument, the document pnpm asks the registry for and a different cached
 * object than the full one the version was picked from, lists it. Any
 * failure of the request is an outage and propagates.
 */
const resolvable = async (
  name: string,
  version: string,
  get: Get = request,
): Promise<boolean> => {
  const response = await get(`${REGISTRY}/${encodeName(name)}`, {
    headers: { accept: ABBREVIATED },
  });
  const body = (await response.json()) as {
    versions?: Record<string, unknown>;
  };
  return Object.hasOwn(body.versions ?? {}, version);
};

export { NAME, downloadPackuments, readPackument, resolvable };
