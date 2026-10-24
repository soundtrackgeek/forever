import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(
    new URL("../dist/.vite/manifest.json", import.meta.url),
    "utf8",
  ),
);
const eager = new Set();
function visit(key) {
  if (eager.has(key)) return;
  eager.add(key);
  for (const imported of manifest[key]?.imports ?? []) visit(imported);
}
visit("index.html");
const routes = [
  "Home",
  "Files",
  "Albums",
  "Archive",
  "Rooms",
  "Messages",
  "People",
  "Browse",
  "Transfers",
  "Settings",
];
const chunks = new Set();
for (const route of routes) {
  const key = `src/shell/workspaces/${route}Route.tsx`;
  assert.ok(manifest[key]?.isDynamicEntry, `${route} must have a lazy entry`);
  assert.ok(!eager.has(key), `${route} was pulled into the startup bundle`);
  chunks.add(manifest[key].file);
}
assert.equal(
  chunks.size,
  routes.length,
  "Each workspace must have its own chunk",
);
console.log(
  `Verified ${chunks.size} lazy workspace chunks outside the startup import graph.`,
);
