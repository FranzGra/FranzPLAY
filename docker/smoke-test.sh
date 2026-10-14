#!/bin/sh
# Starts the Docker stack exactly as a person would (compose.yaml and a .env),
# with a real video, and checks it works end to end:
#   - the container becomes healthy and runs as PUID:PGID, not as root;
#   - the video is found, read by ffprobe and gets a cover from ffmpeg;
#   - the video streams, with a jump to the middle (an HTTP Range request);
#   - whisper-cli is inside;
#   - the video folder is exactly as before: nothing written there;
#   - with no network at all, it starts and makes covers just the same.
#
# Usage, from the repository root, after building the image:
#   docker build -t ghcr.io/franzgra/franzplay:smoke .
#   docker/smoke-test.sh smoke
# Needs docker (with compose), curl and jq.
set -eu

tag="${1:-smoke}"
image="ghcr.io/franzgra/franzplay:$tag"
port=18090
uid=1234 # not 1000, to see that PUID and PGID really count
gid=2345
work="$(mktemp -d)"
project="franzplay-smoke"
base="http://127.0.0.1:$port"

compose() {
	docker compose --project-name "$project" --env-file "$work/.env" -f compose.yaml "$@"
}

cleanup() {
	status=$?
	if [ "$status" != 0 ]; then
		echo "--- FAILED, FranzPLAY's log:"
		compose logs --no-color franzplay || true
	fi
	compose down --volumes --timeout 30 >/dev/null 2>&1 || true
	docker rm -f franzplay-offline >/dev/null 2>&1 || true
	# The data folders belong to $uid now: remove them from inside Docker.
	docker run --rm --entrypoint rm -v "$work:/work" "$image" -rf /work/data /work/offline >/dev/null 2>&1 || true
	chmod -R u+w "$work"
	rm -rf "$work"
	exit "$status"
}
trap cleanup EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

echo "--- Making a test video with the ffmpeg of the image"
mkdir -p "$work/videos/Vacanze"
docker run --rm --entrypoint ffmpeg --user "$(id -u):$(id -g)" -v "$work/videos:/out" "$image" \
	-loglevel error -f lavfi -i testsrc2=duration=12:size=640x360:rate=25 \
	-f lavfi -i sine=frequency=440:duration=12 -c:v libx264 -pix_fmt yuv420p -c:a aac \
	-movflags +faststart /out/Vacanze/mare.mp4
chmod -R a-w "$work/videos"
before="$(cd "$work/videos" && find . -exec stat -c '%n %s %Y' {} + | sort; find . -type f -exec sha256sum {} + | sort)"

cat >"$work/.env" <<EOF
FRANZPLAY_VIDEO_FOLDER=$work/videos
FRANZPLAY_DATA_FOLDER=$work/data
FRANZPLAY_PORT=$port
FRANZPLAY_IMAGE_TAG=$tag
PUID=$uid
PGID=$gid
TZ=Europe/Rome
EOF

echo "--- Starting the stack"
compose up -d --pull never --no-build

echo "--- Waiting for Docker to call it healthy"
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' franzplay)" = healthy ]; do
	i=$((i + 1))
	[ "$i" -le 60 ] || fail "not healthy after 120 seconds"
	sleep 2
done
curl -fsS "$base/api/health" | jq -e '.status == "ok"' >/dev/null || fail "health"

echo "--- Checking who runs it"
runs="$(docker exec franzplay stat -c '%u:%g' /proc/1)"
[ "$runs" = "$uid:$gid" ] || fail "the program runs as $runs, want $uid:$gid"
owner="$(docker exec franzplay stat -c '%u:%g' /data/franzplay.db)"
[ "$owner" = "$uid:$gid" ] || fail "the database belongs to $owner, want $uid:$gid"
docker exec franzplay whisper-cli --help >/dev/null 2>&1 || fail "whisper-cli does not start"

echo "--- Creating the administrator from the site, with no code from the log"
compose logs --no-color franzplay | grep -q 'first person who opens the site' ||
	fail "the log does not say the site creates the administrator"
jar="$work/cookies"
curl -fsS -c "$jar" -H "Origin: $base" -H 'Content-Type: application/json' \
	-d '{"name":"paolo","password":"una-password-lunga"}' \
	"$base/api/setup" >/dev/null || fail "setup"

echo "--- Waiting for the video, its duration and its cover"
i=0
while :; do
	list="$(curl -fsS -b "$jar" "$base/api/videos")"
	if echo "$list" | jq -e '.videos | length == 1 and .[0].duration != null and .[0].cover != null' >/dev/null; then
		break
	fi
	i=$((i + 1))
	[ "$i" -le 60 ] || fail "video not ready after 120 seconds: $list"
	sleep 2
done
echo "$list" | jq -e '.videos[0].duration == 12 and .videos[0].category == "Vacanze"' >/dev/null ||
	fail "unexpected video: $list"
id="$(echo "$list" | jq -r '.videos[0].id')"
cover="$(echo "$list" | jq -r '.videos[0].cover')"
curl -fsS -b "$jar" -o /dev/null "$base$cover" || fail "cover"

echo "--- Streaming it, and jumping to the middle"
size="$(stat -c %s "$work/videos/Vacanze/mare.mp4")"
whole="$(curl -fsS -b "$jar" -o /dev/null -w '%{http_code} %{size_download}' "$base/api/videos/$id/stream")"
[ "$whole" = "200 $size" ] || fail "whole stream: got '$whole', want '200 $size'"
half=$((size / 2))
part="$(curl -fsS -b "$jar" -H "Range: bytes=$half-$((half + 999))" -o /dev/null \
	-w '%{http_code} %{size_download}' "$base/api/videos/$id/stream")"
[ "$part" = "206 1000" ] || fail "range request: got '$part', want '206 1000'"

echo "--- Stopping cleanly"
compose stop --timeout 30
compose logs --no-color franzplay | grep -q 'FranzPLAY stopped' || fail "did not stop cleanly"

after="$(cd "$work/videos" && find . -exec stat -c '%n %s %Y' {} + | sort; find . -type f -exec sha256sum {} + | sort)"
[ "$before" = "$after" ] || fail "the video folder changed"

echo "--- Starting it again with no network at all, not even to the computer"
docker run -d --name franzplay-offline --network none -e PUID="$uid" -e PGID="$gid" \
	-v "$work/videos:/videos:ro" -v "$work/offline:/data" "$image" >/dev/null
i=0
until docker logs franzplay-offline 2>&1 | grep -q 'kind=preview'; do
	i=$((i + 1))
	[ "$i" -le 60 ] || fail "offline: no cover and preview after 120 seconds"
	sleep 2
done
docker logs franzplay-offline 2>&1 | grep -q 'kind=cover' || fail "offline: no cover"
docker exec franzplay-offline wget -q -O - http://127.0.0.1:8090/api/health | grep -q '"ok"' ||
	fail "offline: health"
if docker logs franzplay-offline 2>&1 | grep 'level=ERROR'; then
	fail "offline: errors in the log"
fi
docker rm -f franzplay-offline >/dev/null

echo "OK: FranzPLAY works in Docker, with or without internet"
