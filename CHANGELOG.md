# Changelog

All notable changes to Forever are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.23] - 2026-07-26

### Added

- A persistent **Signal Order** in Transfers with drag handles, accessible Move
  up/Move down controls, and a one-click **Download next** action for queued
  releases.
- A queue-wide overview showing unfinished releases, remaining files and bytes,
  plus a total ETA calculated from the current active download rate.
- Native and frontend regression coverage for release-block reordering, queue
  numbering, summary calculations, and exact-source duplicate detection.

### Changed

- Queued releases now follow their stored `transfers.json` order across app
  restarts, while keeping every album's files together and internally ordered.
- Album-source actions in Search show live **Queued #1**, **Queued #2**, and
  onward, updating immediately after reorder, cancel, pause, completion, or
  failure changes.
- The compact transfer drawer mirrors numbered queue positions, and empty queue
  language now makes the completed/clear state explicit.
- Application, MusicBrainz User-Agent, and updater preview metadata now
  identify version `0.0.23` and describe Signal Order.

### Fixed

- Forever now rejects an exact duplicate listener-and-folder release while an
  earlier download from that source is unfinished, without preventing another
  source, edition, or a later deliberate re-download after completion.

## [0.0.22] - 2026-07-26

### Added

- Live album-source action states that follow the real release queue: the
  active album is green and reads **Downloading**, while later selections are
  blue and read **Queued**.
- A whole-album ETA in the full Transfers workspace and compact transfer
  drawer, calculated from every remaining byte at the current release speed.
- Regression coverage for in-place multi-album queueing, metadata-rich release
  names, and release-wide ETA presentation.

### Changed

- **Download album** now keeps the album-source results open so several albums
  can be queued without repeatedly navigating back from Transfers.
- MusicBrainz-guided downloads now use `Artist - Album (Year)` for their local
  release folder and transfer title when a release year is available, falling
  back gracefully when catalog metadata is incomplete.
- Application, MusicBrainz User-Agent, and updater preview metadata now
  identify version `0.0.22` and describe the in-place album queue release.

### Fixed

- The ETA shown at release level no longer reflects only the currently active
  track; it now includes queued files in the same album.
- Album action buttons remain synchronized with queue, pause, failure, and
  completion changes instead of reverting after their initial enqueue.

## [0.0.21] - 2026-07-26

### Added

- A dedicated **Archive** workspace backed by Music Library's existing
  `music-library.sqlite3` database, with its source path, latest completed
  import, album total, track total, and refresh control.
- **Owned** and **Don't own** markers on MusicBrainz discography cards and the
  Soulseek album-source report, including local year and track-count detail for
  owned matches.
- A batched per-artist ownership matcher against Music Library's normalized
  `albums` table, with punctuation-tolerant title comparison and closest-year
  selection when duplicate local album titles exist.
- Rust regression coverage proving the Archive connection rejects writes,
  preserves source rows, reads import metadata without a full table count, and
  distinguishes owned from missing releases.

### Changed

- The former **Library** navigation destination is now **Archive**, reflecting
  that it inventories an existing external collection rather than adopting
  Forever downloads.
- The Music Library database is opened only with SQLite's read-only flag and
  query-only mode; Forever exposes no command that mutates it and keeps all
  Soulseek downloads in the independently configured download folder.
- Application, MusicBrainz User-Agent, and updater preview metadata now
  identify version `0.0.21` and describe the Archive release.

## [0.0.20] - 2026-07-26

### Added

- An album-source results view for MusicBrainz-guided Soulseek searches that
  groups matching files by listener and remote folder.
- Source rows with folder name, audio-track count, available formats, estimated
  album size, queue readiness, transfer speed, and a one-click **Download
  album** action.
- An eye control on every album source that previews the returned track list on
  hover or keyboard focus without leaving Search.
- Frontend regression coverage for album grouping, companion-file handling,
  natural track ordering, track previews, and whole-album enqueue.

### Changed

- Choosing **Search Soulseek** from a MusicBrainz release now opens album
  sources by default, with a switch back to the original individual-file view.
- Whole-album downloads inspect the selected listener's exact folder first, so
  artwork, lyrics, cue sheets, and other companion files join the audio in one
  release transfer.
- Application and updater preview metadata now identify version `0.0.20` and
  describe album-source search and download.

## [0.0.19] - 2026-07-26

### Added

- Explicit, accessible Expand and Collapse controls for the bottom transfer
  queue, including active and release counts in its compact state.

### Changed

- The bottom transfer queue now starts as a 44-pixel status handle and expands
  only when requested, returning to its compact state when the dedicated
  Transfers workspace opens.
- Sidebar navigation rows, gaps, and supporting spacing are more compact so the
  account identity remains visible at the bottom of the window.
- Application and updater preview metadata now identify version `0.0.19` and
  describe the compact transfer-drawer release.

### Fixed

- The signed-in username and online status are no longer clipped behind the
  transfer area at common desktop window heights.

## [0.0.18] - 2026-07-26

### Added

- Regression assertions for MusicBrainz release-group count and offset metadata
  alongside the existing album-field coverage.

### Changed

- The MusicBrainz release-group fixture now mirrors the field names returned by
  the production API instead of using simplified local-only names.
- Application and updater preview metadata now identify version `0.0.18` and
  describe the album-catalog compatibility fix.

### Fixed

- Album catalogs now decode MusicBrainz's `release-group-count` and
  `release-group-offset` response fields, so valid searches such as Def Leppard
  no longer fail after artist matching.

## [0.0.17] - 2026-07-26

### Added

- A Rust regression test that constructs the real MusicBrainz HTTPS client and
  verifies that a TLS crypto provider is available.
- A Windows release smoke test that launches the packaged executable and fails
  publication if Forever exits during its startup window.

### Changed

- MusicBrainz HTTP-client construction now retains an initialization error for
  the Albums workspace instead of preventing the rest of Forever from opening.
- Application and updater preview metadata now identify hotfix version
  `0.0.17` and explain the manual repair path from `0.0.16`.

### Fixed

- Fixed the immediate startup exit in `0.0.16` by installing the Rustls `ring`
  crypto provider before Reqwest constructs the MusicBrainz HTTPS client.

### Security

- Forever now selects its Rustls crypto provider explicitly instead of relying
  on transitive dependency initialization order.

## [0.0.16] - 2026-07-26

### Added

- A Files/Albums search switch with MusicBrainz artist matching and
  disambiguation, studio/live/compilation/EP catalog filters, Cover Art Archive
  artwork, and one-click handoff from a selected album to live Soulseek search.
- A dedicated top-level Browse workspace with exact-username entry, recent and
  favorite listener shortcuts, and a clear return path for browsing another
  listener.
- Complete-release sharing for artwork, lyrics, cue sheets, logs, booklets,
  checksums, playlists, archives, extensionless files, and other regular files
  beside audio, with corresponding file icons and share-browser format filters.
- Rust and frontend regression coverage for MusicBrainz response parsing and ID
  validation, complete-folder indexing, dedicated Browse navigation, and the
  album-to-Soulseek handoff.

### Changed

- Browse actions in Search, People, and Transfers now open the dedicated Browse
  workspace instead of leaving Search highlighted around an unrelated view.
- Sharing settings now describe complete releases and public counts include
  every safe, non-empty file beneath enabled roots.
- Application and updater preview metadata now identify version `0.0.16` and
  show this release's actual additions in the in-app What's New view.

### Fixed

- User-share browsing now has its own persistent navigation state and a polished
  listener-picker empty state instead of masquerading as a Search subview.
- Non-audio companion files no longer disappear from local share lists, folder
  responses, global search responses, selections, or downloads.

### Security

- MusicBrainz queries are length/control-character checked, artist IDs are
  validated as UUID-shaped identifiers, requests have a 15-second timeout and
  one-per-second gate, and bounded in-memory caches evict their oldest entries.
- Complete-folder indexing retains existing hidden/system, symlink, zero-byte,
  partial/temporary-file, depth, count, and overlapping-root protections.

## [0.0.15] - 2026-07-26

### Added

- A dedicated two-pane Midnight Inbox with recent conversations, unread and
  presence indicators, conversation and message-history search, and exact-
  username conversation starts.
- Persistent per-conversation drafts and configurable native Windows
  notifications for incoming private messages.
- Queued, sent, and failed outgoing-message states with one-click retry, plus
  mark read/unread, clear-history, and remove-conversation actions.
- Responsive empty, loading, error, and jump-to-latest states with thread-tail
  following that does not interrupt someone reading older messages.

### Changed

- Message actions in People now route to the full Messages workspace, where
  ignore and ban controls remain available beside the active conversation.
- Outgoing messages are persisted before network transmission and updated as
  delivery succeeds or fails, including during connection interruption.
- Application and updater preview metadata now identify version `0.0.15`.

### Fixed

- Interrupted outgoing messages no longer remain permanently queued or vanish;
  they become failed messages that can be retried.
- Incoming message events, send acknowledgements, and command responses no
  longer race and replace newer thread state with an older queued snapshot.

### Security

- Drafts, notification previews, delivery errors, message bodies, usernames,
  conversations, and stored history are bounded before display or persistence.
- Destructive clear-history and remove-conversation actions require explicit
  confirmation and affect only the selected conversation.

## [0.0.14] - 2026-07-26

### Added

- Native Soulseek private messaging with outgoing delivery, incoming-message
  acknowledgement, persistent per-user history, unread counts, and direct
  navigation from the sidebar and People workspace.
- Separate persistent Ignore User and Ban User controls. Ignoring filters a
  listener's private messages and search activity locally; banning prevents
  that listener from browsing, queuing, or downloading local shares.
- Total upload slots, current slot availability, and queued-upload counts in
  the listener profile statistics.
- Bounded protocol, persistence-migration, and frontend regression coverage
  for private messages, ignore state, upload statistics, and the composer.

### Changed

- The People conversation shell is now a working message thread with online
  send state, local history, timestamps, empty state, and unread indicators.
- Favorites, ignored listeners, banned listeners, recent people, and private
  conversations are restored after restarting Forever.
- Application and updater preview metadata now identify version `0.0.14`.

### Fixed

- Bundled country flags and validated profile-picture data URLs now pass the
  packaged application's content-security policy.
- Failed profile images fall back to initials without rendering their alt text
  over usernames or overflowing compact and full-size avatars.

### Security

- Private-message usernames, bodies, stored conversations, and per-thread
  history are bounded before protocol encoding or local persistence.
- Ignored messages are acknowledged without being retained, while banned
  listeners receive no share metadata and cannot enqueue uploads.

## [0.0.13] - 2026-07-26

### Added

- A dedicated Midnight Radio People workspace with exact-username lookup,
  live online/away/offline presence, country identity, profile descriptions
  and raster images, interests, supporter state, share statistics, upload
  availability, loading/error/empty states, and responsive desktop layouts.
- Persistent favorites, blocked listeners, and bounded recent-source history,
  with favorites automatically watched again after reconnecting.
- Bundled SVG country flags and profile entry points across search results,
  the source inspector, User Shares, downloads, uploads, and the transfer shelf.
- An initial private-conversation shell that keeps future messaging anchored to
  the selected listener without implying that message delivery is available.
- Protocol and frontend regression coverage for presence, country parsing,
  profile round trips, content bounds, favorites, flags, and conversation flow.

### Changed

- Transfer source names now open People profiles; complete share browsing is
  available from each profile and remains directly available from Search.
- Profile images and live profile fields are session-only, while intentional
  local relationships persist in a separate `people.json` store.
- Country SVGs load on demand and framework, icon, and Tauri dependencies are
  split from the main interface bundle to keep startup work bounded.
- Application and updater preview metadata now identify version `0.0.13`.

### Fixed

- First-run onboarding now remains visible throughout authentication and only
  closes after the connection reaches its confirmed online state.

### Security

- Profile frames, descriptions, pictures, interest counts, interest lengths,
  usernames, concurrent requests, saved relationships, recent history, and
  runtime profile state are bounded before allocation or persistence.
- Only validated PNG, JPEG, and WebP profile pictures become local data URLs;
  SVG and unknown formats are ignored.

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
