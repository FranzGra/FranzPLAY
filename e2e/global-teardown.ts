import { readFileSync, rmSync } from "node:fs";
import { STATE_FILE } from "./tests/franzplay";

export default async function globalTeardown() {
  const { pid, root } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    pid: number;
    root: string;
  };
  process.kill(pid, "SIGTERM");
  // Give FranzPLAY a moment to stop, then remove its folders.
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(root, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}
