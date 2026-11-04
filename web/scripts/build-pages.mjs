// GitHub Pages is a static export. Next refuses `output: "export"` when
// app/api route handlers exist, so move the BFF aside for this build only.
import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = path.join(webRoot, "app/api");
const stash = path.join(webRoot, ".pages-export-stash/api");

async function build() {
  const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [nextBin, "build"], {
      cwd: webRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        STATIC_EXPORT: "1",
        NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || "/yixing-finance",
        NEXT_PUBLIC_FIN_API_TOKEN: "",
      },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let stashed = false;
let code = 1;
try {
  await rm(stash, { recursive: true, force: true });
  await mkdir(path.dirname(stash), { recursive: true });
  await rename(route, stash);
  stashed = true;
  code = await build();
} finally {
  if (stashed) {
    await rm(route, { recursive: true, force: true });
    await rename(stash, route);
    await rm(path.dirname(stash), { recursive: true, force: true });
  }
}
process.exit(code);
