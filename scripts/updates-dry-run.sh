#!/usr/bin/env bash
# Runs the steps of .github/workflows/maintenance-updates.yml here, one kind
# after another and with dry-run on, and prints the PR each kind would open
# or the reason it opens none: the steps in src/updates/ with the local
# Node.js. CI runs the workflow in dry-run mode against this repo only; this
# is the way to see the PRs for any repo before a change is merged and
# re-pinned.
#
#   scripts/updates-dry-run.sh [owner/repo [kind...]]
#
# Defaults to this repo and every kind (node, pnpm, gitleaks, catalog). Like
# the workflow, it reads the head of the repo's default branch on GitHub, not
# a local checkout. The pnpm and catalog kinds need that commit on disk to
# resolve the lockfile, so it is fetched (depth 1, over HTTPS) into the output
# directory; the local pnpm stands in for the workflow's pnpm and Node.js
# setup. The inputs are fixed to their defaults (14 days,
# `.github/scripts/secrets-scan.sh`, no `ci-workflow`). Needs gh (logged in),
# git, jq, pnpm, curl, diff and the Node.js in .nvmrc. Talks to the real
# registries and osv.dev, never pushes or touches a PR. Each kind's work files
# and summary land in tmp/updates/<owner>-<repo>/<kind>/ (ignored by git), and
# the summaries are printed. The exit code is 1 when any step failed, which
# includes a malicious version found on osv.dev. The steps get your full gh
# token, not a scoped one; nothing writes because every write in the
# workflow sits behind `DRY_RUN`, so keep it that way when changing a step.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)

for tool in gh git jq pnpm curl diff node; do
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

# Runs one step from the given directory, with whatever earlier steps put in
# $GITHUB_ENV. A step that fails ends its kind, as in the workflow's job, and
# is remembered for the final exit code.
failed=0
run_step() {
  local name=$1 dir=$2 code
  echo "=== $KIND: $name" >&2
  : > "$GITHUB_OUTPUT"
  # One `name=value` per line, exported as it is (a path may hold a space).
  local line
  while IFS= read -r line; do
    if [[ -n $line ]]; then
      export "${line?}"
    fi
  done < "$GITHUB_ENV"
  set +e
  (cd "$dir" && node "$root/src/updates/main.ts" "$name") >&2
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
  case $KIND in
    node | pnpm | gitleaks | catalog) ;;
    *)
      echo "::error::Unknown kind '$KIND'; use node, pnpm, gitleaks or catalog." >&2
      exit 1
      ;;
  esac
  export RUNNER_TEMP="$out/$KIND"
  mkdir -p "$RUNNER_TEMP"
  export GITHUB_ENV="$RUNNER_TEMP/github.env"
  export GITHUB_OUTPUT="$RUNNER_TEMP/github.output"
  export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/summary.md"
  export CHECKOUT="$RUNNER_TEMP/checkout"
  : > "$GITHUB_ENV"
  : > "$GITHUB_STEP_SUMMARY"

  run_step setup "$RUNNER_TEMP" || return 0
  run_step "$KIND" "$RUNNER_TEMP" || return 0
  if grep -q '^RESOLVE=true' "$GITHUB_ENV"; then
    local base_sha
    base_sha=$(jq -r .baseSha "$RUNNER_TEMP/update/setup.json")
    git init -q "$CHECKOUT"
    git -C "$CHECKOUT" fetch -q --depth 1 "https://github.com/$REPO.git" "$base_sha"
    git -C "$CHECKOUT" checkout -q FETCH_HEAD
    # Like pnpm/action-setup, the step gets the pnpm the repo pins. A local
    # pnpm behind corepack would follow the edited `packageManager` instead,
    # which the step refuses.
    local pinned
    pinned=$(jq -r '.packageManager // "" | capture("^pnpm@(?<v>[0-9]+\\.[0-9]+\\.[0-9]+)").v // empty' "$CHECKOUT/package.json")
    if [[ -z $pinned ]]; then
      echo "::error::$REPO's package.json does not pin pnpm." >&2
      exit 1
    fi
    mkdir -p "$RUNNER_TEMP/bin"
    printf '#!/usr/bin/env bash\nexec npx -y "pnpm@%s" "$@"\n' "$pinned" > "$RUNNER_TEMP/bin/pnpm"
    chmod +x "$RUNNER_TEMP/bin/pnpm"
    PATH="$RUNNER_TEMP/bin:$PATH" run_step resolve "$CHECKOUT" || return 0
  fi
  run_step osv "$RUNNER_TEMP" || return 0
  run_step pr "$RUNNER_TEMP" || return 0
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
