#!/bin/sh
# Installs ffmpeg on a GitHub runner, with apt.
#
# apt can wait forever on a mirror that stops answering: on 06-11-2026
# "apt-get update" stood still twice for over 30 minutes, and apt's own time
# limits did not stop it. So every apt command here has a hard time limit
# (timeout kills it), and there are three tries. A normal install takes about
# 20 seconds; the step's timeout-minutes in the workflow is the last guard.
set -eu

apt_get() {
  limit=$1
  shift
  sudo timeout --kill-after=10 "$limit" apt-get \
    -o Acquire::Retries=3 \
    -o Acquire::http::Timeout=30 \
    -o Acquire::https::Timeout=30 \
    -o DPkg::Lock::Timeout=60 \
    "$@"
}

for try in 1 2 3; do
  if apt_get 120 update && apt_get 240 install -y --no-install-recommends ffmpeg; then
    ffmpeg -hide_banner -version | head -n 1
    exit 0
  fi
  echo "::warning::ffmpeg: apt failed or took too long (try $try of 3)"
  # A try stopped halfway can leave dpkg half done: finish it first.
  sudo dpkg --configure -a || true
  sleep 10
done
echo "::error::ffmpeg: apt failed three times"
exit 1
