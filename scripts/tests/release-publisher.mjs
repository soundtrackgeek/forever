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
  const release = { id: 42, tag_name: `v${version}`, draft: true, prerelease: version.includes("-beta."), assets };
  const releases = [release];
  if (betaVersion) releases.push({ tag_name: "beta", prerelease: true, draft: false, assets: [{ name: "latest.json", id: 99 }] });
  if (stableVersion) releases.push({ tag_name: `v${stableVersion}`, prerelease: false, draft: false, assets: [] });
  const calls = [];
  const gh = (...args) => {
    calls.push(args);
    if (args[0] !== "api") return "";
    if (args[1].includes("?per_page")) return JSON.stringify([releases]);
    if (args[1].includes("/tags/")) throw new Error("gh: Not Found (HTTP 404): tag lookup excludes drafts");
    if (args[1].endsWith("/releases/42")) return JSON.stringify(release);
    if (args[1].endsWith("/99")) return JSON.stringify({ version: betaVersion });
    throw new Error("Unexpected API call");
  };
  return { release, releases, assets, calls, file, gh, version, branch: version.includes("-beta.") ? "beta" : "master", sha: "test-sha" };
}

test("CI uses the installer action release ID even before a draft appears in listings", async (t) => {
  const f = await fixture(t); f.releases.length = 0;
  for (const asset of f.assets) asset.browser_download_url = asset.browser_download_url.replace(`v${f.version}`, "untagged-41780c2a5b4268f283f5");
  await publishUpdateFeed({ ...f, releaseId: "42" });
  assert.ok(f.calls.some((call) => call[1].endsWith("/releases/42")));
  assert.ok(!f.calls.some((call) => call[1].includes("/tags/")));
  assert.ok(f.calls.some((call) => call[1] === "edit"));
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).platforms["windows-x86_64"].url,
    `https://github.com/soundtrackgeek/forever/releases/download/v${f.version}/${f.assets[0].name}`);
  // A retry after replacing latest.json but before publishing must accept the
  // already-normalized feed while GitHub still reports temporary draft URLs.
  await publishUpdateFeed({ ...f, releaseId: "42" });
});

test("manual recovery finds a draft on a later release-list page and supports published recovery", async (t) => {
  for (const draft of [true, false]) {
    const f = await fixture(t); f.release.draft = draft;
    const gh = (...args) => args[1].includes("?per_page")
      ? JSON.stringify([[{ id: 1, tag_name: "v0.0.71", draft: false, prerelease: false }], f.releases]) : f.gh(...args);
    await publishUpdateFeed({ ...f, gh });
    assert.ok(f.calls.some((call) => call[1] === "edit"));
  }
});

test("missing, ambiguous, invalid, or mismatched release identities never publish", async (t) => {
  const missing = await fixture(t); missing.releases.length = 0;
  await assert.rejects(publishUpdateFeed(missing), /found 0/);
  const duplicate = await fixture(t); duplicate.releases.push({ ...duplicate.release, id: 43 });
  await assert.rejects(publishUpdateFeed(duplicate), /found 2/);
  const mismatch = await fixture(t); mismatch.release.tag_name = "v0.0.71";
  await assert.rejects(publishUpdateFeed({ ...mismatch, releaseId: 42 }), /does not match/);
  const invalid = await fixture(t);
  await assert.rejects(publishUpdateFeed({ ...invalid, releaseId: "../tags/v0.0.72" }), /Invalid release ID/);
  for (const f of [missing, duplicate, mismatch, invalid]) assert.ok(!f.calls.some((call) => call[0] === "release"));
});
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
