# AGENTS.md

Guidelines for AI agents and contributors working in this repo.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

Reusable GitHub Actions workflows that other repos call with
`uses: valuecodes/automation/.github/workflows/<file>@<full-commit-sha>`.

| Path                                          | What                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| `.github/workflows/maintenance-dashboard.yml` | Reusable: keeps the **Maintenance dashboard** issue        |
| `.github/workflows/maintenance-updates.yml`   | Reusable: one update PR per kind (Node.js, pnpm, …)        |
| `.github/workflows/workflow-lint.yml`         | Reusable: actionlint and zizmor over workflow files        |
| `.github/workflows/ci.yml`                    | This repo's CI: oxfmt, oxlint, tsc, tests, knip, reusables |
| `.github/actions/setup/`                      | Composite setup action: pnpm, Node.js, frozen install      |
| `src/dashboard/`                              | The dashboard's steps, one TypeScript module per step      |
| `src/lib/`                                    | Shared: GitHub and registry calls, versions, sections      |
| `.github/dependabot.yml`                      | Monthly grouped bumps of the SHA-pinned actions            |
| `scripts/dashboard-dry-run.sh`                | Runs the dashboard's steps locally, prints the body        |
| `scripts/updates-dry-run.sh`                  | Runs the update steps locally, prints the planned PRs      |

`README.md` is the user-facing doc for each reusable workflow: what it does, a flowchart of
how a run decides, and the caller snippet. Keep it in step with the workflow.

---

## Commands

**Prerequisites:** Node.js 26 (exact version in `.nvmrc`), pnpm 12 (exact version in
`packageManager` in `package.json`).

```bash
pnpm install                     # Install the dev tools, enable the git hooks
pnpm lint                        # oxlint (type-aware) over src/
pnpm knip                        # unused files, exports and dependencies
pnpm typecheck                   # tsc --noEmit over src/
pnpm test                        # node --test over src/**/*.test.ts
pnpm format                      # oxfmt, writes in place
pnpm format:check                # oxfmt --check (no writes)
scripts/dashboard-dry-run.sh     # The dashboard body for this repo, or `owner/repo sha dir`
scripts/updates-dry-run.sh       # The planned update PRs for this repo, or `owner/repo [kind...]`
```

`scripts/updates-dry-run.sh` does the same for `maintenance-updates.yml`: it runs each kind's
steps against the head of the repo's default branch on GitHub, with dry-run on (nothing pushed,
no PR touched), and prints the PR each kind would open or why it opens none. For the catalog
kind it fetches that commit into `tmp/updates/` and resolves the lockfile with the local pnpm.

The dashboard workflow only writes issues inside caller repos; CI runs it against this repo
in dry-run mode. Run `scripts/dashboard-dry-run.sh` after changing it to see the result
before pushing, or to see it for another repo: it runs the audit job's `run:` steps and then
the section scripts in order with dry-run on (real registries and osv.dev, no issue touched)
and prints the title and body, also saved under `tmp/dashboard/` (ignored). The inputs are
fixed to their defaults, and the script exits 1 when a step failed. It needs gh, jq, yq, pnpm,
curl and the Node.js in `.nvmrc`, and the commit must exist on GitHub.

The dashboard's logic lives in `src/dashboard/` (one module per step, `main.ts` dispatches)
and `src/lib/`. Node.js runs the `.ts` files as they are, with its built-in type stripping, so
only erasable syntax is allowed (`erasableSyntaxOnly` in `tsconfig.json`), imports name the
`.ts` extension, and there are no runtime npm packages: `fetch`, `node:fs` and friends do the
work. Keep the pure parts (parsing, rendering, deciding) separate from the I/O so they can be
unit-tested from fixtures in `*.test.ts` next to the module. The update workflow's steps are
still inline shell; they move to `src/updates/` in a later change.

oxlint is configured by `.oxlintrc.json`, the rule set of `valuecodes/agentic-monorepo-starter`
without its React, a11y, vitest and workspace-boundary rules: every rule listed, type-aware
through `oxlint-tsgolint`, functions as arrow expressions, `type` over `interface`, no non-null
assertions, declarations first and one `export { … }` list at the bottom of each module. It
prints nothing when clean. Knip (`knip.jsonc`) starts from `src/dashboard/main.ts` and the
tests, so an export nothing imports is a finding: drop the `export`, don't add a test for it.

Git hooks live in `.githooks/` as plain shell scripts, enabled by `pnpm install` through the
root `prepare` script (`git config core.hooksPath .githooks`, so it covers every worktree).
`pre-commit` runs `format:check` and `lint`, `pre-push` runs `typecheck`, `test` and `knip`;
CI runs all of them again. Never bypass them with `--no-verify`. Nothing formats on edit: run
`pnpm format` yourself before committing.

actionlint (with shellcheck over the `run:` scripts), shellcheck over `scripts/` and zizmor
run in CI only; they are not npm packages. CI (`.github/workflows/ci.yml`) runs them all on
PRs and on push to `main`, with `lint`, `knip`, `typecheck` and `test`, the two linters through
`workflow-lint.yml`, and calls `maintenance-dashboard.yml` with `dry-run: true`; its `ci` job
is the check to require on `main`.

---

## Workflow conventions

- **Callers pin a full commit SHA**, never `@main`. A change here reaches a caller only when it
  re-pins, so a breaking change needs a migration note in the PR.
- **`GITHUB_TOKEN` only.** No secrets, PATs, bot accounts or GitHub Apps. Prefer the REST API
  (`gh api`) over checking out the caller's repo; when a checkout is needed, use
  `persist-credentials: false` and run no repo code.
- **Few third-party actions.** Stick to `actions/*` plus the ones already in use; do the rest
  in `src/` (TypeScript, run by Node.js as is) or, for short glue around a tool, in shell with
  `gh`, `jq`, `yq` and `curl`, which the runner ships. Download any extra tool by exact version
  and verify its checksum (see actionlint in `workflow-lint.yml`).
- **Scripts reach the runner by checkout.** A caller gets only the workflow file, so a job that
  runs `src/` first checks this repo out at `job.workflow_sha` (the commit the caller pinned)
  into `.automation/` with `persist-credentials: false`, then sets up the Node.js in `.nvmrc`.
  Read the SHA from `toJSON(job)` in a validating step: actionlint does not know the property.
- **Pin every action by full SHA** with the version as a comment:
  `uses: actions/checkout@<sha> # v7.0.1`. Dependabot keeps both current.
- **Permissions:** `permissions: {}` at the top level, then the minimum per job. A reusable
  workflow cannot raise the caller's grants, so document what the caller must grant.
- **Inputs and expressions** reach `run:` scripts through `env:`, never inlined as `${{ }}` in
  the script (zizmor's template-injection audit).
- **Shell:** every `run:` starts with `set -euo pipefail`. Quote expansions. Fail loudly with
  `::error::` and a message that says what to fix.
- **External data is untrusted:** validate versions with a regex before using them, and escape
  anything that lands in Markdown.
- **Every job** has `timeout-minutes`; jobs that write shared state have a `concurrency` group.
- **Job names are check names.** A caller sees each job of a reusable workflow as
  `<caller job> / <job name>`, and callers usually name their job after the file. So name jobs
  after what they check or do (`actionlint`, `update-issue`), never after the workflow
  (`workflow-lint / workflow-lint` says nothing), and give each tool its own job when that
  lets a failed check name the cause. Renaming a job renames every caller's check and can
  break their required-check settings: call it out in the PR and the release notes.

---

## Style

- Comments explain why, not what, in full sentences. Each workflow starts with a short header
  comment saying what it does and how other repos call it.
- Plain, direct English in the README and messages. No marketing words.
- Commits: `<type>: <subject>` (`feat`, `fix`, `docs`, `chore`, `refactor`), imperative, at
  most 72 characters. PR titles are a plain sentence.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets or credentials. The repo is public and MIT licensed.
- Every external npm version lives in the `catalog:` block of `pnpm-workspace.yaml`, saved
  exact (`.npmrc`). Every install enforces `minimumReleaseAge` (14 days) and
  `trustPolicy: no-downgrade`. When one fails, investigate: never disable it, and never
  exclude a whole package to get past it.
- Pushing a change under `.github/workflows/` over HTTPS needs a token with the Workflows
  permission.
