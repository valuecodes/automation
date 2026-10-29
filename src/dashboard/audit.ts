// The audit job's two steps, run in the caller's checkout: "List the locked
// packages" (is this a pnpm project, and every registry package in its
// lockfile, for the osv.dev check in the other job) and "Run pnpm audit".
// They write `$RUNNER_TEMP/audit/`, which the job uploads for the sections.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendRunnerFile, warning } from "../lib/actions.ts";
import { env } from "../lib/env.ts";
import { run } from "../lib/exec.ts";
import {
  lockfileEntries,
  lockfileVersion,
  supportedVersion,
} from "../lib/lockfile.ts";
import { parseYaml } from "../lib/yaml.ts";

const auditDir = (): string => {
  const dir = `${env("RUNNER_TEMP")}/audit`;
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Why `package.json` is not a pnpm project, or null when it is one. */
const notPnpm = (packageJson: string | null): string | null => {
  if (packageJson === null) {
    return "package.json has no pnpm packageManager";
  }
  const parsed = JSON.parse(packageJson) as { packageManager?: unknown };
  return typeof parsed.packageManager === "string" &&
    parsed.packageManager.startsWith("pnpm@")
    ? null
    : "package.json has no pnpm packageManager";
};

const lockfile = (): void => {
  const dir = auditDir();
  if (!existsSync("pnpm-lock.yaml")) {
    writeFileSync(`${dir}/status`, "skipped: no pnpm-lock.yaml\n");
    return;
  }
  const why = notPnpm(
    existsSync("package.json") ? readFileSync("package.json", "utf8") : null,
  );
  if (why !== null) {
    writeFileSync(`${dir}/status`, `skipped: ${why}\n`);
    return;
  }
  appendRunnerFile("GITHUB_OUTPUT", "pnpm=true\n");
  const docs = parseYaml(readFileSync("pnpm-lock.yaml", "utf8"));
  const version = lockfileVersion(docs);
  if (!supportedVersion(version)) {
    writeFileSync(
      `${dir}/packages.status`,
      `lockfileVersion ${version} is not supported\n`,
    );
    return;
  }
  writeFileSync(`${dir}/packages.json`, JSON.stringify(lockfileEntries(docs)));
};

const audit = async (): Promise<void> => {
  const dir = auditDir();
  // Exit 1 with valid JSON means findings; anything else is a failed audit.
  const result = await run("pnpm", ["audit", "--json", "--ignore-pnpmfile"]);
  writeFileSync(`${dir}/audit.json`, result.stdout);
  writeFileSync(`${dir}/stderr`, result.stderr);
  let valid = false;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    valid =
      typeof parsed === "object" && parsed !== null && "advisories" in parsed;
  } catch {
    valid = false;
  }
  if (result.code > 1 || !valid) {
    writeFileSync(
      `${dir}/status`,
      `failed: pnpm audit exited with ${result.code}\n`,
    );
    warning(`pnpm audit failed (exit ${result.code}).`);
    process.stdout.write(result.stderr);
    return;
  }
  writeFileSync(`${dir}/status`, "ok\n");
};

export { notPnpm, lockfile, audit };
