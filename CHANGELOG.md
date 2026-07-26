# Changelog

All notable changes to Forever are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.12] - 2026-07-26

### Added

- Full Soulseek distributed-search leaf participation with server-provided
  parent discovery, bounded `D` peer framing, branch-level/root updates,
  embedded branch-root searches, parent-loss recovery, and reset handling.
- Live global-search relay state and received, matched, answered, and ignored
  request counters, surfaced in Connection settings and safe diagnostics.
- Protocol, topology, coordinator, TCP framing, query-matching, deduplication,
  and request-rate regression coverage for the new search path.

### Changed

- Shared-file search now uses a normalized word index with required,
  `-excluded`, and `*partial` terms instead of scanning every filename for each
  incoming request.
- Pending search responses, parent candidates, distributed frames, duplicate
  tokens, and request rates are bounded to keep unsolicited network traffic
  inexpensive.
- Application and updater preview metadata now identify version `0.0.12`.

### Fixed

- Locally shared files are now discoverable through ordinary global searches
  from other Soulseek clients, rather than only through direct user browsing
  and targeted search delivery.

### Security

- Distributed-search diagnostics omit usernames, queries, IP addresses, and
  local paths while malformed, duplicate, stale, and excessive traffic is
  rejected before it can grow unbounded state.

## [0.0.11] - 2026-07-26

### Added

- Persistent local share configuration with native folder selection, enable/
  disable and removal controls, manual rescanning, virtual share aliases, and
  live file, folder, and byte totals.
- A bounded Rust music index that rejects overlapping roots and excludes
  hidden entries, symbolic links, temporary/partial files, zero-byte files,
  unsupported formats, excessive depth, and oversized indexes.
- Real Soulseek Shared File List, Folder Contents, and distributed search
  responses for locally shared music over direct and indirect peer links.
- A conservative outgoing upload queue with one configurable active slot by
  default (up to three), queue positions, transfer negotiation, resumable byte
  offsets, speed, ETA, progress, cancellation, failure handling, and automatic
  scheduling of the next file.
- A Midnight Radio sharing panel in Settings and a dedicated Uploads section
  in Transfers with live outgoing activity and finished-history cleanup.
- Protocol round-trip, index safety, queue-position, and frontend regression
  coverage for local sharing and uploads.

### Changed

- Forever now announces its real public share counts when connecting and after
  a share configuration or rescan change.
- Share indexing starts off the UI thread so a large music collection does not
  delay application startup.
- Application and updater preview metadata now identify version `0.0.11`.

### Security

- Absolute local paths are kept inside the Rust index and are never serialized
  to peers or the upload interface; Soulseek users only receive virtual aliases
  and relative remote filenames.

## [0.0.10] - 2026-07-25

### Added

- Folder-name results in user share searches, with a dedicated matching-folder
  panel that opens the chosen remote directory directly.
- Expandable and collapsible hierarchy for public and private shared folders,
  including synthesized parent branches, aggregate file counts, active-folder
  expansion, and matching ancestor context during search.
- Changelog-backed GitHub release notes so the in-app updater can show the
  actual additions, changes, and fixes from each release.
- Frontend and Rust regression coverage for shared-folder search, tree
  interaction, and updater release-note content.

### Changed

- The update modal presents release markdown as structured, scrollable
  headings and bullet lists instead of unformatted text.
- Application and updater preview metadata now identify version `0.0.10`.

### Fixed

- Search-result folder, add, and download actions retain equal circular
  dimensions instead of being compressed into narrow ovals.

## [0.0.9] - 2026-07-25

### Added

- Live complete-share browsing using Soulseek Shared File List requests and
  zlib-compressed public/private directory responses over direct or indirect
  peer connections.
- A bounded, session-only share cache with folder summaries, exact file
  metadata, local path/filename search, format filtering, and explicit refresh.
- A Midnight Radio User Shares Explorer with a folder rail, sortable file
  table, source summary, persistent multi-folder selection, selected-byte
  totals, private-share handling, and grouped-release download handoff.
- Browse-shares entry points on every search result, in the selected source
  profile, and on transfer source names, plus responsive captures at the native
  and minimum window sizes.
- Rust coverage for request framing, compressed public/private list parsing,
  share caching, folder lookup, and local search, alongside a complete frontend
  browse/select/download regression flow.

### Changed

- Peer messages use a separate bounded frame reader sized for legitimate large
  compressed share lists while server frames retain their stricter limit.
- Application and updater preview metadata now identify version `0.0.9`.

## [0.0.8] - 2026-07-25

### Fixed

- Live folder browsing now sends the exact remote directory from a search
  result instead of the slash-separated display label, preventing valid peers
  from timing out on a path that did not exist in their shares.
- Search-response peer sockets close after their response is recorded so a
  folder request can establish the single active peer connection Soulseek
  permits for that user.
- Folder peer connections now surface premature socket closure or peer idle
  timeout immediately instead of silently waiting for the outer request timer.

### Changed

- Application and updater preview metadata now identify version `0.0.8`.

## [0.0.7] - 2026-07-25

### Added

- Live Soulseek source-folder inspection using the standard Folder Contents
  request and compressed response flow over direct and indirect peer links.
- A Midnight Radio release selector with complete folder contents, per-file
  choices, Select all/Deselect all, file counts, formats, quality, and total
  selected size.
- Atomic whole-release enqueue into safe collision-free release folders while
  preserving source order and the existing one-active-file transfer policy.
- Persisted release IDs, titles, folders, and file order, including automatic
  queue recovery and partial-file resume after restarting Forever.
- Release-level pause, resume, retry, cancel, reveal, and completed-history
  cleanup commands alongside the existing per-file controls.
- A complete Transfers workspace with release cards, aggregate and per-file
  progress, expandable file tables, transfer search, All/Active/Queued/
  Completed/Failed filters, and Clear completed.
- Native desktop notifications when a file or complete release finishes, plus
  frontend and Rust coverage for folder parsing, safe grouping, selection,
  filtering, and release controls.

### Changed

- The compact transfer shelf now groups related files into releases and shows
  aggregate bytes, progress, speed, status, and release-level actions.
- The selected-result inspector now offers source-folder browsing and keeps
  exact single-file download as a secondary action for live results.
- Application and updater preview metadata now identify version `0.0.7`.

### Fixed

- Compact sidebar navigation retains accessible names when labels collapse at
  the minimum supported window width.
- Folder responses are accepted only when the source username, request token,
  and requested path all match the outstanding inspection.

## [0.0.6] - 2026-07-25

### Added

- Real single-file Soulseek downloads from live search results using the modern
  peer queue, upload request, and file-connection protocol flow.
- A persistent one-at-a-time transfer queue with live source-queue position,
  byte progress, speed, ETA, completion, and actionable failure states.
- Pause, resume, retry, cancel, and Show in folder controls backed by native
  transfer state rather than staged frontend data.
- Safe `.part` files, exact-size validation, resumable byte offsets, sanitized
  local filenames, collision-free destinations, and final-file promotion only
  after every expected byte has been written and flushed.
- Direct and indirect peer connection handling for download negotiation and file
  streams, including local timeouts and source rejection/failure reporting.
- Rust regression coverage for download protocol frames, address and request
  parsing, safe paths, collision handling, and persisted resume progress, plus
  frontend coverage for queue and pause/resume controls.

### Changed

- The Midnight Radio transfer shelf now renders persisted native download state
  and clearly distinguishes contacting, remote queue, connecting, downloading,
  paused, completed, and failed phases.
- Interrupted active transfers return to the queue and resume from their saved
  partial-file offset after the Soulseek session reconnects.
- Application and updater preview metadata now identify version `0.0.6`.

## [0.0.5] - 2026-07-25

### Fixed

- Server frame reads now run in a dedicated task so the search timer, peer
  listener, and command branches cannot cancel a partially read message and
  trigger a reconnect loop with an invalid message-length error.
- Added regression coverage that delivers consecutive Soulseek frames one byte
  at a time while competing timer events fire.

### Changed

- Application and updater preview metadata now identify version `0.0.5`.

## [0.0.4] - 2026-07-25

### Added

- Live Soulseek network search using server search requests and compressed peer
  search responses.
- Temporary peer listener plus indirect connection fallback for users behind
  NAT or firewalls.
- Streamed, deduplicated search results with real filenames, file sizes, audio
  attributes, slot availability, queue length, source speed, and share
  visibility.
- Working audio-type filters, ready/speed/size sorting, an early stop control,
  live status counts, and a native file inspector.
- Protocol safety limits for queries, frames, decompression, file attributes,
  response entries, concurrent peers, and displayed results.
- Rust coverage for search frames, peer initialization, connection requests,
  compressed result parsing, stale tokens, deduplication, and search resets.
- Frontend coverage for streamed empty states and real type filtering.

### Changed

- Search results now represent live Soulseek files in the desktop app; the
  browser-only frontend continues to use staged data for visual development.
- Result actions clearly identify downloads as a `0.0.5` feature instead of
  adding a simulated transfer for live network files.
- Application and updater preview metadata now identify version `0.0.4`.

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
