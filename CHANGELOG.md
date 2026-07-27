# Changelog

All notable changes to Forever are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.43] - 2026-07-27

### Changed

- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.43`.

### Fixed

- Frontend integration tests now have an explicit Windows CI timeout,
  preventing a healthy release from failing when the GitHub runner needs
  slightly more than Vitest's five-second default for a complete app flow.

## [0.0.42] - 2026-07-27

### Added

- **Safe Passage** gives updates with unfinished transfers two protected paths:
  pause and install immediately, or finish current file writers without
  starting another queued file.
- Native close requests from the title bar, Alt+F4, or the Windows taskbar now
  warn while downloads are active and offer **Pause safely & exit** or
  **Keep running**.
- Transfers and the update modal show when an update is scheduled and the
  download queue is draining or secured for restart.

### Changed

- Cooperative download cancellation now flushes and syncs every `.part` file,
  waits for its writer to release the handle, refreshes progress from the real
  on-disk size, and only then allows installation or exit.
- Active transfers return to the local queue for automatic resume on the next
  launch, while deliberately paused or failed transfers retain their state.
- If update installation fails, Forever reopens the scheduler instead of
  leaving the queue paused. A long drain can also be changed to **Pause now**.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.42`.

### Fixed

- Startup recognizes an exact-size final file left by a restart between rename
  and state persistence, preventing a completed download from being requested
  again.

## [0.0.41] - 2026-07-27

### Added

- Windows displays a compact gold update overlay on Forever's taskbar icon as
  soon as an automatic or manual update check finds a new release.
- The overlay is rendered from native RGBA image data, avoiding another bundled
  decoder or external badge asset.

### Changed

- Dismissing the in-app update toast no longer removes the persistent taskbar
  reminder. The badge clears when downloading starts or Forever is current.
- The sidebar update control now announces available, downloading, ready, and
  failed states instead of falling back to **Check for updates**.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.41`.

## [0.0.40] - 2026-07-27

### Changed

- Finish Line now displays when its oldest file verification ran, making it
  clear that structural verification is a point-in-time result.
- A completed album owned by the read-only Music Library Archive is classified
  as **Filed away** when all downloaded audio has left Forever even if verified
  lyrics, artwork, or metadata remain behind.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.40`.

### Fixed

- Opening Transfers rechecks every completed download in one native pass, so
  externally moved or removed files cannot retain a stale **Verified** badge.
- **Reveal** rechecks the selected release before opening its folder, closing a
  second path where old verification state could remain visible.
- Genuine partial audio loss still reports **Needs attention** unless Archive
  ownership and the complete departure of every expected audio file establish
  that the album was deliberately filed away.

## [0.0.39] - 2026-07-27

### Added

- **Signal Relay** adds an in-place rescue drawer for stalled album downloads,
  showing known exact mirrors and freshly discovered Soulseek source folders.
- A configurable **Suggest another source after** setting supports Off, 5, 10,
  20, 30, or 60 minutes, with ten minutes as the default.
- Background relay scans use dedicated search capacity and notify inside the app
  when a compatible route is ready for review.

### Changed

- Transfer cards distinguish local ordering from a source wait and show how long
  a release has been waiting before offering another route.
- Fresh source candidates are ranked by format, track completeness, upload-slot
  readiness, speed, and remote queue length; format changes remain disabled.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.39`.

### Fixed

- Switching to an exact mirror retains safe partial progress, while a compatible
  renamed replacement restarts that unfinished file instead of resuming bytes
  against different remote content. Completed files are never redownloaded.
- The preview runtime now preserves the selected download-lane and Signal Relay
  settings across its periodic transfer refresh.

## [0.0.38] - 2026-07-27

### Added

- Smart Match profiles now include **MP3 only**, which rejects lossless and
  mixed-format folders while retaining the selected MP3 bitrate floor.
- Any per-album Smart Match profile can be saved as the reusable default for
  newly watched albums and Missing Shelf batches.
- The profile editor looks up the earliest official MusicBrainz edition and
  uses its canonical track count as the initial minimum when available.
- **Settings → Download lanes** controls one to six simultaneous source users,
  with three as the persisted default and one active file per user.
- Desktop and minimum-window visual references cover the expanded Smart Match
  editor and the new download-lane setting.

### Changed

- The native scheduler fills independent user lanes without allowing multiple
  simultaneous files from the same Soulseek user. Lowering the limit lets
  existing transfers finish and applies the new cap to subsequent work.
- Transfers distinguish the reorderable **Local queue** from a source's
  already-submitted **Source queue**, including remote position and lane usage.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.38`.

### Fixed

- A cold Windows Actions runner no longer fails the album-discovery integration
  regression at the exact five-second default; only that test receives a
  focused ten-second allowance.

## [0.0.37] - 2026-07-27

### Added

- **Dial Memory** adds a compact radio-preset rail for keeping up to eight
  independent Files and Albums searches open at once, with per-search queries,
  filters, sorting, layout, selection, result data, and scroll position.
- Background presets report live **Listening** state and unseen-result counts;
  searches can be duplicated, stopped together, closed, and reopened from a
  bounded Recently closed menu.
- Pinned presets restore their query and view settings after restart without
  persisting stale Soulseek results. **Ctrl+T**, **Ctrl+W**, **Ctrl+Tab**, and
  **Ctrl+Shift+Tab** provide complete keyboard navigation.
- Desktop, minimum-window, and generated concept references document the Dial
  Memory design, with a frontend regression covering the full background,
  pin, close, reopen, and keyboard workflow.

### Changed

- The Rust search hub now owns isolated runtimes keyed by client session ID,
  routes each Soulseek response to its originating session, and applies the
  existing result ceiling independently to every search.
- Choosing a MusicBrainz album source now opens a separate file-search preset
  rather than replacing the album catalog that launched it.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.37` and describe Dial Memory
  accurately.

### Fixed

- Archive ownership context remains available when discovery opens a separate
  Soulseek source search.
- Compact icon-only preset controls retain accessible names at Forever's
  1024×680 minimum window size.

## [0.0.36] - 2026-07-27

### Added

- **The Listening Post** replaces the Home placeholder with a live command
  center for the active release, next queued albums, Wanted matches, unread
  private messages, room mentions, recent activity, and Archive status.
- Now Receiving presents whole-release progress, transferred and total bytes,
  source listener, speed, ETA, a restrained signal-line motif, and an exact
  transfer action without duplicating the full Transfers workspace.
- Incoming Signals, Recent Activity, and Archive Pulse provide real counts,
  calm empty states, release-health-aware labels, and direct destinations for
  Wanted, conversations, mentioned rooms, Missing Shelf, and album search.
- Desktop and minimum-window visual references plus a frontend regression cover
  Home-first startup and exact signal routing.

### Changed

- Forever now opens on Home after startup; first-run Soulseek onboarding still
  takes priority when an account is not configured.
- Archive and Rooms accept explicit initial destinations so Home can open the
  Wanted or Missing tab and the exact room containing a mention.
- The Listening Post composes existing persisted snapshots and the read-only
  Music Library source without adding an external API or a second data store.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.36` and describe The Listening
  Post accurately.

## [0.0.35] - 2026-07-27

### Changed

- Exact-release focus is initialized when Transfers opens, preserving filter
  clearing, expansion, scrolling, and the brief highlight without synchronously
  rewriting component state from an effect.
- Activity-notice dismissal callbacks are stable across live progress snapshots,
  and transition notices are scheduled after snapshot processing.

### Fixed

- The release quality gate no longer fails its zero-warning React lint policy on
  Signal Breadcrumbs lifecycle handling.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.35` and describe the release
  pipeline hotfix.

## [0.0.34] - 2026-07-27

### Added

- **Signal Breadcrumbs** show live Downloading progress, numbered queue
  position, Paused, Downloaded, and Needs attention states in Album Search,
  Missing Shelf, Wanted, and Browse Shares.
- Lightweight clickable notifications now announce when a release is queued,
  starts downloading, fails, or completes.
- Transfer state actions and release titles in the bottom shelf open Transfers,
  expand the exact release, scroll it into view, and briefly highlight it.

### Changed

- Album and share downloads remain in their discovery workspace after queueing;
  the user chooses when to follow a persistent state breadcrumb into Transfers.
- Live state is derived from the persisted transfer snapshot, so it follows
  queue reordering, progress, pause, completion, failure, removal, and restart.

### Fixed

- Wanted and Browse Shares no longer lose useful transfer feedback after their
  initial handoff, and only the selected listener/folder is marked active.
- Opening a breadcrumb clears transfer filters and search text that could hide
  the requested release.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.34` and describe Signal
  Breadcrumbs.

## [0.0.33] - 2026-07-27

### Added

- **Queue Lights** gives Missing Shelf's recommended and per-source download
  controls distinct Preparing, Downloading, Queued, Paused, Downloaded, and
  Needs attention states driven by the real transfer queue.
- Queued Missing Shelf releases show their exact release queue position, while
  active downloads use an animated spinner and completed downloads use a green
  confirmation icon.

### Changed

- Shelf Radar now reuses the same normalized listener-and-folder transfer-state
  mapping as the main album search rather than ending feedback after preparation.

### Fixed

- Successfully queueing an album from Missing Shelf no longer returns its
  button to the unchanged yellow download glyph with no visible confirmation.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.33` and describe Queue Lights.

## [0.0.32] - 2026-07-27

### Changed

- **Filed Away** adds a calm Moved state for a fully completed release whose
  entire folder has left Forever's download location, keeping normal music
  library organization in safe history instead of Needs attention.
- Moved releases expose **Download again** instead of a non-working Reveal
  action, and their individual file rows clearly read Moved.
- Finish Line's safe-history total includes both locally verified and moved
  releases.

### Fixed

- Moving a downloaded album into an external music library no longer marks
  every original file as an issue or raises a Completed with issues warning.
- Partial file loss, size mismatches, and failed transfers still enter Needs
  attention, preserving warnings for genuinely incomplete or damaged releases.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.32` and describe Filed Away.

## [0.0.31] - 2026-07-27

### Added

- **Open Frequency**, a native Soulseek public-room workspace with a searchable
  room directory, Joined/Stars/All filters, join/leave controls, live chat,
  unread totals, mention highlighting, and room favorites.
- A live listener rail with online/away/offline presence, country flags,
  upload-slot availability, reported speed, shared files, and folder totals.
- Direct room-member actions for Profile, Message, Browse shares, Save user,
  Ignore, and Ban using Forever's existing People and safety stores.
- Native Windows notifications for mentions and new messages in starred rooms,
  controlled by a separate preference in Connection settings.
- Bounded on-device room history for up to 64 rooms and 250 messages per room,
  with persisted favorites and automatic rejoin preferences.
- Soulseek protocol support for public room lists, join/leave, room messages,
  member arrivals/departures, and live member status/stat updates.
- Rust regression coverage for bounded room parsing, protocol frames, room-name
  validation, mention boundaries, and history limits, plus a frontend room-flow
  regression test.

### Changed

- Joined public rooms automatically rejoin whenever Forever reconnects to the
  Soulseek server, while member lists remain session-only.
- Ignored users' new public-room messages are filtered through the same local
  safety preference as their private messages and search activity.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.31` and describe Open
  Frequency accurately.

### Fixed

- The Rooms navigation item now opens a working workspace instead of its early
  placeholder, and exposes its unread total without compressing the label.
- Room, member, and message panes collapse cleanly without horizontal overflow
  at Forever's 1024×680 minimum window size.

## [0.0.30] - 2026-07-27

### Added

- **Finish Line** release health in Transfers, with Recovering, Needs attention,
  and Verified history totals plus per-release expected-file accounting.
- Bounded automatic retries for transient peer connection, request, and stream
  interruptions after 5, 15, and 45 seconds while preserving safe partial data.
- Completed-file verification using expected filename presence and byte size,
  with explicit Verified, Missing, and Size mismatch states.
- Manual **Verify** and **Retry issues** actions, a Needs attention filter, and
  in-app plus Windows completion notifications that open the relevant release.
- Exact alternative-source persistence for grouped Search and Shelf Radar album
  queues, including per-source match counts and an explicit **Try source** action.
- Rust and frontend regression coverage for verification, bounded retries,
  alternative matching, recovery actions, and the Finish Line health model.

### Changed

- Album queue requests retain up to 12 compatible responding folders so a
  release can change listeners without restarting already verified files.
- Completed history remains persisted across restarts; **Clear history** removes
  transfer records only and never deletes files from the download folder.
- Application, updater preview, package, Cargo, Tauri, and MusicBrainz metadata
  now identify version `0.0.30` and describe Finish Line accurately.
- Music Library remains opened strictly read-only and query-only; recovery and
  verification operate only on Forever's download and transfer stores.

### Fixed

- A completed file whose size no longer matches is never automatically retried,
  overwritten, or switched to another source.
- The new Finish Line summary no longer places the transfer filters underneath
  the release list, restoring reliable pointer access at every supported size.
- Transfers remains free of horizontal overflow at both the standard 1280×720
  preview and Forever's 1024×680 minimum window size.

## [0.0.29] - 2026-07-27

### Added

- **Shelf Radar** inside Missing Shelf, with explicit single-album, selected,
  or visible-gap scans capped at 12 albums per batch.
- Live queued, scanning, no-source, source-found, and lossless-found states plus
  a progress strip with current completion and immediate cancellation.
- Expandable album-source drawers showing grouped listener folders, formats,
  track counts, aggregate size, free-slot readiness, speed, queue depth, and
  track previews.
- Direct **Download best**, per-source download, rescan, and **Watch for better**
  actions without leaving Archive.
- An isolated Rust radar state machine and frontend regression coverage for
  token routing, bounded sequencing, cancellation, track preview, download,
  and Wanted handoff.

### Changed

- Radar searches run sequentially with a 12-second response window and a
  one-second courtesy delay instead of launching a library-wide search burst.
- Live search responses are routed independently by token to Search, Wanted,
  and Shelf Radar, so radar activity does not replace the visible Search state.
- Radar results are cached only for the current app session; Music Library
  remains SQLite read-only and query-only, while explicit downloads and watches
  use Forever's existing stores.
- Application, updater preview, package, Cargo, and Tauri metadata now identify
  version `0.0.29` and describe Shelf Radar accurately.

### Fixed

- Non-audio-only response folders are excluded from Shelf Radar album-source
  availability and recommendation counts.
- Shelf Radar rows and source drawers avoid horizontal overflow at both the
  standard 1280×720 preview and Forever's 1024×680 minimum window size.

## [0.0.28] - 2026-07-27

### Added

- **Missing Shelf** inside Archive, with searchable artists from Music Library,
  a selected-artist catalog comparison, and clear **Own**, **Wanted**, and
  **Missing** states for official MusicBrainz release groups.
- Studio-album completion totals plus Owned, Wanted, and Missing counters,
  release-type filters for Studio, Live, Compilation, and EP catalogs, and a
  generated decade filter.
- Multi-select for visible collection gaps and an atomic bulk handoff of up to
  100 albums to Wanted using one shared Smart Match format, bitrate, and track
  count profile.
- Session-only MusicBrainz identity selection for local artist names that have
  not yet been linked by Music Library.
- Rust and frontend regression coverage for read-only artist discovery, cached
  catalog parsing, ownership comparison, filters, batch Wanted handoff, and
  duplicate-watch prevention.

### Changed

- Missing Shelf reads verified artist links and cached official release groups
  directly from Music Library before considering a live MusicBrainz lookup.
- Catalog work is strictly selective: Forever lists a bounded 120 artists and
  compares only the shelf the user opens instead of scanning every artist in
  the collection automatically.
- Completed artist comparisons are cached for the current app session and
  cleared explicitly by **Refresh Archive**.
- Bulk additions validate and deduplicate every release before persisting the
  Forever-owned `wanted.json` store once; the external Archive database remains
  opened with SQLite read-only and query-only enforcement.
- Application and updater preview metadata now identify version `0.0.28` and
  describe the Music Library → Missing → Wanted workflow.

### Fixed

- The bulk Smart Match bar remains visible while scrolling a long discography,
  including at Forever's 1024×680 minimum window size.
- Missing Shelf adapts its artist rail, completion summary, catalog metadata,
  and batch controls without horizontal overflow at compact desktop widths.

## [0.0.27] - 2026-07-27

### Changed

- Renamed the GitHub repository from `soundtrackgeek/soulseek_forever` to the
  app-aligned canonical name `soundtrackgeek/forever`.
- Updated local Git, npm, Cargo, MusicBrainz User-Agent, README, and release
  metadata to use `https://github.com/soundtrackgeek/forever`.
- Application and updater preview metadata now identify version `0.0.27` and
  explain the repository migration.

### Fixed

- Tauri now requests signed updates from the canonical
  `soundtrackgeek/forever` `latest.json` feed instead of relying on GitHub's
  redirect from the former repository name.
- Release validation now fails when npm, Cargo, or Tauri updater metadata drifts
  from the canonical repository URL, preventing future broken update feeds.

## [0.0.26] - 2026-07-26

### Added

- Per-album **Smart Match profiles** for Wanted Signals, with Prefer lossless,
  Lossless only, and Any format modes plus optional minimum bitrate and track
  count requirements.
- Deterministic recommendation scoring across qualifying folders using album
  completeness, audio format, free upload slots, source speed, and queue length.
- A best-source review that verifies the remote folder before queueing and
  reports its listener, path, format, track count, size, speed, audio files, and
  companion files.
- One-click complete-album queueing from the review while preserving cover art,
  cue sheets, lyrics, logs, and other files beside the audio.
- A **Fulfilled** Wanted state synchronized in one read-only Archive batch when
  Music Library reports that an album is owned.
- Frontend and Rust regression coverage for source ranking, preference filters,
  review/queue flow, companion files, ownership reconciliation, and legacy
  Wanted-store migration.

### Changed

- Wanted availability alerts now open the recommended source review, while
  **Compare** opens all grouped sources with the Smart Match highlighted.
- New-source detection now considers only folders that satisfy the album's
  current Smart Match profile; changing a profile clears the old recommendation
  and schedules a fresh check.
- Fulfilled, paused, and offline watches are excluded from background checks,
  and no Smart Match is ever downloaded without explicit confirmation.
- Archive's Wanted summary and filters now separate ready matches, quiet watches,
  and albums fulfilled by the external Music Library source.
- Application, MusicBrainz User-Agent, and updater preview metadata now identify
  version `0.0.26` and describe Smart Matches.

### Fixed

- Smart Match review now derives its inspected folder total from the selected
  source, so the displayed verification size agrees with the recommendation.
- The five-part Wanted summary and review dialog remain readable without
  horizontal overflow at Forever's 1024×680 minimum window size.

## [0.0.25] - 2026-07-26

### Added

- **Wanted Signals**, a persistent watchlist inside Archive for MusicBrainz
  albums that are still missing from the read-only Music Library source.
- Automatic serialized Soulseek checks every 15 minutes, 30 minutes, or hour,
  plus a manual-only rhythm and per-album Check, Pause, Resume, and Remove
  controls that stop cleanly while offline.
- Availability summaries grouped by listener and remote folder, including
  available and ready source counts, fullest returned folder count, best audio
  format, album size, and fastest reported source.
- Stable source-fingerprint comparison, clickable in-app alerts, and Windows
  notifications when new sources appear, with direct handoff to a fresh grouped
  album-source search.
- **Watch** actions on missing MusicBrainz releases and active album-source
  reports, persisted separately in Forever's own `wanted.json`.
- Rust and frontend regression coverage for watchlist persistence, source
  grouping, supported check rhythms, notification flow, and source comparison.

### Changed

- Archive now has separate **Library source** and **Wanted** views while the
  external `music-library.sqlite3` database remains strictly read-only and
  query-only.
- Wanted checks use isolated search tokens and never replace or mix with the
  visible Search workspace; selecting **Compare sources** remains explicit and
  no wanted album is downloaded automatically.
- Application, MusicBrainz User-Agent, and updater preview metadata now identify
  version `0.0.25` and describe Wanted Signals.

### Fixed

- Album-source reports outside the currently open MusicBrainz catalog now say
  **Archive not checked** instead of incorrectly reporting that the connected
  Archive is unavailable.

## [0.0.24] - 2026-07-26

### Changed

- The Signal Order handle now follows an explicit Windows mouse
  press/move/release gesture, shows the source card as lifted, and marks the
  exact before/after destination while moving.
- A focused drag handle also accepts Arrow up, Arrow down, and Home for direct
  keyboard reordering alongside the existing ordering buttons.

### Fixed

- Queue drag-and-drop now works in Tauri's Windows WebView instead of depending
  on HTML5 drag events that WebView2 did not consistently deliver from buttons.
- The transfer interaction regression test now exercises the same mouse-event
  path used by the desktop app.

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
