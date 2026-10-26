# AGENTS.md

Guidelines for AI agents and contributors working in this repo.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

Reusable GitHub Actions workflows that other repos call with
`uses: valuecodes/automation/.github/workflows/<file>@<full-commit-sha>`.

| Path                                          | What                                                  |
| --------------------------------------------- | ----------------------------------------------------- |
| `.github/workflows/maintenance-dashboard.yml` | Reusable: keeps the **Maintenance dashboard** issue   |
| `.github/workflows/workflow-lint.yml`         | Reusable: actionlint and zizmor over workflow files   |
| `.github/workflows/ci.yml`                    | This repo's CI: oxfmt, shellcheck, both reusables     |
| `.github/actions/setup/`                      | Composite setup action: pnpm, Node.js, frozen install |
| `.github/dependabot.yml`                      | Monthly grouped bumps of the SHA-pinned actions       |
| `scripts/dashboard-dry-run.sh`                | Runs the dashboard's steps locally, prints the body   |

`README.md` is the user-facing doc for each reusable workflow: what it does, a flowchart of
how a run decides, and the caller snippet. Keep it in step with the workflow.

---

## Commands

**Prerequisites:** Node.js 24 (exact version in `.nvmrc`), pnpm 12.11.2 (`packageManager` in
`package.json`).

```bash
pnpm install                     # Install oxfmt
pnpm format                      # oxfmt, writes in place
pnpm format:check                # oxfmt --check (no writes)
scripts/dashboard-dry-run.sh     # The dashboard body for this repo, or `owner/repo sha dir`
```

The dashboard workflow only writes issues inside caller repos; CI runs it against this repo
in dry-run mode. Run `scripts/dashboard-dry-run.sh` after changing it to see the result
before pushing, or to see it for another repo: it executes every `run:` step in order with
dry-run on (real registries and osv.dev, no issue touched) and prints the title and body,
also saved under `tmp/dashboard/` (ignored). The inputs are fixed to their defaults, and the
script exits 1 when a step failed. It needs gh, jq, yq, pnpm and curl, and the commit must
exist on GitHub.

There is no post-edit formatting hook: run `pnpm format` yourself before committing.

actionlint (with shellcheck over the `run:` scripts), shellcheck over `scripts/` and zizmor
run in CI only; they are not npm packages. CI (`.github/workflows/ci.yml`) runs them all on
PRs and on push to `main`, the two linters through `workflow-lint.yml`, and calls
`maintenance-dashboard.yml` with `dry-run: true`; its `ci` job is the check to require on
`main`.

---

## Workflow conventions

- **Callers pin a full commit SHA**, never `@main`. A change here reaches a caller only when it
  re-pins, so a breaking change needs a migration note in the PR.
- **`GITHUB_TOKEN` only.** No secrets, PATs, bot accounts or GitHub Apps. Prefer the REST API
  (`gh api`) over checking out the caller's repo; when a checkout is needed, use
  `persist-credentials: false` and run no repo code.
- **Few third-party actions.** Stick to `actions/*` plus the ones already in use; do the rest
  in shell with `gh`, `jq`, `yq` and `curl`, which the runner ships. Download any extra tool by
  exact version and verify its checksum (see actionlint in `workflow-lint.yml`).
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
