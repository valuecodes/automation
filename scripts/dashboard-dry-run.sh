#!/usr/bin/env bash
# Runs the steps of .github/workflows/maintenance-dashboard.yml here, in
# order and with dry-run on, and prints the dashboard title and body: the
# audit job's steps in the checkout, then the section steps, all from
# src/dashboard/ with the local Node.js. CI runs the dashboard in dry-run
# mode against this repo only; this is the way to see the body for any repo
# before a change is merged and re-pinned.
#
#   scripts/dashboard-dry-run.sh [owner/repo [commit [checkout-dir]]]
#
# Defaults to this repo at the commit checked out here. The commit must exist
# on GitHub, because the steps read files through the API; the checkout is
# only used for the audit job (`pnpm audit` and the lockfile listing). The
# inputs are fixed to their defaults (14 days, `.github/scripts/secrets-scan.sh`).
# Needs gh (logged in), pnpm, curl and the Node.js in .nvmrc. Talks to the
# real registries and osv.dev, never touches an issue. The body lands in
# tmp/dashboard/<owner>-<repo>/dashboard.md (ignored by git) next to the
# steps' work files, and is printed too. Like the workflow, every step runs
# even when an earlier one failed; the exit code is 1 when any step failed.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
checkout=${3:-$root}
checkout=$(cd "$checkout" && pwd)

for tool in gh pnpm curl node; do
  if ! command -v "$tool" > /dev/null; then
    echo "::error::$tool is not installed; the workflow's steps need it." >&2
    exit 1
  fi
done
gh auth status > /dev/null

export GH_TOKEN
GH_TOKEN=$(gh auth token)
export REPO=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
export SHA=${2:-$(git -C "$checkout" rev-parse HEAD)}
# A prefix match, so a short commit argument does not warn.
if [[ $(git -C "$checkout" rev-parse HEAD) != "$SHA"* ]]; then
  echo "::warning::The checkout is not at $SHA; the audit job runs on the checkout, the other steps read $SHA through the API." >&2
fi
export SERVER_URL=https://github.com
export RUN_ID=0
export WORKFLOW_REF="$REPO/.github/workflows/maintenance-dashboard.yml@refs/heads/local"
export MIN_AGE_DAYS=14
export GITLEAKS_SCRIPT=.github/scripts/secrets-scan.sh
export DRY_RUN=true

# The files the runner gives a job; the steps append to them like on CI.
export RUNNER_TEMP="$root/tmp/dashboard/${REPO//\//-}"
rm -rf "$RUNNER_TEMP"
mkdir -p "$RUNNER_TEMP"
export GITHUB_OUTPUT="$RUNNER_TEMP/github.output"
export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/dashboard.md"
: > "$GITHUB_OUTPUT"
: > "$GITHUB_STEP_SUMMARY"

# Reports a step's exit code instead of stopping, like `continue-on-error`.
# A failure is remembered for the final exit code.
failed=0
report() {
  if (( $1 != 0 )); then
    echo "--- exit $1" >&2
    failed=1
  fi
}

# One step, run from the given directory: the audit job's in the checkout,
# the update-issue job's anywhere.
run_step() {
  local name=$1 dir=$2
  echo "=== $name" >&2
  set +e
  (cd "$dir" && node "$root/src/dashboard/main.ts" "$name") >&2
  report $?
  set -e
}

run_step lockfile "$checkout"
if grep -q '^pnpm=true' "$GITHUB_OUTPUT"; then
  run_step audit "$checkout"
fi
for name in setup security catalog supply-chain pnpm gitleaks node issue; do
  run_step "$name" "$root"
done

echo >&2
echo "Title and body for $REPO at ${SHA:0:7}, saved as $GITHUB_STEP_SUMMARY:" >&2
echo >&2
cat "$GITHUB_STEP_SUMMARY"
if (( failed )); then
  echo "::error::A step failed, see its output above." >&2
  exit 1
fi
