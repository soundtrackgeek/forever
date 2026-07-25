# Changelog

All notable changes to Forever are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-07-25

### Added

- Persistent automatic update-check intervals with a five-minute default and
  options for one, fifteen, thirty, or sixty minutes, or startup only.
- Explanatory account-registration guidance in First Connection and Connection
  settings.
- Frontend coverage for the default recurring update schedule, preference
  persistence, and Soulseek account guidance.

### Changed

- First Connection now states that a valid unused Soulseek username is
  automatically registered with the password entered.
- Application and updater preview metadata now identify version `0.0.3`.

### Fixed

- Concurrent automatic, startup, and manual update checks are coalesced so
  multiple updater requests cannot overlap.
- Successful registration of a previously unused username is no longer
  presented as if Forever skipped credential validation.

## [0.0.2] - 2026-07-25

### Added

- Live Soulseek server login using the documented protocol handshake, status
  announcement, shared-count announcement, and connection keepalive.
- First Connection onboarding with account fields, native download-folder
  selection, secure-storage preferences, auto-connect, and advanced server
  settings.
- Midnight Radio connection settings view with connect/disconnect controls,
  live state, recent sanitized diagnostics, updater access, and account removal.
- Windows Credential Manager integration for remembered passwords and
  memory-only session credentials when password storage is disabled.
- Non-secret JSON connection preferences, a bounded diagnostic log, Tauri
  commands and events, automatic reconnect with capped exponential backoff, and
  protocol/settings/service tests.
- Browser preview mode for the onboarding flow at `?onboarding=1`.

### Changed

- Sidebar profile and network-toolbar status now reflect the real connection
  service.
- Search controls are unavailable while the Soulseek network is offline.
- Application and updater preview metadata now identify version `0.0.2`.

### Fixed

- Soulseek passwords are excluded from Forever’s settings JSON, diagnostic
  messages, and frontend state returned by native commands.

## [0.0.1] - 2026-07-25

### Added

- Tauri 2, Rust, React, TypeScript, and Vite application foundation.
- Faithful Midnight Radio app shell with interactive search, results, release
  inspector, navigation states, and transfer controls.
- Original Night Geometry artwork, listener avatar, and branded application
  icon assets.
- Signed Tauri updater integration with startup checks, manual checks, update
  toast, release modal, download progress, installation, and restart handling.
- Automated frontend and Rust CI quality gates.
- Automatic Windows GitHub Release workflow producing NSIS and MSI installers,
  updater metadata and signatures, and SHA-256 checksums after each version
  bump.
- Unit tests for the primary shell navigation and search states.
