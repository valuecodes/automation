#!/usr/bin/env bash
# Runs every `run:` step of .github/workflows/maintenance-dashboard.yml here,
# in order and with dry-run on, and prints the dashboard body. CI only lints
# the workflow and the dashboard itself only runs inside caller repos, so this
# is the one way to see the body before a change is merged and re-pinned.
#
#   scripts/dashboard-dry-run.sh [owner/repo [commit [checkout-dir]]]
#
# Defaults to this repo at the commit checked out here. The commit must exist
# on GitHub, because the steps read files through the API; the checkout is
# only used for the audit job (`pnpm audit` and the lockfile listing). Needs
# gh (logged in), jq, yq, pnpm and curl; the runner ships all of them. Talks
# to the real registries and osv.dev, never touches an issue. The body lands
# in tmp/dashboard/<owner>-<repo>/dashboard.md (ignored by git) next to the
# steps' work files, and is printed too.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
workflow="$root/.github/workflows/maintenance-dashboard.yml"
checkout=${3:-$root}
checkout=$(cd "$checkout" && pwd)

for tool in gh jq yq pnpm curl; do
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
export GITHUB_ENV="$RUNNER_TEMP/github.env"
export GITHUB_OUTPUT="$RUNNER_TEMP/github.output"
export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/dashboard.md"
: > "$GITHUB_ENV"
: > "$GITHUB_OUTPUT"
: > "$GITHUB_STEP_SUMMARY"

# The dedented script of the step with this name. The match depends on the
# workflow's indentation (steps at six spaces, `run: |` at eight, the script
# at ten), so a reformat of the workflow shows up here as "step not found".
step() {
  awk -v want="$1" '
    index($0, "- name: " want) == 7 || index($0, "- name: \"" want "\"") == 7 { grab = 1; next }
    grab && /^        run: \|/ { body = 1; next }
    body && /^      - / { exit }
    body && /^  [a-z]/ { exit }
    body { sub(/^          /, ""); print }
  ' "$workflow"
}

# Runs one step from the given directory, with whatever earlier steps put in
# $GITHUB_ENV, and reports its exit code instead of stopping, like
# `continue-on-error`.
run_step() {
  local name=$1 dir=$2 code
  step "$name" > "$RUNNER_TEMP/step.sh"
  if [[ ! -s $RUNNER_TEMP/step.sh ]]; then
    echo "::error::Step not found in the workflow: $name" >&2
    exit 1
  fi
  echo "=== $name" >&2
  set -a
  # shellcheck disable=SC1090
  . "$GITHUB_ENV"
  set +a
  set +e
  (cd "$dir" && bash "$RUNNER_TEMP/step.sh") >&2
  code=$?
  set -e
  if (( code != 0 )); then
    echo "--- exit $code" >&2
  fi
  return 0
}

# The audit job runs in the checkout; the update-issue job needs no checkout.
run_step "Check for a pnpm project" "$checkout"
if grep -q '^pnpm=true' "$GITHUB_OUTPUT"; then
  run_step "List the locked packages" "$checkout"
  run_step "Run pnpm audit" "$checkout"
fi
run_step "Read the repo files at this commit" "$RUNNER_TEMP"
run_step "Section: security (pnpm audit)" "$RUNNER_TEMP"
run_step "Section: dependencies (catalog)" "$RUNNER_TEMP"
run_step "Section: supply chain" "$RUNNER_TEMP"
run_step "Section: pnpm" "$RUNNER_TEMP"
run_step "Section: gitleaks" "$RUNNER_TEMP"
run_step "Section: Node.js" "$RUNNER_TEMP"
run_step "Update the dashboard issue" "$RUNNER_TEMP"

echo >&2
echo "Body for $REPO at ${SHA:0:7}, saved as $GITHUB_STEP_SUMMARY:" >&2
echo >&2
cat "$GITHUB_STEP_SUMMARY"
