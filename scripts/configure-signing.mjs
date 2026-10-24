import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { signingConfig, windowsInstallerVersion } from "./release-policy.mjs";

const config = signingConfig(process.env, fileURLToPath(new URL("./sign-windows.ps1", import.meta.url)));
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const enabled = Boolean(config.bundle);
config.bundle ??= { windows: {} };
config.bundle.windows.wix = { version: windowsInstallerVersion(version) };
await writeFile(new URL("../src-tauri/tauri.signing.generated.json", import.meta.url), JSON.stringify(config, null, 2));
console.log(enabled ? "Azure Authenticode signing is required for this release." : "Authenticode signing is not configured; Tauri updater signatures remain required.");
