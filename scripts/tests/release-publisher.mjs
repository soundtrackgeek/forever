import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { publishUpdateFeed } from "../release-publisher.mjs";

async function fixture(t, version = "0.0.72", betaVersion, stableVersion) {
  const dir = await mkdtemp(join(tmpdir(), "forever-publisher-test-"));
  t.after(async () => { if (dirname(resolve(dir)) !== resolve(tmpdir())) throw new Error("Unexpected temp path"); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, "latest.json");
  const assets = ["Forever_x64-setup.exe", "Forever_x64-setup.exe.sig", "Forever_x64.msi", "Forever_x64.msi.sig", "SHA256SUMS.txt"].map((name, index) => ({ name,
    url: `https://api.github.com/repos/soundtrackgeek/forever/releases/assets/${index}`,
    browser_download_url: `https://github.com/soundtrackgeek/forever/releases/download/v${version}/${name}`,
  }));
  await writeFile(file, JSON.stringify({ version, platforms: { "windows-x86_64": { url: assets[0].url, signature: "signed" } } }));
  const releases = [];
  if (betaVersion) releases.push({ tag_name: "beta", prerelease: true, draft: false, assets: [{ name: "latest.json", id: 99 }] });
  if (stableVersion) releases.push({ tag_name: `v${stableVersion}`, prerelease: false, draft: false, assets: [] });
  const calls = [];
  const gh = (...args) => {
    calls.push(args);
    if (args[0] !== "api") return "";
    if (args[1].includes("?per_page")) return JSON.stringify([releases]);
    if (args[1].includes("/tags/")) return JSON.stringify({ assets });
    if (args[1].endsWith("/99")) return JSON.stringify({ version: betaVersion });
    throw new Error("Unexpected API call");
  };
  return { assets, calls, file, gh, version, branch: version.includes("-beta.") ? "beta" : "master", sha: "test-sha" };
}
test("stable publication normalizes metadata before publishing and bootstraps Beta as prerelease", async (t) => {
  const f = await fixture(t); await publishUpdateFeed(f);
  const writes = f.calls.filter((call) => call[0] === "release");
  assert.deepEqual(writes.map((call) => call.slice(1, 3)), [["upload", "v0.0.72"], ["edit", "v0.0.72"], ["create", "beta"], ["upload", "beta"]]);
  assert.ok(writes[1].includes("--latest=true"));
  assert.ok(writes[2].includes("--prerelease")); assert.ok(writes[2].includes("--latest=false"));
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).platforms["windows-x86_64"].url, f.assets[0].browser_download_url);
});
test("Beta release never becomes Latest and advances an older beta", async (t) => {
  const f = await fixture(t, "0.0.73-beta.2", "0.0.73-beta.1"); await publishUpdateFeed(f);
  assert.ok(f.calls.find((call) => call[1] === "edit").includes("--latest=false"));
  assert.ok(f.calls.some((call) => call[1] === "upload" && call[2] === "beta"));
});
test("stable release leaves a newer Beta feed intact and refuses old Stable recovery", async (t) => {
  const f = await fixture(t, "0.0.72", "0.0.73-beta.1"); await publishUpdateFeed(f);
  assert.ok(!f.calls.some((call) => call[1] === "upload" && call[2] === "beta"));
  const old = await fixture(t, "0.0.72", undefined, "0.0.73");
  await assert.rejects(publishUpdateFeed(old), /newer Stable/);
  assert.ok(!old.calls.some((call) => call[0] === "release"));
});
test("incomplete artifacts or foreign URLs never publish a draft", async (t) => {
  const f = await fixture(t); f.assets.pop();
  await assert.rejects(publishUpdateFeed(f), /Missing release artifact/);
  assert.ok(!f.calls.some((call) => call[0] === "release"));
  const bad = await fixture(t); bad.assets[0].browser_download_url = "https://example.com/setup.exe";
  await assert.rejects(publishUpdateFeed(bad), /does not belong/);
  assert.ok(!bad.calls.some((call) => call[0] === "release"));
});
