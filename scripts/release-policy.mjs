import semver from "semver";

export function releaseChannel(version, branch) {
  if (semver.valid(version) !== version) throw new Error("Release version must be canonical SemVer.");
  if (semver.parse(version).build.length) throw new Error("Release versions must not contain build metadata.");
  const pre = semver.prerelease(version);
  const channel = pre === null ? "stable" : "beta";
  if (pre && (pre.length !== 2 || pre[0] !== "beta" || !Number.isInteger(pre[1]))) {
    throw new Error("Prereleases must use X.Y.Z-beta.N.");
  }
  if (branch && branch !== (channel === "stable" ? "master" : "beta")) {
    throw new Error("Stable releases must come from master; beta versions must come from beta.");
  }
  return channel;
}

export function windowsInstallerVersion(version) {
  releaseChannel(version);
  const { major, minor, patch } = semver.parse(version);
  if (major > 255 || minor > 255 || patch > 65535) throw new Error("Version exceeds Windows Installer limits.");
  // MSI cannot encode beta.N. Tauri allows same-version MSI upgrades; the updater
  // compares the complete SemVer before offering either installer format.
  return `${major}.${minor}.${patch}`;
}

export function normalizeFeed(feed, version, repository, assets) {
  if (feed.version !== version) throw new Error("Updater feed version does not match the release.");
  const result = structuredClone(feed);
  for (const platform of Object.values(result.platforms ?? {})) {
    const asset = assets.find((item) => item.url === platform.url || item.browser_download_url === platform.url);
    if (!asset || !platform.signature?.trim()
        || !asset.browser_download_url?.startsWith(`https://github.com/${repository}/releases/download/v${version}/`)) {
      throw new Error("Updater artifact does not belong to this versioned release.");
    }
    platform.url = asset.browser_download_url;
  }
  validateFeed(result, version, repository);
  return result;
}

export function validateFeed(feed, version, repository) {
  if (feed.version !== version) throw new Error("Updater feed version does not match the release.");
  const platform = feed.platforms?.["windows-x86_64"];
  const prefix = `https://github.com/${repository}/releases/download/v${version}/`;
  if (!platform || !platform.signature?.trim() || !platform.url?.startsWith(prefix)
      || !platform.url.endsWith("-setup.exe")) {
    throw new Error("Updater feed must contain a signed Windows NSIS installer at the immutable version tag.");
  }
}

export function shouldAdvanceBeta(current, candidate) {
  if (!semver.valid(candidate) || (current && !semver.valid(current))) throw new Error("Invalid channel feed version.");
  return !current || semver.gte(candidate, current);
}

export function signingConfig(env, scriptPath) {
  const mode = env.WINDOWS_SIGNING ?? "";
  if (!["", "disabled", "azure"].includes(mode)) throw new Error("WINDOWS_SIGNING must be azure or disabled.");
  if (mode !== "azure") return {};
  for (const key of ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE"]) {
    if (!env[key]?.trim()) throw new Error(`Windows signing is enabled but ${key} is missing.`);
  }
  const url = new URL(env.AZURE_SIGNING_ENDPOINT);
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.codesigning\.azure\.net$/.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
    throw new Error("AZURE_SIGNING_ENDPOINT must be an Azure HTTPS signing endpoint.");
  }
  return { bundle: { windows: { signCommand: {
    cmd: "pwsh", args: ["-NoProfile", "-File", scriptPath, "%1"],
  } } } };
}
