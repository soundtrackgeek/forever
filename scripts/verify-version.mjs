import { readFile } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
);
const cargoToml = await readFile(
  new URL("src-tauri/Cargo.toml", root),
  "utf8",
);
const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");

const cargoPackage = cargoToml.match(
  /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

if (!cargoPackage) {
  throw new Error("Could not find the Cargo package version.");
}

const versions = {
  package: packageJson.version,
  tauri: tauriConfig.version,
  cargo: cargoPackage[1],
};
const uniqueVersions = new Set(Object.values(versions));

if (uniqueVersions.size !== 1) {
  throw new Error(
    `Version mismatch: ${Object.entries(versions)
      .map(([source, version]) => `${source}=${version}`)
      .join(", ")}`,
  );
}

const version = versions.tauri;
const changelogPattern = new RegExp(
  `^## \\[${version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  "m",
);

if (!changelogPattern.test(changelog)) {
  throw new Error(`CHANGELOG.md has no dated ${version} release heading.`);
}

if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${version}`) {
  throw new Error(
    `Release tag ${process.env.RELEASE_TAG} does not match version v${version}.`,
  );
}

process.stdout.write(version);
