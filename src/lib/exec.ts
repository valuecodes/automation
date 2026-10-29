// Tools the steps run: `git`, `pnpm` and `diff`, as argument lists with no
// shell. A non-zero exit is a result, not an error, since the callers decide
// what it means; a tool that cannot start at all throws.

import { execFile } from "node:child_process";

type Result = { code: number; stdout: string; stderr: string };

type Options = { cwd?: string; timeoutMs?: number };

/** Exit code 124 stands for a timeout, as with `timeout(1)`. */
const run = (
  file: string,
  args: string[],
  options: Options = {},
): Promise<Result> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeout: options.timeoutMs }),
        // Node's default of 1 MiB would kill a verbose `pnpm install`.
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const failure = error as NodeJS.ErrnoException & { killed?: boolean };
        if (typeof failure.code === "number") {
          resolve({ code: failure.code, stdout, stderr });
        } else if (failure.killed === true) {
          resolve({
            code: 124,
            stdout,
            stderr: `${stderr}\n${file} timed out\n`,
          });
        } else {
          reject(new Error(`${file} could not run: ${failure.message}`));
        }
      },
    );
  });

const git = (cwd: string, ...args: string[]): Promise<Result> =>
  run("git", args, { cwd });

/**
 * pnpm with `pm-on-fail=warn`: it would otherwise switch to the version in
 * `packageManager` and run it, which is the version under test.
 */
const pnpm = (cwd: string, ...args: string[]): Promise<Result> =>
  run("pnpm", ["--config.pm-on-fail=warn", ...args], { cwd });

export { run, git, pnpm };
