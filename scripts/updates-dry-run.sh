#!/usr/bin/env bash
# Runs every `run:` step of .github/workflows/maintenance-updates.yml here, one
# kind after another and with dry-run on, and prints the PR each kind would
# open or the reason it opens none. CI runs the workflow in dry-run mode against
# this repo only; this is the way to see the PRs for any repo before a change is
# merged and re-pinned.
#
#   scripts/updates-dry-run.sh [owner/repo [kind...]]
#
# Defaults to this repo and every kind (node, pnpm, gitleaks, catalog). Like
# the workflow, it reads the head of the repo's default branch on GitHub, not
# a local checkout. The catalog kind needs that commit on disk to resolve the
# lockfile, so it is fetched (depth 1, over HTTPS) into the output directory;
# the local pnpm stands in for the workflow's pnpm and Node.js setup. The
# inputs are fixed to their defaults (14 days, `.github/scripts/secrets-scan.sh`,
# no `ci-workflow`). Needs gh (logged in), git, jq, yq, pnpm and curl. Talks to
# the real registries and osv.dev, never pushes or touches a PR. Each kind's
# work files and summary land in tmp/updates/<owner>-<repo>/<kind>/ (ignored by
# git), and the summaries are printed. The exit code is 1 when any step failed,
# which includes a malicious version found on osv.dev.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
workflow="$root/.github/workflows/maintenance-updates.yml"

for tool in gh git jq yq pnpm curl; do
  if ! command -v "$tool" > /dev/null; then
    echo "::error::$tool is not installed; the workflow's steps need it." >&2
    exit 1
  fi
done
gh auth status > /dev/null

export GH_TOKEN
GH_TOKEN=$(gh auth token)
export REPO=${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
shift || true
kinds=("$@")
if (( ${#kinds[@]} == 0 )); then
  kinds=(node pnpm gitleaks catalog)
fi
export SERVER_URL=https://github.com
export WORKFLOW_REF="$REPO/.github/workflows/maintenance-updates.yml@refs/heads/local"
export MIN_AGE_DAYS=14
export GITLEAKS_SCRIPT=.github/scripts/secrets-scan.sh
export CI_WORKFLOW=""
export DRY_RUN=true
out="$root/tmp/updates/${REPO//\//-}"
rm -rf "$out"

# The dedented script of the step with this name, as in dashboard-dry-run.sh.
# The match depends on the workflow's indentation (steps at six spaces,
# `run: |` at eight, the script at ten), so a reformat of the workflow shows up
# here as "step not found".
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
# $GITHUB_ENV. A step that fails ends its kind, as in the workflow's job, and
# is remembered for the final exit code.
failed=0
run_step() {
  local name=$1 dir=$2 code
  step "$name" > "$RUNNER_TEMP/step.sh"
  if [[ ! -s $RUNNER_TEMP/step.sh ]]; then
    echo "::error::Step not found in the workflow: $name" >&2
    exit 1
  fi
  echo "=== $KIND: $name" >&2
  : > "$GITHUB_OUTPUT"
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
    failed=1
    return 1
  fi
}

run_kind() {
  export KIND=$1
  export RUNNER_TEMP="$out/$KIND"
  mkdir -p "$RUNNER_TEMP"
  export GITHUB_ENV="$RUNNER_TEMP/github.env"
  export GITHUB_OUTPUT="$RUNNER_TEMP/github.output"
  export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/summary.md"
  : > "$GITHUB_ENV"
  : > "$GITHUB_STEP_SUMMARY"

  run_step "Read the repo files on the default branch" "$RUNNER_TEMP" || return 0
  case $KIND in
    node) run_step "Node.js: find the update" "$RUNNER_TEMP" || return 0 ;;
    pnpm) run_step "pnpm: find the update" "$RUNNER_TEMP" || return 0 ;;
    gitleaks) run_step "gitleaks: find the update" "$RUNNER_TEMP" || return 0 ;;
    catalog)
      run_step "Dependencies: pick the updates" "$RUNNER_TEMP" || return 0
      if grep -q '^resolve=true' "$GITHUB_OUTPUT"; then
        local checkout="$RUNNER_TEMP/checkout" base_sha
        base_sha=$(sed -n 's/^BASE_SHA=//p' "$GITHUB_ENV")
        git init -q "$checkout"
        git -C "$checkout" fetch -q --depth 1 "https://github.com/$REPO.git" "$base_sha"
        git -C "$checkout" checkout -q FETCH_HEAD
        run_step "Dependencies: resolve the lockfile" "$checkout" || return 0
      fi
      ;;
    *)
      echo "::error::Unknown kind '$KIND'; use node, pnpm, gitleaks or catalog." >&2
      exit 1
      ;;
  esac
  run_step "Check the new versions on osv.dev" "$RUNNER_TEMP" || return 0
  run_step "Open or update the PR" "$RUNNER_TEMP" || return 0
}

for kind in "${kinds[@]}"; do
  run_kind "$kind"
done

echo >&2
echo "Planned PRs for $REPO, saved under $out:" >&2
for kind in "${kinds[@]}"; do
  echo
  echo "# $kind"
  echo
  cat "$out/$kind/summary.md"
done
if (( failed )); then
  echo "::error::A step failed, see its output above." >&2
  exit 1
fi
