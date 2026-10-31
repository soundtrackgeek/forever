# Changelog

## [0.0.95] - 2026-10-31

### Fixed

- **Download album works for Discogs-only Discovery albums.** Their album id
  (for example `discogs:123456`) was sent to the transfer queue as a
  MusicBrainz release group id, so every album download from that source page
  was rejected with the misleading "Choose at least one valid file before
  downloading the release." These albums now download with the folder's own
  track count, matching what browsing the same listener folder already did.

## [0.0.94] - 2026-10-30

Also includes the changes from 0.0.92 and 0.0.93, which were never released.

### Added

- **Files search now shows albums by default.** A new "Albums only" option in
  Advanced filters, on by default, shows album folders instead of single files;
  switch it off to see single songs. Replies are grouped by
  each person's folder (CD1/CD2 subfolders count as one album), and you can set
  a minimum number of tracks per album (default 2). This finds albums that
  Albums search does not show, such as soundtracks like Explosions in the Sky's
  Friday Night Lights, and "Download album" fetches the whole folder. The
  setting is saved with the search tab and pinned presets.

### Changed

- **Smarter artist search in the Discovery shelf.** Searching your Archive now
  ignores accents, punctuation and skipped words, and matches word beginnings
  in any order. "was not" finds Was (Not Was); "Blue Oyster" and "Blue Cult"
  both find Blue Öyster Cult. Names that start with what you typed are listed
  first.

### Fixed

- **Discovery shelf no longer suggests artists you already own under another
  spelling.** Owned artists are now matched ignoring "The" and treating "&",
  "+" and "and" alike, so The Carpenters, The Go-Go's and Mike + The Mechanics
  are recognised as the Carpenters, Go-Go's and Mike & The Mechanics you have.
  Duos are matched by surname too: Hall & Oates is recognised as Daryl Hall &
  John Oates. A solo member such as John Oates is still suggested.
- **Releases publish again.** A Rust formatting mismatch had stopped the
  release build since 0.0.92, so 0.0.92 and 0.0.93 never reached the updater.

## [0.0.91] - 2026-10-27

### Fixed

- **Connects to the Soulseek server on startup again.** Automatic connection used to
  be started by the window, which may never load when Forever launches hidden in
  the tray after a reboot, so you had to press Connect by hand. Forever now
  connects from the app itself as soon as it starts, whenever Connect
  automatically is on and a password is saved.

## [0.0.90] - 2026-10-26

### Added

- **Smart downloads** for Wanted albums (Settings → Smart downloads, off by
  default). Click Wanted and forget it: Forever takes the ranked sources from the
  latest Wanted check, opens each peer's folder, checks the audio count and the
  titles and lengths against the official MusicBrainz edition, queues the first
  folder that passes, and lets the usual verification and Soundcheck confirm it.
  Each album has an **Auto** button to opt out, and a status line on the Wanted
  list says which source is downloading and how many have been tried.
- **Automatic source switching.** When a source sends no data for the chosen time
  (20 minutes by default, counted only while the source is the one holding things
  up), the release is replaced by the next source that has already passed the
  checks. A release that fails outright or delivers files that fail verification
  or Soundcheck is cancelled and the next source is tried. If nothing better is
  known, the download keeps waiting and one fresh search is requested.
- **Retries and rest.** Each album tries up to five sources (configurable), then
  rests for six hours and starts over with a clean slate. Sources that were only
  offline are tried again after three hours. Progress is saved with the Wanted
  list, so a restart carries on where it stopped. Removing an automatic download
  from Transfers turns **Auto** off for that album; downloads you queue yourself
  are never touched.
- **Preferred format in settings.** The default Wanted profile (prefer FLAC,
  lossless only, MP3 only, or any, plus a lossy fallback bitrate) is now editable
  in Settings, with **Apply to the albums still wanted** to copy it onto albums
  already on the list.
- **Track length tolerance.** How far a track may differ from the MusicBrainz
  length (0–30 seconds, 3 by default) and how many tracks may differ by more
  (0–10, none by default). It applies to Smart Matches, the review dialog and
  automatic downloads alike, and changing it schedules a fresh check of every
  open Wanted album.
- **Verified-album notification.** A Windows notification appears bottom right
  when an album finishes downloading and passes verification while Forever is
  hidden in the tray, minimized, or behind another window. It stays quiet while
  you are looking at Forever and can be switched off in Settings.

### Changed

- Wanted checks now keep up to six ranked, acceptable sources per album instead
  of only the best one, so a fallback is available immediately.
- Albums that download themselves no longer raise the "has a Smart Match" alert,
  since there is nothing to review.

## [0.0.89] - 2026-10-26

### Fixed

- Release publishing failed with `ENOBUFS` once the repository's release list grew
  past Node's default 1 MB output buffer; the update-feed script now allows far
  larger `gh` output.

## [0.0.88] - 2026-10-26

### Added

- **Top sources** on the Listening Post Insights are now clickable: the username
  opens that person's profile, and a **Browse shares** button opens their shares.
- **Top sources** also show the average download speed you get from each source.
  Speeds are counted from this version on; sources seen before show none until
  their next finished download.

## [0.0.87] - 2026-10-26

### Added

- **Sort by** menu on the Discovery shelf's studio albums: **Oldest first**
  (the new default, so an artist's discography reads from debut to latest),
  **Newest first**, **Alphabetical**, and **Most listened** (the previous
  ListenBrainz ranking, shown only when ListenBrainz data is available).
  Albums without a release date always sort to the bottom of the date orders.

### Fixed

- Release build failed the lint step over an unnecessary export in the Discovery
  shelf component.

## [0.0.86] - 2026-10-26

### Fixed

- **Now receiving** and the Transfers list showed a stock placeholder cover for
  every download. They now show the real album cover from the Cover Art
  Archive: straight from the album when the transfer began as an album search,
  otherwise by matching the "Artist - Album (Year)" folder name against
  MusicBrainz (confident matches only, remembered for a week). When no cover
  exists the neutral placeholder tile is shown.

## [0.0.85] - 2026-10-26

### Added

- **ListenBrainz token** under Discovery shelf **Sources**. ListenBrainz now
  refuses uncached requests for album listening counts without a free user token
  (from listenbrainz.org/settings), so lesser-known artists always failed with
  HTTP 401. A saved token is kept in the system credential store and sent only
  to ListenBrainz on its album and similar-artist lookups. It is optional;
  without one the shelf still works and falls back to release-date order.

### Changed

- A ListenBrainz HTTP 401 now says a token is needed (or that the saved token
  was rejected) and points at Sources, instead of "Try again later."

## [0.0.84] - 2026-10-26

### Added

- **Insights** on the Listening Post: received and shared totals, share ratio,
  download success, Wanted hit rate and average time-to-find, Soundcheck pass
  rate, direct-connection share, a 30-day traffic chart, a running total of
  Wanted albums found, and your top sources with how reliable each has been.
- Forever now keeps compact daily totals in a local `stats.sqlite3` file (400
  days, 500 sources). Counting begins with this version, nothing is back-filled,
  and the numbers never leave your computer.

## [0.0.83] - 2026-10-25

### Fixed

- The Discovery shelf no longer clears itself while you browse it. Archive
  matching (a finished download, Add to Wanted, or the five-minute re-match)
  refreshes the Music Library file's modified time, and the shelf treated that
  as a different Archive and discarded its artists and album picks. The shelf is
  now keyed on the database path and connection only; **Discover** and
  **Refresh shelf** still re-read ownership.

## [0.0.82] - 2026-10-25

### Fixed

- Settings could show "Scanning…" with 0 files forever. Since 0.0.79 the first
  share scan ran before the Archive settings were registered, panicked looking up
  the Music Library path, and left the scan stuck. The path now comes from the
  unified settings, so it no longer depends on startup order.

### Changed

- Shared folders that Music Library covers are now indexed straight from its
  database (read-only) with no folder walk, no per-file checks and no partial
  rescans. The database is the source of truth, including bitrate and duration.
  Only audio files are listed for those folders, so covers, cue sheets and logs
  are no longer shared, and sample rate and bit depth are not advertised.
  Folders Music Library does not cover are still scanned as before.

## [0.0.81] - 2026-10-25

### Added

- Steer the Archive Discovery shelf: search your Archive for up to five artists
  and choose **Discover new artists** to find similar artists you do not own.
  Artists without a verified MusicBrainz identity can be followed by name.
- Last.fm similar artists join ListenBrainz, merged by artist name; artists
  suggested by more than one source rank higher and show their sources.
- Selecting a suggested artist checks MusicBrainz and Discogs for studio albums,
  reports what each found, and marks albums listed by both.
- Tick several albums and **Search Soulseek** to open one search tab per album,
  stopping at the tab limit and keeping the rest selected.
- Optional Fanart.tv artist photo on the album panel.
- **Sources** panel for Last.fm, Discogs and Fanart.tv keys, stored in the
  operating-system credential store. Development builds also read `.env.local`.

### Changed

- Discovery providers each have their own request spacing and cooldown, and the
  cache holds 256 responses (was 64). The shelf lists up to 24 artists (was 12)
  and shows studio albums instead of three picks.

## [0.0.80] - 2026-10-24

### Fixed

- Rust formatting in the Music Library share-measurement test, which failed the
  0.0.79 release checks.

## [0.0.79] - 2026-10-24

### Changed

- Shared-folder scans now reuse bitrate and duration already measured by Music
  Library (read-only), skipping the audio header probe for files whose size and
  modified time still match. New folders index much faster; unmatched or changed
  files are still inspected, and sample rate/bit depth come from Forever's own cache.

## [0.0.78] - 2026-10-24

### Added

- System tray with live connection/transfer status, Open, Pause/Resume all
  transfers, and Quit through Safe Passage. Closing keeps Forever running by
  default, with an exit-on-close preference and a visible fallback if tray creation fails.
- Opt-in operating-system sign-in startup, optional hidden startup, explicit
  `--background` launch, and persistent window size, position, and maximized state.
- Single-instance protection before plugin/store/network initialization; second
  launches restore and focus the existing window. Deep-link forwarding is enabled
  for future URL handling, without registering a URL scheme.

### Changed

- Desktop preferences join unified settings export/import/reset with legacy
  defaults. Autostart remains an explicit, per-computer OS setting.
- Manual transfer holds share the bandwidth controller, persist across restarts,
  and respect individual pauses and metered-network policy when resumed.
- Official desktop plugins bring the compatible Tauri 2.12 runtime dependencies.

### Fixed

- Quit requests during WebView startup are retained; failed exit saves leave the
  window open for retry, and duplicate requests do not overlap queue preparation.
- Local ignored Playwright scratch directories are also excluded from ESLint.

## [0.0.77] - 2026-10-24

### Added

- Shared combined, download, and upload payload bandwidth caps in KiB/s, applied
  live across all transfer lanes with unlimited defaults and bounded burst credit.
- Daily alternate limits on local-time schedules, including overnight windows,
  plus live active-policy and network-cost status in Settings and Transfers.
- Optional Windows metered-network transfer holds, also covering unknown cost,
  roaming, over-limit and restricted networks, with automatic continuation.

### Changed

- Bandwidth policy persists through unified settings, backup recovery, export,
  import, and Transfers reset. Older settings retain unlimited behavior.
- Limiter waits remain cancellable and excluded from source-idle timeouts;
  held queues do not spin on overdue retries or automatically change sources.

### Fixed

- Release publication now uses the installer action's release ID to find drafts
  instead of the published-only tag endpoint that failed releases 0.0.72–0.0.76.
  Draft asset URLs are normalized from verified asset membership to their final
  versioned download URLs before publishing, with draft/recovery regression tests.

### Verification

- Concurrent aggregate/directional budget, bounded credit/refunds, overnight and
  clock-change schedules, metering/cancellation, settings compatibility, stream
  pacing/resume, and UI validation coverage. Browser preview checks are separate
  from installed-app public Soulseek and physical metered-network validation.

## [0.0.76] - 2026-10-24

### Added

- Artist Follow from album search, verified Archive follow suggestions, and a
  New Release Radar inbox in the Listening Post for recent/upcoming albums, EPs,
  and singles. Includes follow management, dismissal/restore, and Add to Wanted.
- Daily MusicBrainz checks while the desktop app is open, bounded date-filtered
  queries with shared provider pacing, persisted retry cadence, manual cooldown,
  partial/error states, and a crash-safe follow/inbox store readable offline.
- Per-artist opt-in automatic Wanted additions with current default Smart Match
  preferences, Archive ownership checks, durable addition receipts, and protection
  for existing Wanted preferences, paused/fulfilled albums, and edition choices.

### Verification

- Regression coverage for date precision, provider pagination/identity/dedup,
  scheduling/restarts, stale follows, dismissals, auto-add failures and idempotency,
  insert-only Wanted behavior, frontend event ordering, and inbox actions.
- Browser preview validation is separate from installed-app, long-running daily
  scheduling, and live public Soulseek validation.

## [0.0.75] - 2026-10-24

### Added

- Archive Discovery shelf: up to 12 ranked similar artists from ListenBrainz,
  seeded by up to five most-owned verified MusicBrainz artists, with visible
  recommendation reasons and complete Archive artist ownership filtering.
- Three studio album picks per selected artist, matched to MusicBrainz catalog
  identities and ranked by ListenBrainz listens, with Smart Match source-search
  handoff and offline-capable Add to Wanted.
- Bounded persistent discovery cache, serialized provider requests, rate-limit
  cooldowns, explicit stale/partial/fallback notices, empty/error/retry states,
  and guards against late responses after artist or Archive-source changes.

### Verification

- Regression coverage for read-only full-Archive filtering, verified aliases,
  deterministic ranking, provider cache/restart/failure behavior, album identity,
  stale UI responses, Wanted errors, and Smart Match handoff. Browser preview
  checks are separate from native installed-app/public Soulseek validation.

## [0.0.74] - 2026-10-24

### Added

- Arrival Desk tagging and filing with current/proposed tag and path previews,
  explicit MusicBrainz edition and track mapping, optional Cover Art Archive
  front-cover preview/embedding, and safe naming templates.
- Staged Lofty writes with read-back verification, no-overwrite publication,
  retained original files, SHA-256 conflict checks, and durable filing history
  with reviewed undo and interruption recovery. Companion files are retained.
- Unified filing defaults for library root, naming, artwork, and an optional
  incomplete folder used by new downloads; existing resume paths stay intact.
- Optional quoted PowerShell hand-off to beets interactive import. External
  beets changes remain outside Forever undo; Music Library stays read-only.

### Changed

- Transfer paths and sizes follow filed files; undo restores original history
  data without recreating transfer records the user deliberately cleared.
- Patch Bay and transfer mutations are guarded during filing and while an
  arrival owns retained originals; file work stays off the network executor.

## [0.0.73] - 2026-10-24

### Added

- Local sonic analysis in Deep Soundcheck: spectral shelves and consistency,
  advisory transcode/upsampling verdicts, inconclusive and lossy-source states,
  padded integer bit depth, clipping runs, and expandable Arrival Desk spectrograms.
- Patch Bay repairs for sonic concerns, with explicit review and preserved
  originals; suspect replacements remain in needs-attention after rescanning.
- Bounded, deduplicated sonic observations in local source history, separate
  from transport success/failure and used as a modest mirror-ranking penalty.

### Changed

- Deep scans and repair completion decode outside the transfer queue lock and
  network executor. Stale scan results cannot overwrite a switched source or
  newer scan. Spectrograms use compact, bounded storage; legacy results load
  without invented sonic evidence.
- Quick rescans retain earlier sonic evidence only for the same file stamp.

### Verification

- Synthetic signal regressions plus deterministic encoded FLAC fixtures cover
  broadband, MP3 transcodes, upsampling, silence/tones, mixed bandwidth, padding,
  clipping, unchanged source bytes, persistence, stale results, and repair UI.
  These checks do not establish accuracy on a representative music corpus or
  prove an audio file's mastering history.

## [0.0.72] - 2026-10-24

### Added

- Persistent Stable/Beta update channels, fixed native feed selection, and
  separate stable/prerelease publication with a version-ordered Beta feed.
- Azure Artifact Signing integration for executable and installers, with
  required configuration checks and valid timestamped Authenticode verification
  before publication. Account/profile/credential provisioning remains pending;
  this release does not claim Windows publisher signing is activated.

### Changed

- New preferences check for updates at launch and every six hours. Existing
  saved intervals and startup-only mode are preserved.
- Releases stay drafts until artifact checks and feed validation finish. Beta
  MSI packaging uses a numeric Windows Installer version while app updates
  compare the complete prerelease SemVer.

### Fixed

- Update checks wait for settings, discard results from a previous channel,
  release native update resources, and reject an obsolete offer before or after
  Safe Passage preparation. Stable never offers prereleases or downgrades.
- Settings shows the current package version instead of an outdated hard-coded value.

### Verification

- Regression coverage for cadence, channel persistence/migration, stale checks,
  update preparation, release ordering, feed assets and signing configuration.
- Actual Azure signing, installed-app upgrades and SmartScreen behavior still
  require provisioning and release/device validation.

All notable changes to Forever are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.71] - 2026-10-24

### Added

- Opt-in **Auto-switch to exact mirrors** after 5–60 minutes stalled, with
  backend checks for complete unique filename/size coverage, current state,
  blocked users, Safe Passage, and a three-switch limit without source loops.
  Completed files and partial bytes are preserved; mismatches remain manual.
- Durable local source reliability history, Signal Relay ranking adjustments,
  and evidence-backed **Flaky source** badges. Queue-aware album ETA estimates
  use observed start delays and speed, and remain unknown without enough history.

### Changed

- Six bounded transient retries (5, 15, 45, 120, 300, 600 seconds), keeping stall
  age across retries. Silent file connections retry after 60 seconds without data.
- Download speed and ETA use an EMA with idle samples and per-attempt reset.
  Transfer history migrates to schema 4; existing settings keep automatic mirrors off.

### Fixed

- Late file/peer callbacks cannot fail, complete, count, or unregister a newer
  attempt. Cancelled writers close before partial files resume, and finalization
  checks the attempt under the transfer lock before moving the file.

### Verification

- Regression coverage for exact mirror coverage, stale replies, source limits,
  partial preservation, persisted reliability, settings compatibility, queue ETA,
  speed smoothing, and background recovery across navigation.
- Local browser/IPC tests do not establish live public Soulseek interoperability.

## [0.0.70] - 2026-10-24

### Changed

- A typed workspace registry replaces the shell's nested view switch. Home,
  file/album search, Browse, Messages, People, Rooms, Transfers, Archive and
  Settings load on demand with local loading and error boundaries.
- Shared connection, transfer, Wanted and navigation state lives above the
  routes in a selector-based provider. Workspace changes retain live listeners,
  search presets, selected people, message drafts and cross-workspace targets;
  unrelated subscribers do not render on transfer progress alone.
- Split the large application stylesheet into workspace and shared files with
  Midnight Radio color, spacing and radius tokens. Styles load once in their
  existing cascade order, preserving the appearance across navigation.

### Fixed

- Settings opens the real connection form with suggested defaults when a fresh
  profile explores offline; removed the obsolete placeholder views and copy.

### Added

- Build verification for all ten lazy workspace chunks and regression coverage
  for selector isolation, current action closures, chunk failures, late route
  resolution and existing navigation flows through asynchronous workspace loads.

## [0.0.69] - 2026-10-24

### Changed

- Split the connection service into session, hub/server dispatch, command,
  distributed-network, peer IO, and reconnect/search modules, retaining one server
  writer and the cancellation-safe frame reader.
- Hubs share frame and lifecycle hooks. Their timers use a bounded session queue,
  skip missed ticks, and cancel when a connection attempt ends.
- Download scheduling wakes on queue/lifecycle changes and retry deadlines,
  preserving lane and source limits without polling once per second.

### Fixed

- Explicit disconnect now applies the same upload, privilege, and unsent-message
  cleanup as an interrupted connection. Old attempts check their generation before
  applying disconnect cleanup.

### Added

- Seeded cargo-fuzz targets for server, peer/compressed-response, and distributed
  parsers, plus a standalone parser harness and bounded CI fuzz smoke workflow.
- Regression tests for hub dispatch, malformed frames, reconnect state, upload
  recovery, retry eligibility, scheduler wakeups, and timer cancellation.

## [0.0.68] - 2026-10-24

### Added

- **Export diagnostics** in Settings saves a local ZIP with event logs, app/Tauri
  versions, platform details, a safe settings summary, and the latest Rust panic
  report. The export excludes credentials, IPs, usernames, hostnames, paths,
  search text, activity history, and free-form messages. Nothing is uploaded.
- An early panic hook records the build, platform, timestamp, and source location
  atomically in one bounded local report, without panic payloads or raw stacks.

### Fixed

- Connection logging uses structured `tracing` and daily UTC rotation, retaining
  seven files capped at 4 MiB each, including across restarts. Recent activity
  remains available when log storage fails or the daily cap is reached; startup
  and diagnostics export still work. Write failures and cap notices
  appear in diagnostics. Legacy `connection.log` is preserved and no longer used.
- Diagnostics exports bound reads, filter every included field, report skipped or
  malformed data, and atomically replace the chosen ZIP outside the configuration
  directory so failed exports preserve an existing report.

## [0.0.67] - 2026-10-24

### Added

- A typed, versioned `settings.json` for all application preferences, shared roots,
  Archive location, and pinned/recent searches, with `settings_get` and
  `settings_patch` commands, ordered change events, atomic saves and backup recovery.
- Settings export/import with a review step, whole-document validation and a 256 KiB
  limit; passwords and operational history are excluded. Section resets describe
  their effects and retain unrelated settings, history and files.

### Changed

- Existing JSON and WebView preferences migrate once. Old settings files remain
  available for recovery; WebView keys are removed only after the new store is saved.
  Drafts and transient workspace state remain separate.
- All settings controls use the same authority, with serialized patches and revision
  guards. Failed writes leave displayed values unchanged and show a persistent error.
- Restores apply runtime preferences without changing the active workspace. Imported
  presets open next launch; changed account/network settings disconnect for reconnection.
  Forgetting an account also scrubs it from the settings recovery copy.

## [0.0.66] - 2026-10-24

### Added

- A persistent SQLite MusicBrainz cache for artist searches (one day), catalogs
  and edition lists (seven days), and verified tracklists keyed by release MBID
  (no time expiry), with bounded storage and session-cache fallback on disk errors.
- A MusicBrainz status notice showing the shared cooldown countdown and cache
  failures; cached data remains available while live requests are throttled.

### Fixed

- MusicBrainz requests now use the build version in their identifying User-Agent,
  share one request governor, and retry HTTP 429/503 at most twice using exponential
  backoff and Retry-After seconds or HTTP dates. Deadlines include queueing;
  redirects and implicit HTTP retries cannot bypass request pacing.
- Concurrent metadata misses reuse the completed lookup. Persistent serialization
  preserves artist types, release dates/types, edition counts, and track durations;
  cached tracklists still enforce the selected album's identity.
- Invalid/oversized responses and empty or unverified tracklists are not cached;
  unreadable rows are discarded and unsupported/corrupt cache files are preserved.

## [0.0.65] - 2026-10-24

### Added

- Header-only audio quality attributes in local search, browse, and folder replies:
  duration, estimated average bitrate, sample rate, and bit depth when available.
- A transactional SQLite share index keyed by local path, file size, and modification
  time, reusing unchanged header results across rescans and application restarts.
- Debounced native folder watching with partial subtree scans, bounded event bursts,
  periodic reconciliation, watch retries, and visible watcher/cache health in Settings.

### Fixed

- Changed, renamed, deleted, disabled, and removed shares refresh public listings,
  queued search replies, upload lookup, and server counts. Concurrent scans serialize.
- Partial scans reject Windows junctions and symlink ancestors as well as hidden and
  temporary entries. Cache failures preserve existing data and allow uncached indexing.

## [0.0.64] - 2026-10-24

### Added

- Per-user round-robin uploads with least-active-user slot allocation, preserving
  each user's file order and optional favorites/privileged priority within turns.
- Upload fairness settings: default limits of 100 pending files and 10,000 decimal
  MB per user, including active requests; standard Soulseek over-limit denials.
- Durable pending uploads and turn history in `uploads.json`, with atomic writes,
  validated backup recovery, startup notices, and visible save failures/retries.

### Changed

- Sharing schema 3 migrates existing settings to bounded upload limits with both
  priority switches off. Lower limits preserve requests already accepted.
- Server code 69 uses bounded parsing and replaces session-only privilege data;
  malformed lists retain the last valid list and disconnect clears it.
- Queue positions follow fair scheduling. Interrupted uploads requeue after restart;
  share indexing, current root permissions, file size, and block-list checks gate sends.

### Fixed

- Stale upload progress, completion, failures, and task cleanup cannot alter a later
  retry. Duplicate pending requests do not consume per-user quota.

## [0.0.63] - 2026-10-23

### Added

- Advanced search filters for bitrate, sample rate, bit depth, free slots, queue
  length, decimal-MB size ranges, extensions, excluded path words, country,
  blocked/ignored users, and a results-per-user cap applied after sorting.
- Sortable file and album-source column headers with ascending/descending order;
  advanced filters and sorts persist with pinned Dial Memory presets and duplicates.

### Changed

- File lists, two-column grids, and album-source lists use TanStack Virtual for
  large searches, with stable row identity, dynamic confidence-panel measurement,
  keyboard navigation, and independent preset/view scroll restoration.
- Ordinary file searches skip album grouping and ranking. Filtering and grouping
  use deferred result batches; album filters retain complete sources and companions.
- Missing metadata is explicitly excluded by active numeric/country filters;
  country supports an explicit unknown value and older presets receive defaults.

### Verification

- Regression tests cover 5,000-result bounded rendering, keyboard access, append
  stability, filter resets, grid restoration, numeric boundaries, whole-album
  preservation, stable sorting/caps, and preset migration/duplication/restoration.

## [0.0.62] - 2026-10-23

### Added

- MBID-first Archive ownership from Music Library's saved include decisions
  linked to existing local albums and verified, non-ignored artist identities.
  Owned badges show MBID or title evidence, with local album details on hover;
  Missing Shelf and fulfilled Wanted rows also explain their match.
- A database picker in Archive's Library source view, an automatic-detection
  badge, and a reset to the automatic location. Custom sources are validated
  read-only before saving; Forever's versioned `archive.json` uses atomic
  replacement, backup recovery, and visible recovery notices.

### Fixed

- Known, conflicting local release-group identities cannot claim another album
  through a title match. Cached discographies alone never establish ownership;
  databases without saved identity links retain Unicode-aware title fallback.
- Transfer ownership uses the retained MusicBrainz release-group identity while
  keeping the download ID for correlation. Source changes invalidate ownership
  results and Missing Shelf caches, including late replies from the old source.
- Title tie-breaking uses original album year before reissue year and stable
  local IDs. Rejected database selections preserve the configured source.
- Transfer verification ages start from the time the view opens, avoiding
  stale initial ages after a long session.

### Tests

- SQLite fixtures cover MBID priority, conflicting/dangling/unverified links,
  older schemas, Unicode fallback, original years, and byte-for-byte read-only
  preservation. Settings and rendered frontend tests cover selection, reset,
  cancellation, failure, match reasons, transfer identities, and stale replies.

## [0.0.61] - 2026-10-23

### Added

- Duration-aware Tracklist Confidence in the shared Rust matcher: per-track
  differences, a three-second agreement window, explicit unknown lengths, and
  album duration agreement as a ranking tie-breaker. Known mismatches require
  review instead of receiving a Smart Match recommendation.
- Official MusicBrainz edition selection in review and Smart Match profiles,
  with date, country, edition description, format, and track count. Wanted
  remembers each choice across restarts; schema 4 migrates existing albums to
  Automatic. Release lists are paced, cached, paginated up to 500, and labelled
  when incomplete; selections validate official status and album membership.
- Multi-disc sources combine exact numbered disc folders for one listener,
  inspect all advertised discs, and preserve numbered local subdirectories
  and parent companion files in a single queued release.

### Fixed

- Edition changes clear old recommendations and reject stale metadata results.
  A saved edition with unavailable metadata cannot silently become a track-count
  recommendation. Search comparisons and expected download counts use the choice.
- Duplicate search replies cannot inflate frontend source counts, and multi-disc
  downloads retain one queued-state identity and duplicate-download guard.

### Tests

- Shared Rust/frontend fixtures cover duration ties, truncation/live mismatches,
  repeated titles, missing lengths, and disc-folder boundaries. Added edition
  parsing, membership, persistence/migration, multi-disc inspection/path, and
  rendered selector/review regression coverage.
- Duration evidence describes reported metadata, not acoustic verification.
  Public Soulseek multi-disc interoperability remains unverified.

## [0.0.60] - 2026-10-23

### Changed

- Consolidated Smart Match scoring, format preference, bitrate eligibility,
  deterministic tie-breaking, and Tracklist Confidence in one portable Rust
  matching crate. Desktop IPC, Wanted summaries, Search, Radar review, and
  inspected-folder review use that implementation; TypeScript policy copies
  are removed.
- Background Wanted checks fetch the official tracklist with a bounded metadata
  deadline and label the track-count fallback when it is unavailable. Repeated
  file replies no longer inflate source completeness or scores.
- Archive ownership and album queries share the matcher's Unicode NFKD accent,
  punctuation, and ampersand normalization. Filename cleanup preserves dotted
  official titles and uses the same supported audio formats.
- Local browser previews and frontend integration tests run the Rust matcher
  through a small local helper. Rust/Cargo is now required for matching in
  browser development; CI installs it for the frontend checks.

### Fixed

- Unknown or zero lossy bitrates no longer pass the frontend's minimum-bitrate
  rule. Late ranking responses cannot revive recommendations for old inputs;
  loading and failed checks block recommendation-based downloads.

### Tests

- Shared golden fixtures cover normalization, official titles, extras, missing
  tracks, format restrictions, unknown bitrates, and stable scores/order.
  Wanted summary parity and frontend flows exercise the same Rust implementation.

## [0.0.59] - 2026-10-23

### Added

- One Rust album query builder for Wanted, Shelf Radar, Signal Relay, and album
  handoffs: Unicode accent folding, punctuation and ampersand normalization,
  conservative edition/remaster suffix removal, short-word reduction, and a
  200-byte word-boundary limit. Entirely short names remain searchable.
- Up to three distinct attempts after empty results: artist plus title, title
  alone with an artist path filter, then artist plus distinctive title words.
  Fresh tokens reject stale replies; queued retries retain full response windows
  and remain in their original search-governor lane, including wishlist pacing.
- Shared successful-variant history in bounded, crash-safe `search-queries.json`,
  reused across producers and restarts. Query progress is visible in search,
  Wanted, and Radar status; ordinary typed file searches retain their syntax.

### Changed

- Preserve structured artist/title metadata on new album transfers for Relay;
  migrate transfers to schema 3 without guessing identities for older folders.
  Relay searches without metadata receive normalization with no broad fallback.
- Explain that empty albums can consume up to three wishlist slots. Only the
  completed check contributes an empty-check backoff outcome.
- Mark review item 6 complete, align release versions, and add normalization,
  persistence/recovery, scheduling, cancellation, artist-filter, IPC handoff,
  transfer migration, and stale-token regression coverage.

## [0.0.58] - 2026-10-23

### Added

- Server-paced Wanted checks using WishlistSearch (103) and strict parsing of
  WishlistInterval (104). Unknown or zero intervals prevent automatic searches;
  interval updates, reconnects, and delayed ticks cannot create catch-up bursts.
- One shared five-second search budget with user, Signal Relay, Shelf Radar, and
  Wanted priority lanes. Queued requests retain full response windows and can
  be cancelled or replaced before dispatch.
- Persisted Wanted backoff after empty checks (1 h, 6 h, then 24 h), resetting
  when sources return. Due-time ordering keeps large watchlists rotating fairly.
- Effective cadence and earliest-slot estimates, explicit waiting/disabled
  states, and preferred-rhythm wording instead of guaranteed per-album timing.

### Fixed

- Accept Signal Relay's namespaced session IDs so automatic rescue searches
  reach their intended bounded lane.

### Changed

- Migrate Wanted stores to schema 3, preserving existing watch history without
  inventing misses. Mark review item 5 complete and align release versions.
- Add protocol, mixed-producer pacing, queue cancellation, 500-album rotation,
  backoff, migration, and scheduling-status regression coverage.

## [0.0.57] - 2026-10-23

### Fixed

- Handle server ExcludedSearchPhrases (160) with bounded parsing and a shared,
  atomically replaced set. Full virtual paths are matched case-insensitively in
  server/distributed search, browse, and folder responses, including a final
  check of queued search replies. Filtering precedes the search-result limit;
  fully excluded folders are omitted. Invalid updates keep the last valid list.
- Send SendUploadSpeed (121) once per successfully completed upload with a
  measured average in bytes per second, excluding the resume offset and bounded
  to the protocol's 32-bit field. Cancelled, failed, and zero-byte attempts do
  not report a sample, and reports cannot leak into a later server session.
- Wait for the downloader to close the file connection before completing an
  upload, with a 30-second confirmation timeout and cancellation during I/O.

### Changed

- Mark review item 4 complete, document protocol behavior, and align application,
  package, Cargo, Tauri, updater preview, Settings, and MusicBrainz versions.
- Add wire-format, parser-boundary, exclusion-update, response-filtering,
  upload-resume, completion, cancellation, and failure regression coverage.

## [0.0.56] - 2026-10-23

### Added

- Configurable TCP listening port (2234 by default), bounded fallback on port
  conflicts, and separate listening/advertised port evidence in Settings.
- Automatic UPnP IGD, PCP, and NAT-PMP mapping with expiring leases, renewal,
  discovery retry, external-port announcement, and serialized session cleanup.
- Direct-connection testing through Soulseek's official port checker, with
  reachable/firewalled/unknown states backed by actual incoming connections.
- Opt-out distributed branch participation with up to four children, server
  speed limits, a 60-second stability gate, bounded queues, duplicate/rate
  guards, topology propagation, and reset/disconnect cleanup.

### Fixed

- Branch-root parent candidates can be adopted even if they send only level 0;
  legacy wrapped searches are unwrapped before relaying to children.
- Expired sessions cannot replace current reachability evidence or delete a
  newer mapping; exit and updater preparation await router cleanup.
- Per-user distributed request-rate history is pruned to remain bounded.

### Changed

- Connection store version 2 migrates earlier profiles with network defaults.
- Version metadata and updater preview now identify `0.0.56`.
- Coverage includes port conflicts, migrations, stale tests, lease renewal and
  deletion, child protocol exchange, queue pressure, and Settings interaction.

## [0.0.55] - 2026-10-23

### Added

- Shared crash-safe persistence for all seven JSON stores: synced temporary
  files, atomic primary and backup replacement, and serialized saves per store.
- Explicit, fixture-tested migrations from legacy version-1 stores to version 2
  and from unversioned connection settings to a version-1 profile envelope.
- Non-blocking startup notices explain backup recovery, empty/default fallback,
  quarantine paths, and stores protected from writes.

### Fixed

- Corrupt stores no longer prevent startup. Damaged bytes are preserved before
  recovery, and invalid primaries never replace a valid backup.
- Unsupported schemas and unreadable or unpreservable stores remain untouched
  and reject writes for the session. Forgetting connection settings also removes
  the backup so old preferences cannot be restored on restart.
- Process-exit tests cover each atomic-save boundary; regression tests cover
  seven-store migration and recovery, backup rotation, concurrent saves,
  failures/retry, newer schemas, and notice dismissal with usable navigation.

### Changed

- Application, updater preview, package, Cargo, Tauri, Settings, and MusicBrainz
  metadata now identify version `0.0.55`.

## [0.0.54] - 2026-10-23

### Changed

- Download progress updates now touch only an in-memory map of active transfers.
  One `forever://transfer-progress` batch publishes changed bytes, speed, and ETA
  at most every 250 ms; lifecycle, metadata, and settings changes publish full
  queue snapshots.
- Transfer JSON serialization and writes now run on one background thread with
  one replaceable pending snapshot. State changes request saves immediately;
  changing progress requests a checkpoint every five seconds.
- Closing an idle queue and Safe Passage exit/update preparation wait for the
  pending transfer save. Save failures stay visible until the writer recovers.
- Application, updater preview, package, Cargo, Tauri, Settings, and MusicBrainz
  metadata now identify version `0.0.54`.

### Fixed

- Ordered queue/progress events and command responses prevent delayed telemetry
  from replacing newer pause, completion, and history-removal state. Unchanged
  frontend transfer objects retain their identity during progress merges.
- Pausing retains the latest sampled byte count, while restart/resume continues
  to recover exact progress from `.part` files even with an older checkpoint.
- Initial history loading no longer triggers completion notifications.
- Regression coverage exercises six lanes with 10,000 historical entries,
  checkpoint cadence, stale attempts, writer coalescing/failure/recovery,
  frontend event races, listener cleanup, and failed-exit messaging.

## [0.0.53] - 2026-07-28

### Added

- **Tracklist Confidence** compares normalized Soulseek audio filenames with the
  earliest official MusicBrainz edition and labels every grouped source as
  **Exact tracklist**, **Complete with extras**, **Missing**, or **Unclear**.
- Album-source rows expand into a track-level comparison of matched filenames,
  missing official titles, and unexpected audio files.
- Smart Match review verifies the inspected remote folder against the official
  titles before enabling **Queue complete album**.
- Frontend, ranking, normalization, and rendered interaction coverage protects
  exact, bonus-track, partial, unavailable, and mislabeled-folder behavior.

### Changed

- Exact and complete tracklists now outrank format, free-slot status, speed, and
  queue length in Album Search and when Wanted alternatives are sorted by best
  match.
- A questionable source stays available for manual inspection but requires an
  explicit **Download anyway** confirmation; it cannot be silently queued as
  the recommended Smart Match.
- Releases without an official MusicBrainz title list retain the existing
  track-count and Smart Match preference fallback.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.53`.

## [0.0.52] - 2026-07-28

### Added

- Settings now includes a persistent **MusicBrainz fallback tracks** value,
  initially 10 and configurable from 1 to 250, for releases without an official
  track count.

### Changed

- Missing Shelf now uses the dedicated MusicBrainz fallback setting instead of
  coupling missing catalog metadata to the default Smart Match profile.
- Wanted **Compare** carries the album's minimum-track rule into Search, reports
  file, source, and listener totals from qualifying folders, and keeps every raw
  reply available under **Individual files**.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.52`.

### Fixed

- One-track singles, samplers, and other partial folders below a Wanted album's
  minimum no longer appear as downloadable albums in its grouped comparison.
- Frontend and rendered interaction coverage protects fallback persistence,
  missing-MusicBrainz handoff, qualified comparison counts, and access to raw
  individual-file replies.

## [0.0.51] - 2026-07-28

### Changed

- MusicBrainz track-count lookup is now best-effort per selected album while
  the final Missing Shelf handoff remains one atomic Wanted-store write.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.51`.

### Fixed

- An absent official MusicBrainz tracklist or a failed lookup no longer blocks
  the entire Missing Shelf batch. The affected album uses the saved default
  track minimum, or a safe 10-track minimum when the default accepts any count.
- A persistent amber completion notice names a single affected album—or reports
  the affected count for larger batches—so the fallback is visible without
  presenting a failed add state.
- Frontend and rendered interaction coverage protects the fallback handoff,
  successful completion message, and resulting `10+ tracks` Wanted profile.

## [0.0.50] - 2026-07-28

### Added

- Missing Shelf's **Tracks** control now offers **Any**, **Custom**, and
  **MusicBrainz** modes when adding one or more collection gaps to Wanted.
- MusicBrainz mode resolves the earliest official edition for every selected
  album and stores its canonical count as that album's minimum, so one atomic
  batch can carry different track targets without changing the shared format
  and bitrate profile.
- Native, frontend, and rendered interaction coverage protects per-album track
  targets, custom-count validation, and the three-mode handoff.

### Changed

- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.50`.

### Fixed

- The Windows title-bar **X** closes Forever again. The main window capability
  now permits the destroy step Tauri performs after the existing close-request
  listener finishes, while Safe Passage can still intercept active transfers.

## [0.0.49] - 2026-07-28

### Added

- **Fulfilled Shelf** keeps verified Wanted downloads as persistent, quiet
  completion receipts instead of discarding their history. Each receipt records
  the actual listener, format, verified audio-track count, size, Soundcheck
  result, completion time, and current Arrival Desk journey.
- A fulfilled download can open its Arrival, reveal the downloaded folder while
  transfer history remains, be removed from history, or use **Add back** to
  begin a fresh watch.
- Native, frontend, persistence, and rendered interaction coverage protects the
  completion receipt and reversible re-add flow.

### Changed

- Fulfilled downloads no longer contribute to active Wanted counts, background
  checks, Missing Shelf state, or Smart Match alerts, while their receipt stays
  available under the existing Fulfilled filter.
- **Add back** clears stale results and completion evidence, resets the watch
  timestamp, and explicitly resumes monitoring even when the read-only Music
  Library already reports the album as owned.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.49`.

### Fixed

- Archive reconciliation can no longer replace a verified download receipt or
  immediately re-fulfill a watch the listener explicitly added back.

## [0.0.48] - 2026-07-28

### Fixed

- A Wanted album now retires automatically after its matching Forever download
  completes and every expected audio track verifies, stopping redundant Smart
  Match checks, in-app alerts, and Windows availability notifications.
- Incomplete, missing, size-mismatched, queued, failed, or failed-Soundcheck
  releases remain in Wanted instead of being treated as fulfilled.
- Re-adding a previously downloaded album creates a fresh watch. Only a newer
  successful verification can retire it, so stale transfer history cannot
  immediately remove the new entry.

### Changed

- Verified downloads prefer their persisted MusicBrainz release-group identity
  when matching Wanted and safely fall back to the canonical artist, album, and
  year title for older transfer history.
- Downloaded Wanted entries are retired in one atomic native-store update, and
  any matching visible Smart Match alert closes with the fulfilled watch.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.48`.

## [0.0.47] - 2026-07-28

### Added

- **Patch Bay** inside Arrival Desk finds targeted replacements for missing,
  failed, size-mismatched, or corrupt album tracks while leaving verified files
  untouched.
- Live candidates are ranked by track number, normalized title, format,
  duration, sample rate, bit depth, upload-slot readiness, and confidence, with
  an explicit compatibility confirmation for risky changes.
- Album downloads persist their MusicBrainz release-group identity. Patch Bay
  can load the earliest official tracklist to name missing sequence positions,
  while safely falling back to the selected Soulseek source count offline.
- Native and frontend regression coverage protects repair targeting, candidate
  ranking, official sequence parsing, and the Arrival Desk repair handoff.

### Changed

- Repair transfers remain visible at Arrival Desk through queued, downloading,
  deep-checking, repaired, and needs-attention states, including across restarts.
- A selected replacement preserves the rejected original, resets only the
  target track, follows the configurable one-file-per-user transfer lanes, and
  receives an automatic Deep Soundcheck after arrival.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.47`.

## [0.0.46] - 2026-07-28

### Added

- **Soundcheck** automatically performs a persisted, read-only quick scan when
  a completed audio file passes the existing on-disk size verification.
- MP3, FLAC, AAC/M4A, OGG/Vorbis, WAV, AIFF, ALAC, and CAF checks report codec,
  container, duration, bitrate, sample rate, bit depth, channels, track number,
  and actionable parsing issues; recognized unsupported audio stays visible for
  review, and Opus receives safe header inspection when decoding is unavailable.
- Arrival Desk shows a release-level Soundcheck verdict and expandable
  per-track evidence, including expected audio count, duplicate or missing track
  numbers, quick/deep scan provenance, and a full decoder-based **Deep Scan**.
- Settings can disable automatic checks while keeping manual Quick and Deep
  scans available.
- Failed checks can start Signal Relay replacement discovery. When a replacement
  is explicitly selected, the suspect file is preserved with a
  `.soundcheck-rejected` suffix before the new download starts.
- Native and frontend regression coverage protects valid, corrupt, unsupported,
  incomplete, and complete Soundcheck states.

### Changed

- Album-source and Smart Match downloads now persist their expected track count
  so completed releases can be checked against the selected source.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.46`.

## [0.0.45] - 2026-07-27

### Changed

- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify hotfix version `0.0.45`.

### Fixed

- The Wanted cadence integration flow now waits for React to commit its
  asynchronous preference update before asserting the selected value,
  preventing slower Windows release runners from intermittently reading the
  previous 30-minute cadence after selecting 15 minutes.

## [0.0.44] - 2026-07-27

### Added

- **Arrival Desk** inside Archive turns completed album downloads into a
  filterable journey with **Ready to file**, **Filed away**, **Moved**, and
  **Needs attention** states.
- Completed releases can be confirmed as filed, reopened, revealed, verified,
  removed individually from transfer history, or cleared in a filed-history
  batch without deleting downloaded files.
- Home's Archive Pulse now reports albums ready to file and links directly to
  the Arrival Desk.
- Native regression coverage protects persisted filing state and selective
  completed-history removal; frontend coverage protects derivation and the
  complete Arrival Desk interaction.

### Changed

- Completed releases are reconciled with Music Library as soon as transfer
  state changes and every five minutes while Forever remains open.
- Transfers marked filed by the listener share Finish Line's existing
  **Moved** semantics instead of later appearing as missing.
- Application, updater preview, package, Cargo, Tauri, Settings, and
  MusicBrainz metadata now identify version `0.0.44`.

### Fixed

- Moving a successfully downloaded album into a separate music collection no
  longer leaves permanent false-positive attention state once it is confirmed
  at the Arrival Desk.

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
