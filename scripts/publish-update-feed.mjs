import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { publishUpdateFeed } from "./release-publisher.mjs";

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }).trim();
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const repo = "soundtrackgeek/forever";
const tag = `v${version}`;
const dir = await mkdtemp(join(tmpdir(), "forever-feed-"));
if (dirname(resolve(dir)) !== resolve(tmpdir())) throw new Error("Unexpected temporary feed directory.");
try {
  gh("release", "download", tag, "--repo", repo, "--pattern", "latest.json", "--dir", dir);
  const file = join(dir, "latest.json");
  const channel = await publishUpdateFeed({ gh, version, branch: process.env.GITHUB_REF_NAME, sha: process.env.GITHUB_SHA, file, releaseId: process.env.RELEASE_ID });
  console.log(`Published ${tag} to ${channel}; Beta follows the newest stable or beta version.`);
} finally {
  // Only the uniquely created task directory is removed.
  await rm(dir, { recursive: true, force: true });
}
