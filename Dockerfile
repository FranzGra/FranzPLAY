# syntax=docker/dockerfile:1.10
#
# FranzPLAY in one small image: the program (interface included), ffmpeg
# and ffprobe for the videos, and whisper.cpp for automatic subtitles.
#
# The interface and the program are built on the machine that builds the
# image, for any target: so an image for a Raspberry Pi builds fast even
# on a normal computer. Only the last step runs on the target system.
#
#   docker build -t franzplay .
#
# See docs/docker.md for how to use it.

ARG ALPINE_VERSION=3.22

# --- 1. The web interface (React), built once: it is the same everywhere.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
# Vite writes into ../internal/webui/dist/app, next to the Go code.
RUN mkdir -p ../internal/webui/dist && npm run build

# --- 2. The Go program, cross-compiled for the target system.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS program
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=web /src/internal/webui/dist/app internal/webui/dist/app
ARG TARGETOS TARGETARCH TARGETVARIANT
ARG VERSION=dev
# RELEASE is the official release ("1.2.3" or "v1.2.3"), only when the
# image is built from a v1.2.3 tag. Empty: a development build.
ARG RELEASE=
# SQLite is pure Go here: no C compiler, one static file.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION -X main.release=$RELEASE" \
      -o /out/franzplay ./cmd/franzplay

# --- 3. whisper.cpp, for automatic subtitles. Built on the target system
# (it is C++), without -march=native, so it runs on any CPU of that kind.
FROM alpine:${ALPINE_VERSION} AS whisper
RUN apk add --no-cache build-base cmake
ARG WHISPER_VERSION=v1.9.5
ADD https://github.com/ggml-org/whisper.cpp.git#${WHISPER_VERSION} /src
WORKDIR /src
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build build --config Release --target whisper-cli -j"$(nproc)" \
 && install -D -s build/bin/whisper-cli /out/whisper-cli

# --- 4. The image that runs: Alpine, ffmpeg and the two programs.
FROM alpine:${ALPINE_VERSION}
# ffmpeg: covers, previews, copies for the browsers. ca-certificates: the
# online sources and the whisper models are on https. tzdata: the TZ
# setting. su-exec: start as the user chosen with PUID and PGID.
# libstdc++: whisper-cli is C++.
RUN apk add --no-cache ffmpeg ca-certificates tzdata su-exec libstdc++
COPY --from=program /out/franzplay /usr/local/bin/franzplay
COPY --from=whisper /out/whisper-cli /usr/local/bin/whisper-cli
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Settings that belong to the image: where things are inside it.
# The rest (port, video folders, user…) is chosen in compose.yaml and .env.
ENV FRANZPLAY_ADDR=:8090 \
    FRANZPLAY_DATA_DIR=/data \
    FRANZPLAY_LIBRARIES=/videos \
    PUID=1000 \
    PGID=1000

EXPOSE 8090
VOLUME /data
# Docker asks every 30 seconds whether FranzPLAY answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["franzplay"]

LABEL org.opencontainers.image.title="FranzPLAY" \
      org.opencontainers.image.description="Il tuo YouTube personale, a casa tua." \
      org.opencontainers.image.source="https://github.com/FranzGra/FranzPLAY" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
