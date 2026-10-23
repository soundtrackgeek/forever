import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

// npm/Vite/Vitest run from the repository root, including jsdom tests where
// Vite rewrites import.meta.url to an HTTP URL.
const root = process.cwd();
const target = path.join(root, "src-tauri", "target", "matching");
const binary = path.join(target, "debug", `forever-matching${process.platform === "win32" ? ".exe" : ""}`);
let ready;
export function prepareMatchingRuntime() {
  ready ??= new Promise((resolve, reject) => {
    const child = spawn("cargo", ["build", "--locked", "--manifest-path", "src-tauri/matching/Cargo.toml", "--target-dir", target], { cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (data) => { errors += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(errors)));
  });
  return ready;
}

export async function runMatching(command, args) {
  await prepareMatchingRuntime();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let errors = "";
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { errors += data; });
    child.stdin.on("error", reject);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(errors || "Matching process failed")); return; }
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ command, args }));
  });
}

export function matchingPreviewPlugin() {
  const configure = (server) => {
    server.middlewares.use("/__forever_matching", async (request, response) => {
      if (request.method !== "POST" || request.headers["content-type"] !== "application/json") { response.statusCode = 405; response.end(); return; }
      try {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 8 * 1024 * 1024) throw new Error("Matching request too large");
        }
        const { command, args } = JSON.parse(body);
        const result = await runMatching(command, args);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(String(error)); }
    });
  };
  return { name: "forever-rust-matching", configureServer: configure, configurePreviewServer: configure };
}
