# syntax=docker/dockerfile:1.10
#
# The browser checks in Docker: FranzPLAY built from this folder's code,
# ffmpeg, and the Playwright image with the same version as package.json.
# Built from the root of the repository (see run.sh):
#
#   docker build -f e2e/docker/Dockerfile -t franzplay-test-e2e:local .

ARG PLAYWRIGHT_VERSION=1.56.1

# --- 1. The web interface, as in the real image.
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,id=franzplay-test-e2e-npm,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN mkdir -p ../internal/webui/dist && npm run build

# --- 2. The program, interface inside.
FROM golang:1.26-alpine AS program
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,id=franzplay-test-e2e-gomod,target=/go/pkg/mod go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=web /src/internal/webui/dist/app internal/webui/dist/app
RUN --mount=type=cache,id=franzplay-test-e2e-gomod,target=/go/pkg/mod \
    --mount=type=cache,id=franzplay-test-e2e-gobuild,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -o /out/franzplay ./cmd/franzplay

# --- 3. Playwright with Chromium, ffmpeg and the program.
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY --from=program /out/franzplay /usr/local/bin/franzplay
ENV FRANZPLAY_BIN=/usr/local/bin/franzplay
