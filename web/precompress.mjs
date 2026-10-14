// Kept in plain JavaScript: it runs in Node during the build, outside the
// browser code that tsconfig checks.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// precompress writes next to each script and style a brotli (.br) and a gzip
// (.gz) copy, squeezed as much as possible once here. The Go server sends the
// copy the browser can read, without compressing anything itself.
/** @returns {import("vite").Plugin} */
export function precompress() {
  return {
    name: "franzplay-precompress",
    apply: "build",
    writeBundle(options) {
      const dir = join(options.dir ?? "dist", "assets");
      for (const name of readdirSync(dir)) {
        if (!/\.(js|css|svg|json|txt)$/.test(name)) continue;
        const plain = readFileSync(join(dir, name));
        writeFileSync(
          join(dir, `${name}.br`),
          brotliCompressSync(plain, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
              [constants.BROTLI_PARAM_SIZE_HINT]: plain.length,
            },
          }),
        );
        writeFileSync(join(dir, `${name}.gz`), gzipSync(plain, { level: 9 }));
      }
    },
  };
}
