#!/bin/sh
# Starts FranzPLAY inside the container as the user chosen with PUID and
# PGID, never as root. The data folder is made theirs first; the video
# folders are never touched (they are mounted read-only).
set -eu

if [ "$(id -u)" = 0 ]; then
	for id in "$PUID" "$PGID"; do
		case "$id" in
		'' | *[!0-9]*)
			echo "entrypoint: PUID and PGID must be numbers, got PUID=$PUID PGID=$PGID" >&2
			exit 1
			;;
		esac
	done
	if [ "$PUID" = 0 ]; then
		echo "entrypoint: PUID=0 would run FranzPLAY as root: choose your user's number (id -u)" >&2
		exit 1
	fi
	data="${FRANZPLAY_DATA_DIR:-/data}"
	mkdir -p "$data"
	# Only what is not already theirs: fast when nothing changed.
	# Some folders shared from Windows or a NAS refuse a new owner: say so,
	# and try to start anyway.
	if ! find "$data" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} +; then
		echo "entrypoint: could not give $data to $PUID:$PGID; FranzPLAY may not be able to write there" >&2
	fi
	exec su-exec "$PUID:$PGID" "$@"
fi

# Started as another user already (for example with "user:" in compose).
exec "$@"
