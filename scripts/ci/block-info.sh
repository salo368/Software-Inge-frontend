#!/usr/bin/env bash
# Prints the deploy coordinates of a block as KEY=VALUE lines.
#
#   $ scripts/ci/block-info.sh portal
#   PREFIX=portal/
#   DIST_DIR=dist/portal/browser
#   BUCKET_OUTPUT=PortalBucketName
#
# The prefix is derived from the block's baseHref in angular.json so the S3
# layout can never drift from what the app was built against.

set -euo pipefail

BLOCK="${1:?usage: block-info.sh <block>}"

BASE_HREF="$(node -p "
  const p = require('./angular.json').projects['${BLOCK}'];
  if (!p) { console.error('unknown block: ${BLOCK}'); process.exit(1); }
  p.architect.build.options.baseHref || '/';
")"

OUTPUT_PATH="$(node -p "
  require('./angular.json').projects['${BLOCK}'].architect.build.options.outputPath;
")"

# /portal/ -> portal/ ; / -> ''
PREFIX="${BASE_HREF#/}"

# simulator -> Simulator
CAPITALIZED="$(printf '%s' "${BLOCK:0:1}" | tr '[:lower:]' '[:upper:]')${BLOCK:1}"

echo "PREFIX=${PREFIX}"
echo "DIST_DIR=${OUTPUT_PATH}/browser"
echo "BUCKET_OUTPUT=${CAPITALIZED}BucketName"
