# syntax=docker/dockerfile:1.10
#
# FranzPLAY in one small image: the program (interface included), ffmpeg
# and ffprobe for the videos, whisper.cpp for automatic subtitles and Bergamot
# to translate them.
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

# --- 4. The translator of subtitles: Bergamot (Mozilla's, the one in Firefox),
# for translating with no other container. Built on the target system like
# whisper.cpp; it picks the best instructions of the CPU when it runs. Only
# the folder of the translator, at a fixed commit, is taken from the big
# repository, with three small changes for Alpine (none in how it translates):
#  1. faiss uses int64_t without including <cstdint>
#  2. zstr picks the GNU strerror_r since g++ sets _GNU_SOURCE; musl has the other
#  3. musl has no execinfo.h (backtraces): an empty stand-in
FROM alpine:${ALPINE_VERSION} AS translator
RUN apk add --no-cache build-base cmake linux-headers git pcre2-dev
ARG TARGETARCH
ARG BERGAMOT_REVISION=8eada038fd45bbf6fa58a412b22f80c79887fabc
# Few at a time: this is heavy C++, and it must not stop the machine building.
ARG BERGAMOT_JOBS=4
WORKDIR /src
RUN git init -q . \
 && git remote add origin https://github.com/mozilla/translations \
 && git sparse-checkout set --cone inference \
 && git fetch -q --depth=1 --filter=blob:none origin ${BERGAMOT_REVISION} \
 && git checkout -q FETCH_HEAD \
 && git submodule update -q --init --depth=1 inference/3rd_party/ssplit-cpp \
      inference/marian-fork/src/3rd_party/sentencepiece \
      inference/marian-fork/src/3rd_party/intgemm \
      inference/marian-fork/src/3rd_party/ruy \
      inference/marian-fork/src/3rd_party/simd_utils \
      inference/marian-fork/src/3rd_party/onnxjs \
 && (cd inference/marian-fork/src/3rd_party/ruy && git submodule update -q --init --depth=1 || true) \
 && (cd inference/3rd_party/ssplit-cpp && git submodule update -q --init --depth=1 || true)
WORKDIR /src/inference
RUN sed -i '1i #include <cstdint>' marian-fork/src/3rd_party/faiss/utils/misc.h \
 && sed -i 's/^#elif (_POSIX_C_SOURCE >= 200112L.*/#elif 1/' marian-fork/src/3rd_party/zstr/strict_fstream.hpp \
 && printf '%s\n' '#pragma once' \
      'static inline int backtrace(void **b, int n) { (void)b; (void)n; return 0; }' \
      'static inline char **backtrace_symbols(void *const *b, int n) { (void)b; (void)n; return 0; }' \
      > /usr/include/execinfo.h
# The same steps on both systems; only the name of the processor changes.
# Ruy does the matrix sums too, so that OpenBLAS (33 MB more) is not needed.
# On ARM, marian's CMake turns on its NEON code with options that stay inside
# its own folder (marian-fork/CMakeLists.txt, USE_SIMD_UTILS). The translator
# is in another folder and includes the same headers, so it gets them here.
# Marian replaces CMAKE_CXX_FLAGS with its own, so this changes only the
# translator; on x86-64 it stays empty, as before.
RUN flags= \
 && case "$TARGETARCH" in \
      arm64) arch=armv8-a flags='-DARM -DFMA -DSSE -flax-vector-conversions -fno-strict-aliasing' ;; \
      *) arch=x86-64 ;; \
    esac \
 && cmake -B /build -DCMAKE_BUILD_TYPE=Release -DBUILD_ARCH=$arch "-DCMAKE_CXX_FLAGS=$flags" \
      -DGIT_SUBMODULE=OFF -DUSE_MKL=OFF -DCOMPILE_TESTS=OFF -DUSE_RUY=ON -DUSE_RUY_SGEMM=ON \
 && cmake --build /build --target translator-cli -j"${BERGAMOT_JOBS}" \
 && install -D -s /build/src/app/translator-cli /out/translator-cli

# --- 5. The image that runs: Alpine, ffmpeg and the three programs.
FROM alpine:${ALPINE_VERSION}
# ffmpeg: covers, previews, copies for the browsers. ca-certificates: the
# online sources and the models are on https. tzdata: the TZ setting.
# su-exec: start as the user chosen with PUID and PGID. libstdc++: whisper-cli
# and translator-cli are C++. pcre2: translator-cli splits text with it.
RUN apk add --no-cache ffmpeg ca-certificates tzdata su-exec libstdc++ pcre2
COPY --from=program /out/franzplay /usr/local/bin/franzplay
COPY --from=whisper /out/whisper-cli /usr/local/bin/whisper-cli
COPY --from=translator /out/translator-cli /usr/local/bin/translator-cli
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
