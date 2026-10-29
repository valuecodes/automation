// "gitleaks: find the update": the `GITLEAKS_VERSION` pin in the secrets
// script against the GitHub releases on the current major, and the
// container digest next to it, when the script pins one.

import { existsSync, readFileSync } from "node:fs";
import { readCutoff } from "../lib/cutoff.ts";
import { Fail } from "../lib/env.ts";
import { DIGEST_LINE, VERSION_LINE, newest } from "../lib/gitleaks.ts";
import type { Release } from "../lib/gitleaks.ts";
import { api as githubApi } from "../lib/github.ts";
import type { Api } from "../lib/github.ts";
import { fetchJson, request } from "../lib/http.ts";
import { updateContext, validateGitleaksScript } from "./context.ts";
import {
  addFile,
  replaceOnce,
  writeContent,
  writeState,
  writeTitle,
} from "./outcome.ts";
import { FILES } from "./setup.ts";

type Digest = { old: string; new: string };

const edit = (
  script: string,
  current: string,
  version: string,
  digest: Digest | null,
): string => {
  let out = replaceOnce(
    script,
    `GITLEAKS_VERSION="${current}"`,
    `GITLEAKS_VERSION="${version}"`,
    "the script",
  );
  if (digest !== null) {
    out = replaceOnce(
      out,
      `GITLEAKS_DIGEST="${digest.old}"`,
      `GITLEAKS_DIGEST="${digest.new}"`,
      "the script",
    );
  }
  return out;
};

type Rendered = { title: string; content: string[] };

const render = (
  current: string,
  version: string,
  date: string,
  digest: boolean,
): Rendered => {
  const content = [
    "| Package | Current | Update | Released |",
    "| --- | --- | --- | --- |",
    `| gitleaks | ${current} | ${version} | ${date} |`,
    "",
    `Release notes: [v${version}](https://github.com/gitleaks/gitleaks/releases/tag/v${version}).`,
  ];
  if (digest) {
    content.push(
      `\`GITLEAKS_DIGEST\` is the digest ghcr.io serves for \`gitleaks:v${version}\`.`,
    );
  }
  return { title: `Update gitleaks to ${version}`, content };
};

/**
 * Scripts that run the container pin its digest next to the version, so a
 * re-pushed tag cannot change what runs. The new digest is the one ghcr.io
 * serves for the new tag, read anonymously.
 */
const manifestDigest = async (version: string): Promise<string> => {
  const { token } = await fetchJson<{ token?: string }>(
    "https://ghcr.io/token?scope=repository:gitleaks/gitleaks:pull",
  );
  const response = await request(
    `https://ghcr.io/v2/gitleaks/gitleaks/manifests/v${version}`,
    {
      method: "HEAD",
      headers: {
        authorization: `Bearer ${token ?? ""}`,
        accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
    },
  );
  const digest = response.headers.get("docker-content-digest") ?? "";
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Fail(`ghcr.io returned no digest for gitleaks v${version}.`);
  }
  return digest;
};

const gitleaks = async (api: Api = githubApi): Promise<void> => {
  const ctx = updateContext();
  if (ctx.gitleaksScript === "") {
    writeState(ctx.out, "na", "gitleaks-script is empty");
    return;
  }
  // The path lands in local paths and the PR tree; checked in setup, and
  // again here, since this is where it is used.
  const invalid = validateGitleaksScript(ctx.gitleaksScript);
  if (invalid !== null) {
    throw new Fail(invalid);
  }
  const file = `${ctx.src}/${FILES.gitleaksScript}`;
  if (!existsSync(file)) {
    writeState(ctx.out, "na", `${ctx.gitleaksScript} is not in the repo`);
    return;
  }
  const script = readFileSync(file, "utf8");
  const current = VERSION_LINE.exec(script)?.[1];
  if (current === undefined) {
    throw new Fail(
      `${ctx.gitleaksScript} has no GITLEAKS_VERSION="x.y.z" line.`,
    );
  }
  const releases = await api<Release[]>(
    "GET",
    "repos/gitleaks/gitleaks/releases?per_page=100",
  );
  const found = newest(releases, current, readCutoff(ctx.src), {
    sameMajor: true,
  });
  if (found === null) {
    writeState(ctx.out, "current", `gitleaks ${current} is up to date`);
    return;
  }
  const oldDigest = DIGEST_LINE.exec(script)?.[1];
  const digest =
    oldDigest === undefined
      ? null
      : { old: oldDigest, new: await manifestDigest(found.version) };
  addFile(
    ctx.out,
    ctx.gitleaksScript,
    script,
    edit(script, current, found.version, digest),
  );
  const rendered = render(current, found.version, found.date, digest !== null);
  writeTitle(ctx.out, rendered.title);
  writeContent(ctx.out, rendered.content);
  writeState(ctx.out, "update");
};

export { edit, render, gitleaks };
