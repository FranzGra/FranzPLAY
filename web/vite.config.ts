import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The built interface goes inside the Go program (internal/webui/dist/app),
// so FranzPLAY stays a single file to install.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../internal/webui/dist/app",
    emptyOutDir: true,
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
