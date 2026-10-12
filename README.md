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

You need [Go](https://go.dev/dl/) 1.26 or newer and [Node.js](https://nodejs.org/) 22.

```sh
make web     # build the web interface
make run     # start FranzPLAY
# then open http://localhost:8090
```

Step-by-step guide for Windows, Mac and Linux (in Italian): [`docs/provare-sul-pc.md`](docs/provare-sul-pc.md).

| Variable | Default | What it does |
|---|---|---|
| `FRANZPLAY_ADDR` | `:8090` | Address and port of the web server |
| `FRANZPLAY_DATA_DIR` | `data` | FranzPLAY's own data folder |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

FranzPLAY is free software under the [GNU AGPL-3.0](LICENSE): you can use, study, share and modify
it, and if you distribute it or offer it as an online service, you must share your source code
under the same license.

A separate **commercial license** is available from the author for uses that cannot follow the
AGPL. See [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md).

Copyright © 2026 [FranzGra](https://github.com/FranzGra).
