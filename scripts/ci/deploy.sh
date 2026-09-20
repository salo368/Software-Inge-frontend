#!/usr/bin/env bash
# Uploads one built block to its S3 bucket with proper Content-Type and
# Cache-Control per extension, then invalidates only that block's paths in
# CloudFront. Avoids the aws-cli s3 sync MIME-guess bug on Windows (which
# serves .js as text/plain).
#
# Env:
#   BUCKET    - target S3 bucket (required)
#   DIST_ID   - CloudFront distribution id (required)
#   DIST_DIR  - built assets dir (required, e.g. dist/portal/browser)
#   PREFIX    - key prefix inside the bucket, must match the block's baseHref
#               without the leading slash (e.g. "portal/"). Empty for the block
#               served at the root.

set -euo pipefail

: "${BUCKET:?BUCKET is required}"
: "${DIST_ID:?DIST_ID is required}"
: "${DIST_DIR:?DIST_DIR is required}"
PREFIX="${PREFIX:-}"

log() { echo "$@" >&2; }

if [[ ! -d "${DIST_DIR}" ]]; then
  log "::error::DIST_DIR '${DIST_DIR}' does not exist. Run 'ng build <block>' first."
  exit 1
fi

DEST="s3://${BUCKET}/${PREFIX}"
log "== ${DEST} <- ${DIST_DIR}/ (typed upload)"

put() {
  local pattern="$1" ctype="$2" cache="$3"
  aws s3 cp "${DIST_DIR}/" "${DEST}" --recursive --exclude "*" --include "${pattern}" \
    --content-type "${ctype}" --cache-control "${cache}" >/dev/null 2>&1 || true
}

# Hashed assets -> long immutable cache.
IMMUTABLE="public, max-age=31536000, immutable"
put "*.js"    "application/javascript" "${IMMUTABLE}"
put "*.mjs"   "text/javascript"        "${IMMUTABLE}"
put "*.css"   "text/css"               "${IMMUTABLE}"
put "*.svg"   "image/svg+xml"          "${IMMUTABLE}"
put "*.woff2" "font/woff2"             "${IMMUTABLE}"
put "*.json"  "application/json"       "${IMMUTABLE}"

# Entry HTML -> no-cache so users always fetch the latest hash references.
aws s3 cp "${DIST_DIR}/" "${DEST}" --recursive --exclude "*" --include "*.html" \
  --content-type "text/html; charset=utf-8" --cache-control "no-cache" >/dev/null

aws s3 cp "${DIST_DIR}/" "${DEST}" --recursive --exclude "*" --include "*.ico" \
  --content-type "image/x-icon" >/dev/null 2>&1 || true

# Cleanup stale files that no longer exist in the build. --size-only avoids
# re-uploads because we already set the metadata above.
log "== Removing stale objects under ${DEST}"
aws s3 sync "${DIST_DIR}/" "${DEST}" --delete --size-only >/dev/null

# Invalidate only this block's paths: a portal release must not evict the
# simulator's cache.
INV_PATH="/${PREFIX}*"
log "== CloudFront invalidation ${INV_PATH}"
INV_ID="$(aws cloudfront create-invalidation \
  --distribution-id "${DIST_ID}" --paths "${INV_PATH}" \
  --query 'Invalidation.Id' --output text)"
log "   invalidation: ${INV_ID}"
