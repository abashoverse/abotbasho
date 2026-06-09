#!/usr/bin/env bash
# Redeploy the whole abotbasho stack in one shot.
#
# Always bring up ALL services together. If you recreate just the indexer
# (`docker compose up -d indexer`, or an image/config change that only touches
# it), it gets a NEW IP on the compose network while the long-running
# discord/twitter/telegram/verify-web containers keep resolving the old one.
# They then spam ConnectionRefused / FailedToOpenSocket / "operation timed out"
# / ConnectionClosed against a dead address until the stale keep-alive sockets
# are evicted — even though `docker compose ps` shows the indexer Up (healthy).
# Recreating the whole stack keeps DNS consistent. See README "Redeploying".
#
# Usage:
#   ./deploy.sh                  # base stack (indexer + discord + twitter)
#   ./deploy.sh verify telegram  # also start the verify-web + telegram profiles
#
# Profiles can also be set once via COMPOSE_PROFILES in .env, in which case no
# args are needed here.
set -euo pipefail
cd "$(dirname "$0")"

profile_args=()
for p in "$@"; do
  profile_args+=(--profile "$p")
done

docker compose "${profile_args[@]}" up -d --build
echo
docker compose "${profile_args[@]}" ps
