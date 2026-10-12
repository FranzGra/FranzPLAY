# FranzPLAY

**Your personal YouTube at home.** A free, lightweight, self-hosted video platform written in Go:
drop your videos in a folder and watch, like, comment and share them with family and friends.
Runs smoothly on a Raspberry Pi.

> 🚧 **Early development.** FranzPLAY is being rewritten from scratch. It is not usable yet.

## Goals

- **Every item is a video**, not a movie or an episode: likes, comments, playlists, continue watching.
- **Light**: one program, one SQLite file, well under 100 MB of RAM. Built for a Raspberry Pi 4.
- **Your files stay yours**: video folders are read-only. FranzPLAY never renames, converts or deletes them.
- **Fast**: new videos and their covers appear within seconds.
- **Works offline**: online sources for covers and metadata are optional.

The full vision (in Italian) is in [`docs/visione.md`](docs/visione.md).

## Try it

You need [Go](https://go.dev/dl/) 1.26 or newer and [Node.js](https://nodejs.org/) 22. [FFmpeg](https://ffmpeg.org/) is needed to read video details and make covers.

```sh
make web     # build the web interface
make run     # start FranzPLAY
# then open http://localhost:8090
```

On the first start FranzPLAY has no users: it writes a one-time **setup code** in its log
(`setup_code=XXXX-XXXX-XXXX`), which is needed to create the administrator. Everything else
needs a login.

Step-by-step guide for Windows, Mac and Linux (in Italian): [`docs/provare-sul-pc.md`](docs/provare-sul-pc.md).
Moving from the old FranzPLAY (in Italian): [`docs/importare-dal-vecchio.md`](docs/importare-dal-vecchio.md).
Android app (in Italian): [`docs/app-android.md`](docs/app-android.md).

| Variable | Default | What it does |
|---|---|---|
| `FRANZPLAY_ADDR` | `:8090` | Address and port of the web server |
| `FRANZPLAY_DATA_DIR` | `data` | FranzPLAY's own data folder |
| `FRANZPLAY_LIBRARIES` | none | Video folders, read-only (separated by `;` on Windows, `:` elsewhere) |
| `FRANZPLAY_FFPROBE` | `ffprobe` | ffprobe program (a name in PATH or a full path) |
| `FRANZPLAY_FFMPEG` | `ffmpeg` | ffmpeg program (a name in PATH or a full path) |
| `FRANZPLAY_WHISPER` | `whisper-cli` | whisper.cpp program for automatic subtitles; when missing, they are off |
| `FRANZPLAY_TRANSLATE_URL` | none | Address of a LibreTranslate server that translates subtitles, like `http://localhost:5000` |
| `FRANZPLAY_TRANSLATE_KEY` | none | LibreTranslate key, when the server asks for one |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

FranzPLAY is free software under the [GNU AGPL-3.0](LICENSE): you can use, study, share and modify
it, and if you distribute it or offer it as an online service, you must share your source code
under the same license.

A separate **commercial license** is available from the author for uses that cannot follow the
AGPL. See [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md).

Copyright © 2026 [FranzGra](https://github.com/FranzGra).
