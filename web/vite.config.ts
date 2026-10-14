import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { precompress } from "./precompress.mjs";

// The built interface goes inside the Go program (internal/webui/dist/app),
// so FranzPLAY stays a single file to install.
export default defineConfig({
  plugins: [react(), precompress()],
  build: {
    outDir: "../internal/webui/dist/app",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React and the router change only when they are updated: in a
            // file of their own they stay in the browser's cache when only
            // FranzPLAY's code changes.
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|react-router|scheduler|cookie|set-cookie-parser)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    // During development, API calls go to the Go server started with "make run".
    proxy: { "/api": "http://localhost:8090" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
