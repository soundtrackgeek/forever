import { readFile, writeFile } from "node:fs/promises";
import semver from "semver";
import { releaseChannel, shouldAdvanceBeta, normalizeFeed } from "./release-policy.mjs";

export async function publishUpdateFeed({ gh, version, branch, sha, file, releaseId }) {
  const channel = releaseChannel(version, branch);
  const repo = "soundtrackgeek/forever";
  const tag = `v${version}`;
  const releases = JSON.parse(gh("api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp")).flat();
  if (channel === "stable" && releases.some((release) => !release.draft && !release.prerelease
      && semver.valid(release.tag_name.slice(1)) && semver.gt(release.tag_name.slice(1), version))) {
    throw new Error("Refusing to replace a newer Stable release. Use its checkout for recovery.");
  }
  // The tag endpoint only resolves published releases. The installer action
  // deliberately leaves this release in draft until all checks have passed.
  // Prefer its exact ID; manual recovery discovers drafts in the paginated list.
  if (releaseId === undefined || releaseId === "") {
    const candidates = releases.filter((item) => item.tag_name === tag);
    if (candidates.length !== 1) throw new Error(`Expected exactly one release for ${tag}; found ${candidates.length}. Supply its release ID for recovery.`);
    releaseId = candidates[0].id;
  }
  if (!/^[1-9]\d*$/.test(String(releaseId))) throw new Error("Invalid release ID.");
  const release = JSON.parse(gh("api", `repos/${repo}/releases/${releaseId}`));
  if (release.tag_name !== tag || String(release.id) !== String(releaseId)) throw new Error(`Release ID does not match ${tag}.`);
  // Recovery is safe only for a release with all required artifacts already uploaded.
  for (const suffix of ["-setup.exe", "-setup.exe.sig", ".msi", ".msi.sig", "SHA256SUMS.txt"]) {
    if (!release.assets.some((asset) => asset.name.endsWith(suffix))) throw new Error(`Missing release artifact: ${suffix}`);
  }
  const feed = normalizeFeed(JSON.parse(await readFile(file, "utf8")), version, repo, release.assets, { draft: release.draft });
  const beta = releases.find((item) => item.tag_name === "beta");
  if (beta && (!beta.prerelease || beta.draft)) throw new Error("The beta metadata release must be a published prerelease.");
  const asset = beta?.assets.find((item) => item.name === "latest.json");
  const current = asset ? JSON.parse(gh("api", `repos/${repo}/releases/assets/${asset.id}`, "-H", "Accept: application/octet-stream")).version : undefined;
  const advanceBeta = shouldAdvanceBeta(current, version);
  await writeFile(file, JSON.stringify(feed, null, 2));
  gh("release", "upload", tag, file, "--repo", repo, "--clobber");
  // Checksums, installer signatures, and validated metadata exist before discovery.
  gh("release", "edit", tag, "--repo", repo, "--draft=false", `--prerelease=${channel === "beta"}`, `--latest=${channel === "stable"}`);
  if (advanceBeta) {
    if (!beta) gh("release", "create", "beta", "--repo", repo, "--target", sha,
      "--title", "Beta update feed", "--notes", "Channel metadata only. Installers are linked to versioned releases.", "--prerelease", "--latest=false");
    gh("release", "upload", "beta", file, "--repo", repo, "--clobber");
  }
  return channel;
}
