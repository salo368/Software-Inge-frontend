#!/usr/bin/env bash
# Computes what needs to happen in a deploy run, mirroring the backend
# `scripts/ci/plan-deploy.sh` output shape so the two pipelines look
# and behave the same way.
#
# Outputs written to $GITHUB_OUTPUT:
#
#   blocks_to_deploy    JSON array of block names ('["simulator","portal","signing"]').
#   blocks_count        integer, len(blocks_to_deploy).
#   run_infrastructure  'true' | 'false' -- whether the shared CloudFront/S3
#                                            serverless.yml stack must be
#                                            deployed before the block matrix
#                                            starts.
#   transversal         'true' | 'false' -- whether the change touched a shared
#                                            path (angular.json, package.json,
#                                            projects/shared/**, scripts/ci/...).
#                                            When true, every block is redeployed.
#   total_count         blocks_count + (1 if run_infrastructure else 0). Used by
#                                            the caller's `if:` guard to decide
#                                            whether to run Validate at all.
#
# Anchoring:
#
# Backend anchors its diff to the SHA of the last SUCCESSFUL deploy on the
# current branch (via `gh run list`) so a failed pipeline that landed an
# infra file doesn't get skipped forever. We do the same here: the caller
# passes LAST_SUCCESSFUL_DEPLOY_SHA (empty when there is no prior success)
# and we fall back to GITHUB_EVENT_BEFORE only when that's missing.

set -euo pipefail

log() { echo "$@" >&2; }

# ---------------------------------------------------------------------------
# Classification helpers. Keep in sync with the backend equivalents so the
# mental model transfers 1:1 between repos.
# ---------------------------------------------------------------------------

# Anything that must trigger EVERY block to be rebuilt + redeployed. The
# rule of thumb: if this file changes the way ng builds run OR ships code
# that lives in every block's bundle, it's transversal.
is_transversal() {
  case "$1" in
    projects/shared/*)            return 0 ;;
    angular.json)                 return 0 ;;
    package.json | package-lock.json) return 0 ;;
    tsconfig.json | tsconfig.spec.json) return 0 ;;
    .nvmrc)                       return 0 ;;
    scripts/ci/deploy.sh | scripts/ci/plan-deploy.sh | scripts/ci/block-info.sh) return 0 ;;
    .github/workflows/*)          return 0 ;;
    *) return 1 ;;
  esac
}

# Anything that requires `serverless deploy` (CloudFront distribution,
# S3 buckets, edge function source, IAM).
is_infra() {
  case "$1" in
    serverless.yml | infra/*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# 1) Determine the diff. Priority:
#      manual override > test hook > push against last-successful > local HEAD^..HEAD
# ---------------------------------------------------------------------------

CHANGED_FILES=""

if [[ -n "${PLAN_DEPLOY_TEST_CHANGED_FILES:-}" ]]; then
  # Injected by unit tests. Newline-separated list.
  CHANGED_FILES="${PLAN_DEPLOY_TEST_CHANGED_FILES}"
  log "== TEST MODE: using injected CHANGED_FILES"
elif [[ -n "${MANUAL_BLOCK:-}" ]]; then
  log "== manual: MANUAL_BLOCK='${MANUAL_BLOCK}'"
elif [[ "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
  ANCHOR="${LAST_SUCCESSFUL_DEPLOY_SHA:-}"
  if [[ -z "${ANCHOR}" ]]; then
    ANCHOR="${GITHUB_EVENT_BEFORE:-}"
    log "== no LAST_SUCCESSFUL_DEPLOY_SHA, falling back to GITHUB_EVENT_BEFORE=${ANCHOR}"
  else
    log "== diff anchored at last-successful deploy: ${ANCHOR}"
  fi
  if [[ -z "${ANCHOR}" || "${ANCHOR}" == "0000000000000000000000000000000000000000" ]]; then
    log "::warning::no valid anchor SHA (new branch or force-push), assuming full deploy"
    CHANGED_FILES="__FORCE_ALL__"
  elif ! git cat-file -e "${ANCHOR}^{commit}" 2>/dev/null; then
    log "::warning::anchor SHA ${ANCHOR} not present locally, assuming full deploy"
    CHANGED_FILES="__FORCE_ALL__"
  else
    CHANGED_FILES="$(git diff --name-only "${ANCHOR}" HEAD)"
  fi
else
  log "== local: diff HEAD^..HEAD"
  CHANGED_FILES="$(git diff --name-only HEAD^ HEAD 2>/dev/null || echo "")"
fi

# ---------------------------------------------------------------------------
# 2) Discover blocks from the tree so adding one is just creating a folder
#    under projects/.
# ---------------------------------------------------------------------------

ALL_BLOCKS=()
while IFS= read -r -d '' d; do
  name="$(basename "${d}")"
  [[ "${name}" == "shared" ]] && continue
  ALL_BLOCKS+=("${name}")
done < <(find projects -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null | sort -z)

log "== discovered blocks: ${ALL_BLOCKS[*]:-<none>}"

# ---------------------------------------------------------------------------
# 3) Compute the plan.
# ---------------------------------------------------------------------------

selected=()
run_infra=false
transversal=false

if [[ -n "${MANUAL_BLOCK:-}" ]]; then
  # Manual override: force a specific block (or all), plus optional force_infra.
  if [[ "${MANUAL_BLOCK}" == "__all__" ]]; then
    selected=("${ALL_BLOCKS[@]}")
    transversal=true
  elif [[ ! " ${ALL_BLOCKS[*]} " =~ " ${MANUAL_BLOCK} " ]]; then
    log "::error::MANUAL_BLOCK='${MANUAL_BLOCK}' not found in ${ALL_BLOCKS[*]:-<none>}"
    exit 1
  else
    selected=("${MANUAL_BLOCK}")
  fi
  if [[ "${FORCE_INFRA:-0}" == "1" ]]; then
    run_infra=true
  fi

elif [[ "${CHANGED_FILES}" == "__FORCE_ALL__" ]]; then
  selected=("${ALL_BLOCKS[@]}")
  run_infra=true
  transversal=true

elif [[ -z "${CHANGED_FILES}" ]]; then
  log "== no changes, nothing to deploy"

else
  log "== changed files:"
  echo "${CHANGED_FILES}" | sed 's/^/   /' >&2

  hits=()
  while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    if is_infra "${f}"; then
      run_infra=true
      continue
    fi
    if is_transversal "${f}"; then
      transversal=true
      continue
    fi
    if [[ "${f}" =~ ^projects/([^/]+)/ ]]; then
      hits+=("${BASH_REMATCH[1]}")
    fi
  done <<<"${CHANGED_FILES}"

  if [[ "${transversal}" == "true" ]]; then
    log "== workspace-wide change -> every block"
    selected=("${ALL_BLOCKS[@]}")
  else
    for b in "${hits[@]:-}"; do
      [[ -z "${b}" ]] && continue
      if [[ " ${ALL_BLOCKS[*]} " =~ " ${b} " ]]; then
        selected+=("${b}")
      else
        log "::warning::block '${b}' in diff but not in tree, ignoring"
      fi
    done
  fi

  # A fresh stack has no buckets to upload to; a bucket rename means the
  # old bucket is gone. Either way, an infra deploy without any block
  # deploy would leave the CF distribution serving 404s.
  if [[ "${run_infra}" == "true" && ${#selected[@]} -eq 0 ]]; then
    log "== infra-only change -> redeploy every block onto the new stack"
    selected=("${ALL_BLOCKS[@]}")
  fi

  if [[ ${#selected[@]} -eq 0 && "${run_infra}" == "false" ]]; then
    log "== only non-deployable changes, nothing to deploy"
  fi
fi

# ---------------------------------------------------------------------------
# 4) Emit the plan.
# ---------------------------------------------------------------------------

ordered=()
if [[ ${#selected[@]} -gt 0 ]]; then
  while IFS= read -r b; do
    ordered+=("${b}")
  done < <(printf '%s\n' "${selected[@]}" | sort -u)
fi

blocks_count=${#ordered[@]}
run_infra_bool="${run_infra}"
transversal_bool="${transversal}"

# total_count is used by the caller to decide whether Validate should even
# run. Zero blocks AND no infra means the whole pipeline is a no-op.
total=$blocks_count
if [[ "${run_infra_bool}" == "true" ]]; then total=$((total + 1)); fi

log "== plan:"
log "   blocks_to_deploy   = ${ordered[*]:-<none>}"
log "   blocks_count       = ${blocks_count}"
log "   run_infrastructure = ${run_infra_bool}"
log "   transversal        = ${transversal_bool}"
log "   total_count        = ${total}"

if [[ $blocks_count -eq 0 ]]; then
  json="[]"
else
  json="["
  for i in "${!ordered[@]}"; do
    [[ $i -gt 0 ]] && json+=","
    json+="\"${ordered[$i]}\""
  done
  json+="]"
fi

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  log "== DRY_RUN active, skipping GITHUB_OUTPUT"
  exit 0
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "blocks_to_deploy=${json}"
    echo "blocks_count=${blocks_count}"
    echo "run_infrastructure=${run_infra_bool}"
    echo "transversal=${transversal_bool}"
    echo "total_count=${total}"
  } >>"${GITHUB_OUTPUT}"
fi
