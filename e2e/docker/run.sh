#!/bin/sh
# Runs the browser checks in Docker, with nothing installed on this computer:
# it builds FranzPLAY from the code of this folder into the image
# franzplay-test-e2e:local (Playwright, Chromium and ffmpeg inside), keeps
# node_modules in the volume franzplay-test-e2e-node-modules, and runs Biome
# and Playwright. Arguments go to Playwright:
#
#   e2e/docker/run.sh
#   e2e/docker/run.sh --repeat-each=3
#   e2e/docker/run.sh tests/titoli.spec.ts --project=telefono
#
# The checks are mounted read only: reports and traces stay in the container,
# unless FRANZPLAY_E2E_RESULTS names a folder of this computer for them.
set -eu
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: leave the paths to Docker

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && (pwd -W 2>/dev/null || pwd))
image=franzplay-test-e2e:local

docker build -q -f "$repo/e2e/docker/Dockerfile" -t "$image" "$repo" >/dev/null

results=""
if [ -n "${FRANZPLAY_E2E_RESULTS:-}" ]; then
  results="-v ${FRANZPLAY_E2E_RESULTS}:/results"
fi

# shellcheck disable=SC2086 # $results is one option or none
docker run --rm --init --ipc=host \
  -v "$repo/e2e:/src/e2e:ro" \
  -v franzplay-test-e2e-node-modules:/deps \
  $results \
  -e CI="${CI:-}" \
  -w /src/e2e \
  "$image" sh -ec '
    # node_modules lives in the volume, installed again only when the lock changes.
    mkdir -p /deps/e2e
    if ! cmp -s package-lock.json /deps/e2e/package-lock.json; then
      cp package.json package-lock.json /deps/e2e/
      (cd /deps/e2e && npm ci --no-audit --no-fund --loglevel=error)
    fi
    ln -s /deps/e2e/node_modules /src/node_modules
    # Biome checks a copy with Unix line ends: a Windows checkout has CRLF,
    # the repository and CI have LF.
    mkdir /tmp/lint
    cp -r biome.json package.json playwright.config.ts global-setup.ts global-teardown.ts tests /tmp/lint/
    find /tmp/lint -type f -exec sed -i "s/\r$//" {} +
    ln -s /deps/e2e/node_modules /tmp/lint/node_modules
    (cd /tmp/lint && /src/node_modules/.bin/biome ci --colors=off .)
    out=/tmp/results
    [ -d /results ] && out=/results
    exec /src/node_modules/.bin/playwright test --output="$out/test-results" "$@"
  ' sh "$@"
