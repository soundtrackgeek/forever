import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseChannel, shouldAdvanceBeta, signingConfig, validateFeed, normalizeFeed, windowsInstallerVersion } from "../release-policy.mjs";

test("stable and beta releases cannot cross branches or accept arbitrary prereleases", () => {
  assert.equal(releaseChannel("0.0.72", "master"), "stable");
  assert.equal(releaseChannel("0.0.73-beta.1", "beta"), "beta");
  for (const [version, branch] of [["0.0.73-beta.1", "master"], ["0.0.73", "beta"], ["0.0.73-rc.1", "beta"], ["0.0.73-beta.x", "beta"]]) {
    assert.throws(() => releaseChannel(version, branch));
  }
});
test("MSI gets a numeric version while the app keeps full SemVer", () => {
  assert.equal(windowsInstallerVersion("0.0.73-beta.1"), "0.0.73");
  assert.equal(windowsInstallerVersion("0.0.73"), "0.0.73");
  assert.throws(() => windowsInstallerVersion("0.256.0"));
  assert.throws(() => releaseChannel("0.0.73+1"));
});
test("tauri-action API asset URLs normalize to the exact release download", () => {
  const asset = { name: "Forever_0.0.73-beta.1_x64-setup.exe", url: "https://api.github.com/repos/soundtrackgeek/forever/releases/assets/123",
    browser_download_url: "https://github.com/soundtrackgeek/forever/releases/download/v0.0.73-beta.1/Forever_0.0.73-beta.1_x64-setup.exe" };
  const feed = { version: "0.0.73-beta.1", platforms: { "windows-x86_64": { url: asset.url, signature: "signed" } } };
  assert.equal(normalizeFeed(feed, feed.version, "soundtrackgeek/forever", [asset]).platforms["windows-x86_64"].url, asset.browser_download_url);
  assert.throws(() => normalizeFeed(feed, feed.version, "soundtrackgeek/forever", []));
  assert.equal(feed.platforms["windows-x86_64"].url, asset.url);
});

test("draft untagged URLs become public URLs only for verified release asset membership", () => {
  const repo = "soundtrackgeek/forever", version = "0.0.76";
  const asset = { name: "Forever_0.0.76_x64-setup.exe", url: `https://api.github.com/repos/${repo}/releases/assets/672426805`,
    browser_download_url: `https://github.com/${repo}/releases/download/untagged-41780c2a5b4268f283f5/Forever_0.0.76_x64-setup.exe` };
  const feed = { version, platforms: { "windows-x86_64": { url: asset.url, signature: "signed" } } };
  const expected = `https://github.com/${repo}/releases/download/v${version}/${asset.name}`;
  assert.equal(normalizeFeed(feed, version, repo, [asset], {draft:true}).platforms["windows-x86_64"].url, expected);
  assert.throws(() => normalizeFeed(feed, version, repo, [asset]));
  for (const url of [asset.browser_download_url.replace("soundtrackgeek", "other-owner"), asset.browser_download_url + "?download=1", asset.browser_download_url.replace(asset.name, "other.exe")]) {
    assert.throws(() => normalizeFeed(feed, version, repo, [{...asset, browser_download_url:url}], {draft:true}));
  }
  const wrongId = structuredClone(feed); wrongId.platforms["windows-x86_64"].url += "9";
  assert.throws(() => normalizeFeed(wrongId, version, repo, [asset], {draft:true}));
});
test("Beta follows releases in SemVer order without rolling back a newer experiment", () => {
  assert.equal(shouldAdvanceBeta(undefined, "0.0.72"), true);
  assert.equal(shouldAdvanceBeta("0.0.73-beta.2", "0.0.73-beta.10"), true);
  assert.equal(shouldAdvanceBeta("0.0.73-beta.10", "0.0.73"), true);
  assert.equal(shouldAdvanceBeta("0.0.74-beta.1", "0.0.73"), false);
});
test("feeds must point to the versioned signed installer", () => {
  const feed = { version: "0.0.72", platforms: { "windows-x86_64": {
    signature: "signature", url: "https://github.com/soundtrackgeek/forever/releases/download/v0.0.72/Forever_0.0.72_x64-setup.exe",
  } } };
  validateFeed(feed, "0.0.72", "soundtrackgeek/forever");
  assert.throws(() => validateFeed(feed, "0.0.73", "soundtrackgeek/forever"));
  feed.platforms["windows-x86_64"].signature = "";
  assert.throws(() => validateFeed(feed, "0.0.72", "soundtrackgeek/forever"));
  feed.platforms["windows-x86_64"].signature = "signature";
  feed.platforms["windows-x86_64"].url = "https://example.com/installer-setup.exe";
  assert.throws(() => validateFeed(feed, "0.0.72", "soundtrackgeek/forever"));
});
test("enabled signing fails closed and never embeds credentials in the build config", () => {
  assert.deepEqual(signingConfig({}, "script.ps1"), {});
  assert.throws(() => signingConfig({ WINDOWS_SIGNING: "azur" }, "script.ps1"));
  const env = { WINDOWS_SIGNING: "azure", AZURE_CLIENT_ID: "id", AZURE_CLIENT_SECRET: "secret-value",
    AZURE_TENANT_ID: "tenant", AZURE_SIGNING_ENDPOINT: "https://weu.codesigning.azure.net",
    AZURE_SIGNING_ACCOUNT: "account", AZURE_SIGNING_PROFILE: "profile" };
  const config = signingConfig(env, "C:\\a path\\sign.ps1");
  assert.deepEqual(config.bundle.windows.signCommand.args.slice(-2), ["C:\\a path\\sign.ps1", "%1"]);
  assert.ok(!JSON.stringify(config).includes("secret-value"));
  for (const key of Object.keys(env).filter((key) => key !== "WINDOWS_SIGNING")) {
    assert.throws(() => signingConfig({ ...env, [key]: "" }, "script.ps1"));
  }
  assert.throws(() => signingConfig({ ...env, AZURE_SIGNING_ENDPOINT: "https://example.com" }, "script.ps1"));
});
