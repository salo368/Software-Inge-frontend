#!/usr/bin/env bash
# Computes which micro frontend blocks to deploy based on the git diff, plus
# whether the shared CloudFront/S3 stack needs a serverless deploy.
# Blocks: every directory under projects/ except `shared`.
# See README.md.

set -euo pipefail

log() { echo "$@" >&2; }

# Files that force every block to be rebuilt and redeployed.
is_workspace_global() {
  case "$1" in
    projects/shared/*) return 0 ;;
    angular.json|package.json|package-lock.json|tsconfig.json|.nvmrc) return 0 ;;
    scripts/ci/deploy.sh) return 0 ;;
    *) return 1 ;;
  esac
}

# Files that require `serverless deploy` (distribution, buckets, edge function).
is_infra() {
  case "$1" in
    serverless.yml|infra/*) return 0 ;;
    *) return 1 ;;
  esac
}

CHANGED_FILES=""

# Testing hook: PLAN_DEPLOY_TEST_CHANGED_FILES can inject a newline-separated
# file list to skip real diff detection. Used by unit tests only.
if [[ -n "${PLAN_DEPLOY_TEST_CHANGED_FILES:-}" ]]; then
  CHANGED_FILES="${PLAN_DEPLOY_TEST_CHANGED_FILES}"
  log "== TEST MODE: using injected CHANGED_FILES"
elif [[ -n "${MANUAL_BLOCK:-}" ]]; then
  log "== manual: MANUAL_BLOCK='${MANUAL_BLOCK}'"
elif [[ "${GITHUB_EVENT_NAME:-}" == "push" ]]; then
  BEFORE="${GITHUB_EVENT_BEFORE:-}"
  if [[ -z "${BEFORE}" || "${BEFORE}" == "0000000000000000000000000000000000000000" ]]; then
    log "::warning::push without valid BEFORE (new branch or force-push), assuming full deploy"
    CHANGED_FILES="__FORCE_ALL__"
  elif ! git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
    log "::warning::BEFORE ${BEFORE} not present locally, assuming full deploy"
    CHANGED_FILES="__FORCE_ALL__"
  else
    log "== push: diff ${BEFORE}..HEAD"
    CHANGED_FILES="$(git diff --name-only "${BEFORE}" HEAD)"
  fi
else
  log "== local: diff HEAD^..HEAD"
  CHANGED_FILES="$(git diff --name-only HEAD^ HEAD 2>/dev/null || echo "")"
fi

# Discover blocks from the tree, so adding one is just creating the folder.
ALL_BLOCKS=()
while IFS= read -r -d '' d; do
  name="$(basename "${d}")"
  [[ "${name}" == "shared" ]] && continue
  ALL_BLOCKS+=("${name}")
done < <(find projects -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null | sort -z)

log "== discovered blocks: ${ALL_BLOCKS[*]:-<none>}"

selected=()
infra=0

if [[ -n "${MANUAL_BLOCK:-}" ]]; then
  if [[ "${MANUAL_BLOCK}" == "__all__" ]]; then
    selected=("${ALL_BLOCKS[@]}")
  elif [[ ! " ${ALL_BLOCKS[*]} " =~ " ${MANUAL_BLOCK} " ]]; then
    log "::error::MANUAL_BLOCK='${MANUAL_BLOCK}' not found in ${ALL_BLOCKS[*]:-<none>}"
    exit 1
  else
    selected=("${MANUAL_BLOCK}")
  fi
  infra="${FORCE_INFRA:-0}"
elif [[ "${CHANGED_FILES}" == "__FORCE_ALL__" ]]; then
  selected=("${ALL_BLOCKS[@]}")
  infra=1
elif [[ -z "${CHANGED_FILES}" ]]; then
  log "== no changes, nothing to deploy"
else
  log "== changed files:"
  echo "${CHANGED_FILES}" | sed 's/^/   /' >&2

  global=0
  hits=()
  while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    if is_infra "${f}"; then infra=1; continue; fi
    if is_workspace_global "${f}"; then global=1; continue; fi
    if [[ "${f}" =~ ^projects/([^/]+)/ ]]; then hits+=("${BASH_REMATCH[1]}"); fi
  done <<<"${CHANGED_FILES}"

  if [[ ${global} -eq 1 ]]; then
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

  # A fresh stack has no buckets to upload to.
  if [[ ${infra} -eq 1 && ${#selected[@]} -eq 0 ]]; then
    log "== infra-only change -> redeploy every block onto the new stack"
    selected=("${ALL_BLOCKS[@]}")
  fi

  if [[ ${#selected[@]} -eq 0 ]]; then
    log "== only non-deployable changes, nothing to deploy"
  fi
fi

ordered=()
if [[ ${#selected[@]} -gt 0 ]]; then
  while IFS= read -r b; do
    ordered+=("${b}")
  done < <(printf '%s\n' "${selected[@]}" | sort -u)
fi

log "== plan (${#ordered[@]} block(s), infra=${infra}):"
if [[ ${#ordered[@]} -eq 0 ]]; then
  log "   <none>"
  json="[]"
else
  for b in "${ordered[@]}"; do
    log "   - ${b}"
  done
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
    echo "blocks=${json}"
    echo "count=${#ordered[@]}"
    echo "infra=${infra}"
  } >>"${GITHUB_OUTPUT}"
fi
