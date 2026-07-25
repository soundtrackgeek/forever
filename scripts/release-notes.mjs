import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
const version = packageJson.version;
const escapedVersion = version.replaceAll(".", "\\.");
const heading = new RegExp(
  `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
  "m",
);
const match = heading.exec(changelog);

if (!match) {
  throw new Error(`CHANGELOG.md has no dated ${version} release heading.`);
}

const sectionStart = match.index + match[0].length;
const nextRelease = changelog.slice(sectionStart).search(/^## \[/m);
const sectionEnd =
  nextRelease === -1 ? changelog.length : sectionStart + nextRelease;
const section = changelog.slice(sectionStart, sectionEnd).trim();

if (!section) {
  throw new Error(`The ${version} changelog section is empty.`);
}

process.stdout.write(
  [
    `## What’s new in Forever ${version}`,
    "",
    section,
    "",
    "## Install",
    "",
    "Download `Forever_*_x64-setup.exe` for the recommended Windows installer.",
    "Every updater artifact is signed and verified by Forever before installation.",
  ].join("\n"),
);
