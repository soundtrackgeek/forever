# Windows release signing

Forever always requires its existing Tauri updater signing key. This verifies
downloaded update bytes in the app. Authenticode identifies the Windows publisher
and is a separate integration. As of 0.0.72, the integration is implemented but
Azure provisioning and a real signed-installer validation are still pending.

## Activate Azure Artifact Signing

Follow [Microsoft's account setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
to provision an Artifact Signing account, complete identity validation, and create
a **Public Trust** certificate profile. Give the signing application the
Artifact Signing Certificate Profile Signer role scoped to that profile. This
requires the owner's Azure account and identity information; the repository
does not create cloud accounts or choose a software license.

Configure these GitHub repository **variables**:

| Variable | Value |
| --- | --- |
| `WINDOWS_SIGNING` | `azure` to require signing; unset or `disabled` retains current unsigned Windows builds |
| `AZURE_SIGNING_ENDPOINT` | The account's regional HTTPS endpoint, e.g. `https://weu.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | Artifact Signing account name |
| `AZURE_SIGNING_PROFILE` | Public Trust certificate profile name |

Configure these GitHub repository **secrets**: `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID`. Keep the existing
`TAURI_SIGNING_PRIVATE_KEY` unchanged. Rotate the Azure client secret before it
expires. Credentials are passed through environment variables and never written
into generated Tauri configuration or command-line arguments.

The workflow installs .NET 8 and pinned `artifact-signing-cli` 0.12.0, following
[Tauri's Azure signing integration](https://v2.tauri.app/distribute/sign/windows/#azure-artifact-signing).
The Windows hosted runner supplies Azure CLI and the Windows SDK. The generated
configuration uses `bundle.windows.signCommand` with separate argument entries,
so paths containing spaces remain intact. Tauri signs the executable and
installers before generating updater signatures. The signing wrapper checks each
result for a valid, timestamped Authenticode signature. A second workflow check
verifies the executable and both installer formats before publication.

When enabled, a missing setting, invalid endpoint, CLI failure, invalid signature,
or missing timestamp fails the workflow. It never silently falls back to an
unsigned build. When disabled, the release continues with Tauri signatures and
does not claim an Authenticode signature.

## Verify the first signed release

On a clean Windows test installation, verify the downloaded EXE and MSI with
`Get-AuthenticodeSignature -LiteralPath <installer>`. Confirm `Status` is `Valid`,
the publisher is the expected identity, and `TimeStamperCertificate` is present.
Verify the installed `forever.exe` too. Test NSIS and MSI upgrades separately,
including Beta-to-Beta and Beta-to-Stable, preserving settings and transfers.
The local tests cover scheduling, stale channel replies, settings persistence,
feed publication policy and signing configuration failures. They do not prove
certificate issuance, real Authenticode signatures, installed-app upgrades, or
SmartScreen reputation.

## Publication and recovery

Versioned releases remain drafts until artifacts, signatures, checksums, and
validated `latest.json` exist. The publication script converts tauri-action's
GitHub asset API URLs to their corresponding version-tag download URLs and rejects
assets not belonging to the release. It publishes Stable as Latest and Beta as a
prerelease, then advances the separate Beta metadata feed if the version is newer.
The Beta feed also follows newer stable versions. GitHub asset replacement is not
atomic: a failed upload after deleting the previous metadata asset can leave Beta
checks returning 404 until recovery. Installed apps remain untouched and checks
retry normally. Updater signature verification is never bypassed.

For a failed draft build, fix the cause and use a new version or remove only that
failed draft/tag before retrying. If publication succeeded but the Beta feed step
failed, rerun `node scripts/publish-update-feed.mjs` from that release checkout
with an authorized `GH_TOKEN`, `GITHUB_REF_NAME` (`master` or `beta`) and
`GITHUB_SHA`. The script is idempotent for an equal feed version and refuses to
replace a newer Beta feed with an older one. Serialize manual recovery with the
release workflow; do not overwrite an already-published version's installers.
