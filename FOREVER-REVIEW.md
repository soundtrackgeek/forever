# Forever: Improvements, New Features, and Ecosystem Research

_Reviewed version: **0.0.53** (commit `687a83f`) · Review date: **2026-10-23**_

This review covers the Rust backend (`src-tauri/src`), the React frontend (`src`),
the CI and release pipeline, and the product surface described in `README.md` and
`CHANGELOG.md`. It has three parts:

1. **20 existing features that can be improved**, with how to improve each one.
2. **20 new features worth adding**, with how each fits the current architecture.
3. **Online services, APIs, and libraries** that could improve the app, checked
   against current (October 2026) sources.

Ratings use **Impact** (High / Medium / Low) and **Effort** (S ≈ one day or less,
M ≈ several days, L ≈ one week or more).

---

## The app at a glance

Forever is a Tauri 2 + React 19 + Rust desktop client with its own native Soulseek
protocol implementation. That implementation covers the server session, peer
connections, distributed-network leaf participation, uploads, and downloads. Around
the protocol sits a product layer for album collecting: MusicBrainz discovery,
Wanted Signals, Smart Match, Tracklist Confidence, Missing Shelf, Shelf Radar,
Finish Line, Arrival Desk, Soundcheck, and Patch Bay.

| Metric | Value |
|---|---|
| Rust (backend) | ~21,600 lines in 23 files; `service.rs` alone is 4,288 lines |
| TypeScript/TSX (frontend) | ~21,500 lines; `App.tsx` is 1,391 lines |
| CSS | One `App.css` of 14,107 lines |
| Tests | ~103 Rust tests, ~80 frontend tests (Vitest + Testing Library) |
| Persistence | 7 JSON stores + WebView `localStorage` + a read-only external SQLite DB |
| Platforms | Windows only (NSIS + MSI, signed Tauri updater, no Authenticode) |

**Strengths:** safety-first engineering. Peer parsing is bounded, files are never
overwritten, `.part` resume is careful, and the Archive is enforced read-only.
Changelog discipline is excellent, the product language is coherent, and
behavioral test coverage on the frontend is strong.

**Main gaps:** hot-path scalability, robustness of persisted state, network
reachability, logic duplicated between Rust and TypeScript, and a design tied to
one platform and one library source.

---

## Part 1: 20 features to improve

### Priority overview

| # | Improvement | Area | Impact | Effort |
|---|---|---|---|---|
| 1 | Transfer progress hot path | Transfers | High | M |
| 2 | Crash-safe stores and migrations | Persistence | High | M |
| 3 | Reachability: fixed port, UPnP/NAT-PMP, branch role | Network | High | M |
| 4 | Server protocol compliance (codes 160, 121) | Network | High | S |
| 5 | Wanted scheduling that scales | Wanted | High | M |
| 6 | Search query normalization and fallbacks | Search | High | S–M |
| 7 | One source of truth for ranking and normalization | Matching | High | M |
| 8 | Duration-aware Tracklist Confidence and edition choice | Matching | High | M |
| 9 | MBID-first Archive ownership | Archive | Medium | S–M |
| 10 | Search results: virtualization and advanced filters | Search UI | High | M |
| 11 | Upload fairness and policy | Sharing | Medium | M |
| 12 | Rich, incremental local share index | Sharing | Medium | M |
| 13 | MusicBrainz client hardening and persistent cache | Metadata | Medium | S–M |
| 14 | Unified settings store | Settings | Medium | M |
| 15 | Logging, rotation, and diagnostics export | Ops | Medium | S |
| 16 | Break up the connection actor | Architecture | High (long-term) | L |
| 17 | Frontend shell: routing, code-splitting, CSS | Architecture | Medium | M–L |
| 18 | Smarter retries and opt-in automatic failover | Transfers | Medium | M |
| 19 | Update cadence, channels, and code signing | Distribution | Medium | S–M |
| 20 | Soundcheck: from structural to sonic verification | Quality | High | M |

---

### 1. Transfer progress hot path - DONE

**Implemented in 0.0.54 (2026-10-23):** active-transfer telemetry is held in
memory and published in small, ordered batches at most every 250 ms. State
changes and five-second progress checkpoints go through one coalescing
background writer. Safe Passage and idle-window close await saves and surface
failures; resume still uses `.part` length. Regression coverage includes six
lanes with 10,000 historical entries, stale events/attempts, writer failures,
and listener cleanup. The original findings and proposal follow for context.
Atomic replacement, corruption recovery, and migrations remain item 2.

**Today:** `receive_file` reports progress every 250 ms
([service.rs:3917](src-tauri/src/connection/service.rs:3917)). That calls
`TransferHub::update_progress`
([downloads.rs:1572](src-tauri/src/connection/downloads.rs:1572)), which goes
through `mutate` → `persist_and_publish`. Each call re-serializes the **entire**
transfer list (completed history included) as pretty JSON, writes it
synchronously with `fs::write`
([downloads.rs:1805](src-tauri/src/connection/downloads.rs:1805)), and emits the
**full** queue snapshot over IPC. With six download lanes, that is about 24
full-file rewrites and 24 full-snapshot React re-renders per second, all done on
async worker threads. The cost grows with history size.

**How to improve:**
- Split durable state (status, release metadata, verification) from volatile
  telemetry (bytes, speed, ETA). Keep telemetry in an in-memory map.
- Persist only on state transitions, plus a debounced checkpoint every 5–10 s
  while downloading. Resume correctness already comes from the `.part` file
  length, not from the JSON.
- Emit a small batched `forever://transfer-progress` event
  (`[{id, transferredBytes, speed, eta}]`) at about 4 Hz. Send full snapshots
  only on structural changes.
- Route writes through one coalescing writer task, or `spawn_blocking`, so disk
  I/O never blocks the tokio executor.

### 2. Crash-safe stores and migrations - DONE

**Implemented in 0.0.55 (2026-10-23):** all seven JSON stores share synced,
atomic replacement with a rotating validated backup. Corrupt data is preserved
in uniquely named quarantine files before backup/default recovery; startup
notices explain the outcome. Explicit migrations cover legacy store versions
and previously unversioned connection settings. Unsupported versions and I/O
failures preserve files and block writes for the affected store. Tests cover
migration fixtures, abrupt process exit at save boundaries, corruption,
concurrency, failed writes, and notice interaction. Power-loss guarantees still
depend on filesystem/device flush behavior. SQLite and WebView localStorage
migration remain outside this item. The original findings follow for context.

**Today:** Every store is overwritten in place with `fs::write`. This covers
`transfers.json`, `wanted.json`, `people.json`, `messages.json`, `rooms.json`,
`sharing.json`, and `connection.json` (for example
[messages.rs:515](src-tauri/src/connection/messages.rs:515),
[settings.rs:120](src-tauri/src/connection/settings.rs:120)). A crash or power
loss mid-write leaves a truncated file. On the next launch, `TransferHub::new`
(and the other hubs) return an error. `connection::initialize` then fails inside
`setup`, and [lib.rs:118](src-tauri/src/lib.rs:118) panics with `expect`, so
**the app will not start**. Separately, a `version != STORE_VERSION` mismatch is
a hard error with no migration path
([wanted.rs:1265](src-tauri/src/connection/wanted.rs:1265)).

**How to improve:**
- Use atomic replacement: write `name.json.tmp`, `sync_all()`, then `rename`
  over the original. Keep one rotating `name.json.bak`.
- On parse failure, quarantine the file (`name.json.corrupt-<ts>`), load the
  backup or start empty, and show a non-blocking notice. Never fail startup.
- Add explicit `migrate_vN_to_vN+1` functions per store, with fixture tests.
- Longer term, consider moving these stores into one `forever.sqlite3` in WAL
  mode. `rusqlite` with `bundled` is already a dependency, and SQLite also
  solves #1 (row-level updates instead of whole-file rewrites).

### 3. Reachability: fixed port, UPnP/NAT-PMP, and a branch role - DONE

**Implemented in 0.0.56 (2026-10-23):** persisted port 2234 with bounded
fallback; automatic UPnP IGD, PCP, and NAT-PMP leases with renewal, external-port
announcement, retry, and serialized cleanup; direct-connection evidence and
an explicit port test in Settings. Reachable, stable clients can relay to up to
four distributed children within server speed limits. Child queues, writes,
duplicate/rate guards, topology propagation, and resets are bounded. Connection
profiles migrate to schema 2. Tests cover local socket exchange, lifecycle
failures, migration, and UI controls. Real router/firewall and public-network
interoperation remain environment-dependent; the checker is HTTP-only and
cannot establish reachability without an observed incoming connection. The
original findings follow for context.

**Today:** Each session binds a random port, `TcpListener::bind(("0.0.0.0", 0))`
([service.rs:1885](src-tauri/src/connection/service.rs:1885)). Nothing maps that
port on the router, so most home users are unreachable for direct connections
and rely on indirect (pierce-firewall) attempts. Those fail when both sides are
behind NAT, which costs search responses, browse requests, and download
starts. Forever also always announces `accept_children = false`
([service.rs:1615](src-tauri/src/connection/service.rs:1615)), so it never helps
relay distributed searches.

**How to improve:**
- Add a configurable fixed listen port (default in the classic 2234–2240 range,
  with fallback).
- Map the port automatically with **UPnP IGD** (`igd-next`) and
  **NAT-PMP/PCP** (`crab_nat` or `port-control-client`). Renew leases, and
  delete the mapping on shutdown.
- Add a **reachability test** in Settings ("Direct connections: reachable /
  firewalled / unknown"), backed by the outcome of incoming connections.
- When the client is reachable and stable, accept distributed children so
  Forever contributes to the network rather than only consuming it.

### 4. Server protocol compliance (codes 160 and 121) - DONE

**Implemented in 0.0.57 (2026-10-23):** bounded code-160 parsing updates one
shared exclusion set. Case-insensitive full-path filtering covers server and
distributed search replies, queued replies at send time, browse lists, and
folder responses; excluded files do not consume the search-result limit.
Malformed updates preserve the last valid list. Successful uploads report code
121 using only bytes sent during that attempt and await the downloader's closing
confirmation. Cancelled, failed, and zero-byte attempts produce no speed sample;
reports are scoped to the originating server session. Wire-format and local
stream tests cover these paths. Public Soulseek interoperability has not been
verified live. The original findings and proposal follow for context.

**Today:** The client does not handle **ExcludedSearchPhrases (160)**. The server
sends this list of phrases, and Nicotine+'s protocol documentation states that
file paths containing them should be left out of search responses. Forever's
outgoing responses (`local_shares` search and the distributed relay) never
filter them. The client also never sends **SendUploadSpeed (121)** after an
upload, so the server's speed statistics for Forever users stay stale. Other
clients use that speed to rank Forever users as sources.

**How to improve:**
- Parse code 160 into a shared `ExcludedPhrases` set and apply it in
  `answer_search_request`, distributed responses, and folder/browse responses.
- After each finished upload, send code 121 with the measured average speed.
- Add protocol tests for both, using the existing frame-builder pattern in
  `protocol.rs`.

### 5. Wanted scheduling that scales - DONE

**Implemented in 0.0.58 (2026-10-23):** automatic checks use WishlistSearch (103)
at the server's WishlistInterval (104), with unknown/zero intervals disabling
background sends. One shared five-second governor prioritizes user searches
(including manual Wanted), Relay, Radar, then automatic Wanted; queued response
windows begin at dispatch and cancellation/replacement invalidates pending work.
Wanted schema 3 persists empty-check backoff (1 h -> 6 h -> 24 h), resets on found
sources, and selects the oldest due watch. UI cadence estimates account for
active list size and server pacing. A 500-album list at a 12-minute server
interval takes about 100 hours per rotation: wishlist support respects network
capacity rather than making that sweep faster. Regression coverage includes
mixed producers, queue cancellation, 500 albums, interval changes/reconnects,
backoff, migration, and UI state. Public Soulseek interoperation remains unverified.
The original findings and proposal follow for context.

**Today:** Wanted checks run one at a time. Each check is a 15 s search followed
by a 5 s cooldown ([wanted.rs:13-19](src-tauri/src/connection/wanted.rs:13)),
and `start_due` picks the album least recently checked. The store allows **500**
albums, but a full sweep then takes about 500 × 20 s ≈ **2.8 hours**. Once a
list grows past roughly 45–180 albums, the 15-, 30-, and 60-minute settings
cannot be met, and the UI's "next check" promise drifts. Wanted, Shelf Radar, Signal Relay, and user searches each throttle
themselves independently. No global search budget exists, which matters on a
network whose server can throttle or ban clients that search too aggressively.

**How to improve:**
- Use the protocol's **WishlistSearch (103)** for background checks, at the
  **WishlistInterval (104)** the server announces (usually 12 min; 2 min for
  privileged users). This is the server's intended mechanism for exactly this
  feature.
- Use an adaptive schedule: albums found recently, or newly added, are checked
  often; albums never seen back off exponentially (1 h → 6 h → 24 h).
- Add one **global search governor** that all search producers share, with
  priority lanes (user > relay > radar > wanted).
- Show the honest effective cadence in the UI ("≈ every 2 h at current list
  size").

### 6. Search query normalization and fallbacks - DONE

**Implemented in 0.0.59 (2026-10-23):** Wanted, Radar, Relay, and album handoff
share a Rust builder with accent/punctuation folding, conservative edition
suffix stripping, short-word reduction with an all-short-name escape, and a
200-byte cap. Empty attempts advance through up to three distinct queries;
broader variants require the artist in the returned path. Fresh tokens, full
response windows at dispatch, cancellation, and the existing priority/wishlist
budget apply to retries. A bounded eighth JSON store remembers successful
variants across producers and restarts. New transfers retain structured album
identity; schema-3 migration leaves old unstructured folders as normalization-only
Relay searches. Tests cover the builder, history/recovery, runtime transitions,
wishlist pacing, IPC handoff, stale replies, and transfer migration. An empty
automatic album may consume three server slots; public-network recall has not
been measured. Ranking consolidation remains item 7. Original findings follow.

**Today:** Background and handoff searches send raw strings such as
`format!("{} {}", album.artist, album.title)`
([wanted.rs:673](src-tauri/src/connection/wanted.rs:673)). Soulseek matching is
word-based. Punctuation, diacritics, very common words, and edition suffixes like
`(Deluxe Edition)`, `[Remastered 2011]`, or `Vol. 2` often reduce results to
zero. Titles such as "…And Justice for All", "Sgt. Pepper's", or "Björk"
illustrate the problem.

**How to improve:**
- Build one Rust query builder used by Wanted, Radar, Relay, and album handoff.
  It should strip edition and remaster suffixes, fold diacritics, normalize `&`
  and `and`, drop words of one or two characters, and cap the length.
- Add **fallback variants** when a search returns zero results: try album title
  alone with an artist post-filter, then artist plus distinctive title words.
- Record which variant succeeded and reuse it for that album.

### 7. One source of truth for ranking and normalization - DONE

**Implemented in 0.0.60 (2026-10-23):** one portable Rust crate owns scoring,
format/bitrate eligibility, stable ties, Tracklist Confidence, and Unicode title
normalization. Desktop commands and the local browser/test bridge call it;
TypeScript scoring and normalization copies are removed. Wanted loads official
titles for background checks (45-second metadata deadline), labels unavailable
metadata as track-count fallback, and deduplicates repeated files. Archive and
album queries share NFKD/ampersand folding. Shared fixtures and actual Rust-backed
frontend flows verify the contract; async identity guards reject stale replies.
Review can still differ when peers return different files or metadata becomes
available later. Duration matching and edition selection remain item 8. The
original findings follow for context.

**Today:** Smart Match logic exists twice. Rust has `source_score`, `format_rank`,
and `is_lossless` ([wanted.rs:977](src-tauri/src/connection/wanted.rs:977)).
TypeScript has `rankAlbumSources` and `formatRank`
([smartMatches.ts:51](src/utils/smartMatches.ts:51)). The two have already
diverged: the TypeScript score includes Tracklist Confidence and the Rust score
does not. The Wanted list's background "best source" can therefore disagree with
the review dialog. Normalization has also drifted. Rust's `normalize_title`
([archive.rs:246](src-tauri/src/archive.rs:246)) does not fold diacritics or map
`&` to "and", while TypeScript's `normalizeWords`
([tracklistConfidence.ts:42](src/utils/tracklistConfidence.ts:42)) does both.
"Björk" and "Bjork", or "Simon & Garfunkel" and "Simon and Garfunkel", can
match in one place and fail in another.

**How to improve:**
- Make Rust the single authority. Expose `rank_album_sources` and
  `normalize_title` as commands (or return ranked results inside events), and
  delete the TypeScript copies.
- If both copies must stay, add a shared golden-fixture file
  (`fixtures/matching.json`) that both `cargo test` and Vitest run against.
- Use `unicode-normalization` (NFKD plus mark stripping) in Rust so behavior
  matches the frontend.

### 8. Duration-aware Tracklist Confidence and edition choice - DONE

**Implemented in 0.0.61 (2026-10-23):** shared Rust matching compares track
lengths within a three-second window, distinguishes unknown lengths, rejects
known mismatches for recommendations, and breaks equal scores with album
duration agreement. Review and profiles offer official MusicBrainz editions
with bounded pagination and explicit truncation; Wanted schema 4 persists the
selection and invalidates old recommendations. Numbered disc siblings form one
source, all advertised discs are inspected, and local disc paths are preserved.
Regression coverage spans the shared matcher, metadata validation, persistence,
disc grouping/inspection, and rendered review. Duration metadata cannot prove
audio identity or distinguish pressings with equal titles/lengths. Unadvertised
discs and public Soulseek peer behavior remain limits. Original findings follow.


**Today:** MusicBrainz track lengths are fetched
([musicbrainz.rs:470](src-tauri/src/musicbrainz.rs:470)), and Soulseek results
carry `durationSeconds`, but Tracklist Confidence compares **titles only**. The
tracklist used is always the "earliest official" edition. The README lists
edition/pressing lookup as out of scope.

**How to improve:**
- Add a duration signal per matched track (|Δ| ≤ 2–3 s is a strong match). This
  separates studio from live versions, catches remasters with different
  lengths, and flags truncated files before download.
- Score album-level duration agreement as a tie-breaker in the ranking.
- Let the user choose the edition (original, deluxe, remaster, or region)
  from the release list in the review dialog. Remember that choice per Wanted
  album.
- Handle multi-disc folder layouts (`CD1/`, `Disc 2/`) as one source.

### 9. MBID-first Archive ownership - DONE

**Implemented in 0.0.62 (2026-10-23):** saved include decisions linked to live
local albums and verified artist identities supply MBID-first ownership; cached
catalogs alone never imply ownership. Unicode title fallback remains available
for older/unlinked catalogs, with original-year and stable-ID ties. Badges and
shelf rows expose the reason. Library source offers a validated file picker,
automatic-location badge/reset, durable recoverable settings, and stale-response
invalidation across discovery, Wanted, transfers, and Missing Shelf. Tests cover
identity conflicts, missing/untrusted links, read-only integrity, source settings,
and frontend interaction/races. MBID coverage depends on saved links in Music
Library; this does not establish ownership of a particular pressing. Original
findings follow for context.

**Today:** The Archive path is hard-coded to
`%APPDATA%\com.local.musiclibrary\music-library.sqlite3`
([archive.rs:11](src-tauri/src/archive.rs:11)). Ownership is matched by a
normalized title plus year and track-count heuristics, even though the external
database already exposes `musicbrainz_artist_links` and
`musicbrainz_artist_release_groups`.

**How to improve:**
- Match on release-group MBID first when it is available, and fall back to the
  normalized title.
- Make the database path configurable, with a file picker and a "detected
  automatically" badge.
- Add the shared diacritic-aware normalization from #7.
- Show *why* an album is marked Owned (MBID match vs. title match) to build
  trust and make false positives easy to diagnose.

### 10. Search results: virtualization and advanced filters

**Today:** A search can hold up to 5,000 results, and they render without
virtualization. Each 200-result batch appends to state and re-groups album
sources. The only filters are All, Lossless, and Compressed
([SearchWorkspace.tsx:268](src/components/SearchWorkspace.tsx:268)), and there
are four sorts.

**How to improve:**
- Virtualize the files table and album-source list with **TanStack Virtual**.
- Add advanced filters: minimum bitrate, sample rate and bit depth (hi-res),
  free slot only, maximum queue length, size range, extension, excluded words,
  and country.
- Make column headers sortable, and persist the filter state per Dial Memory
  preset (the persistence pattern already exists).
- Add a quick "hide users I've banned or ignored" toggle, and a
  "results per user" cap to collapse spammy sources.

### 11. Upload fairness and policy

**Today:** Uploads use one global FIFO queue. `activate_next` takes the first
`Queued` item ([uploads.rs:229](src-tauri/src/connection/uploads.rs:229)), with a
cap of 500 items and no per-user limits, so one user queuing 500 files
monopolizes every slot. The upload queue is not persisted. A restart silently
drops everyone's position.

**How to improve:**
- Use **round-robin per user**, so each user gets one active slot before anyone
  gets a second.
- Add per-user limits (files and MB). Reject over-limit requests with the
  standard `UploadDenied` reasons ("Too many files" / "Too many megabytes").
- Add optional priority tiers: favorites or buddies first, and privileged users
  (server code 69) first.
- Persist the queued uploads so positions survive restarts.

### 12. Rich, incremental local share index

**Today:** Indexed shared files report `bitrate: None` and
`duration_seconds: None` ([local_shares.rs:94](src-tauri/src/connection/local_shares.rs:94)).
Other users therefore see no quality information for Forever's shares, and
Forever ranks lower in their filters. The index is rebuilt in full on each
scan, and nothing watches the shared folders for changes.

**How to improve:**
- During indexing, read audio headers with **symphonia** (already a dependency
  for Soundcheck) and publish bitrate, duration, sample rate, and bit depth
  attributes.
- Persist the index keyed by `(path, size, mtime)` so rescans are incremental.
- Add a file watcher (the `notify` crate) with debounced partial rescans.

### 13. MusicBrainz client hardening and persistent cache

**Today:** The User-Agent is a hard-coded string, `"Forever/0.0.53 (…)"`
([musicbrainz.rs:11](src-tauri/src/musicbrainz.rs:11)). Every release has to bump
it by hand; the changelog notes this repeatedly. Caches are in memory only, with
a 6-hour TTL, so each launch re-queries MusicBrainz. Errors are flattened to
strings, with no `503`/`Retry-After` backoff.

**How to improve:**
- Build the User-Agent with
  `concat!("Forever/", env!("CARGO_PKG_VERSION"), " (https://github.com/soundtrackgeek/forever)")`.
- Add a persistent SQLite cache with per-entity TTLs. Artist and release-group
  data can be kept for days, and tracklists can be cached essentially forever,
  keyed by release MBID.
- Honor `503` and `Retry-After` with exponential backoff, and surface a clear
  "MusicBrainz is rate-limiting; retrying in N s" state.

### 14. Unified settings store

**Today:** Settings live in at least six places. These are `connection.json`,
`transfers.json` (lanes, relay delay, Soundcheck), `sharing.json`,
`wanted.json`, and **WebView `localStorage`**: update cadence, message and room
notification toggles, the MusicBrainz fallback count, drafts, and Dial Memory.
`localStorage` can be cleared independently of the app data, and none of this
can be exported, backed up, or moved to another PC.

**How to improve:**
- Use one typed `Settings` struct in Rust, versioned and migrated (see #2), and
  expose it through `settings_get` and `settings_patch` commands.
- Move the remaining `localStorage` preferences into it. Drafts and UI layout
  can stay in the WebView.
- Add **Export / Import settings** and a "Reset section to defaults" control.

### 15. Logging, rotation, and diagnostics export

**Today:** `logs/connection.log` is opened in append mode on every record and
never rotated
([diagnostics.rs:80](src-tauri/src/connection/diagnostics.rs:80)), so it grows
without bound. No panic hook or crash capture exists, which hurt during the
0.0.16 startup regression.

**How to improve:**
- Adopt `tracing` with `tracing-appender` daily rotation (or
  `tauri-plugin-log`), keeping 7 files.
- Install a panic hook that writes a sanitized crash report.
- Add an **Export diagnostics** button that zips logs, versions, and settings,
  with credentials and IPs stripped, for bug reports.
- Optional and opt-in: crash reporting with `tauri-plugin-sentry` (see Part 3).

### 16. Break up the connection actor

**Today:** `connect_once` spans about 870 lines
([service.rs:1815](src-tauri/src/connection/service.rs:1815)). One
`tokio::select!` handles five timers, every server message, commands, and
distributed events. `ConnectionManager` owns 14 hubs, and `service.rs` is 4,288
lines. A 1 s `download_retry_tick` polls the scheduler
([service.rs:1989](src-tauri/src/connection/service.rs:1989)). Each new protocol
feature makes this loop harder to reason about and test.

**How to improve:**
- Introduce a server-message dispatcher (`code → handler`). Each hub implements
  a small trait (`on_server_frame`, `on_connected`, `on_disconnected`), which
  removes the long `connection_lost()` fan-out in `run_connection_loop`.
- Move timers into the hubs that own them, and make download scheduling
  event-driven (on enqueue, completion, or slot release) instead of a 1 s tick.
- Add `cargo-fuzz` targets for `parse_*` functions in `protocol.rs`. The bounded
  parsers are a natural fit for fuzzing.

### 17. Frontend shell: routing, code-splitting, and CSS

**Today:** `App.tsx` switches views with a long nested ternary and owns most
cross-feature state, passed down as props. All of the CSS is in one
14,107-line `App.css`. No view is lazy-loaded. A stale `PlaceholderView` still
reads "Home discovery will arrive after the first search-and-download release."

**How to improve:**
- Use a view registry (`{id, component, icon}`) with `React.lazy` and
  `Suspense` per workspace.
- Split CSS per workspace (co-located files or CSS Modules) on top of a shared
  token file for the Midnight Radio palette, spacing, and radii.
- Move cross-cutting state (connection, transfers, wanted) into a small store
  (Zustand or React context with selectors) to cut prop drilling and re-renders.
- Remove dead placeholder copy and views.

### 18. Smarter retries and opt-in automatic failover

**Today:** Automatic retries stop after three attempts
(`MAX_AUTOMATIC_RETRIES = 3`). Signal Relay always requires manual approval,
even for exact basename-and-size mirrors, which the code already treats as safe.
Users who repeatedly fail or deny uploads are not remembered.

**How to improve:**
- Add an opt-in "**Auto-switch to exact mirrors**" after N minutes stalled.
  Mismatched replacements keep the existing approval flow.
- Keep per-user reliability memory (success rate, typical start delay,
  denials), and use it in ranking and as a "flaky source" badge.
- Smooth speed and ETA with an EMA. The current 250 ms window is noisy.
  Whole-album ETA should account for source-queue position.

### 19. Update cadence, channels, and code signing

**Today:** Automatic update checks run **every 5 minutes** by default. Installers
are not Authenticode-signed, so SmartScreen warns on download (as the README
notes). There is a single release channel.

**How to improve:**
- Default to checking at launch and then every 6 hours. Five minutes is far more
  often than releases need.
- Add **Stable** and **Beta** channels (two `latest.json` endpoints), so
  experimental features can ship without risking everyone's startup.
- Sign builds through **Azure Artifact Signing** or the **SignPath Foundation**
  OSS program. Both work with Tauri's `bundle.windows.signCommand`. See Part 3
  for eligibility notes; SignPath requires an OSI license, and the repository
  currently has **no LICENSE file**.

### 20. Soundcheck: from structural to sonic verification

**Today:** Quick Soundcheck reads container and codec facts. Deep Scan decodes
with symphonia's `verify(true)`, which checks embedded FLAC MD5s. Neither
detects **lossy-to-lossless transcodes** ("fake FLAC") or upsampled "hi-res",
which are a common Soulseek problem.

**How to improve:**
- Add spectral analysis with `rustfft`: cutoff frequency, energy above the
  cutoff, consistency across the track, and the classic 16 kHz / 19 kHz
  shelves. Report **Likely genuine / Suspect transcode (≈ MP3 320) / Likely
  upsampled**.
- Add a **spectrogram view** to the Arrival Desk evidence panel.
- Detect padded bit depth (24-bit containers holding 16-bit content) and
  clipping.
- Feed the verdict into Patch Bay ("replace transcoded tracks") and into
  per-user reliability (#18).
- Several open-source Rust implementations are good references (Part 3).

---

## Part 2: 20 features worth adding

### Priority overview

| # | Feature | Theme | Impact | Effort |
|---|---|---|---|---|
| 1 | Built-in player and preview | Listening | High | M |
| 2 | Tagging and filing pipeline | Library | High | M–L |
| 3 | AcoustID fingerprint verification | Quality | High | M |
| 4 | Rip-log, AccurateRip, and CTDB verification | Quality | Medium | M |
| 5 | Artist Follow and New Release Radar | Discovery | High | M |
| 6 | Similar-artist discovery shelf | Discovery | Medium | M |
| 7 | Import Wanted from external sources | Wanted | High | M |
| 8 | Library providers beyond Music Library | Archive | High | L |
| 9 | Bandwidth limits and scheduling | Transfers | Medium | S–M |
| 10 | Tray, background mode, autostart, and single instance | Shell | High | S |
| 11 | Remote push notifications | Alerts | Medium | S |
| 12 | Command palette and global keyboard map | UX | Medium | S–M |
| 13 | Lyrics fetching (LRCLIB) | Library | Low–Medium | S |
| 14 | Own profile editor and interests | Social | Medium | S |
| 15 | User and room network search | Search | Medium | S–M |
| 16 | Buddy shares and trust tiers | Sharing | Medium | M |
| 17 | Upgrade Shelf for lossy-owned albums | Archive | High | M |
| 18 | Statistics and insights dashboard | Insight | Low–Medium | M |
| 19 | macOS and Linux builds | Platform | High (reach) | M–L |
| 20 | Local automation API and `slsk://` deep links | Integration | Medium | M |

---

### 1. Built-in player and preview

The design QA notes say the original concept had a player transport that was
deferred. A compact player in the transfer shelf would let users preview
completed, and even partially downloaded, tracks without leaving the app. That
makes it easy to judge a rip before filing it.

**How:** Play local files through Tauri's asset protocol with an `<audio>`
element for common formats. For FLAC, ALAC, or gapless playback, decode with
symphonia and output through `cpal`/`rodio` from Rust. Add queue-from-album,
waveform scrubbing, and "play from Arrival Desk".

### 2. Tagging and filing pipeline

Forever already knows the MusicBrainz release group and tracklist for many
downloads. Writing that into the files closes the loop from search to finished
library.

**How:** Use **lofty** to write tags (artist, album, track and disc numbers,
date, MusicBrainz IDs) and embed Cover Art Archive artwork. Add configurable
**naming templates** (`{albumartist}/{year} - {album}/{disc}{track:02} {title}`)
and a separate **incomplete folder**. Add a "File into library" action on the
Arrival Desk that moves the album into a chosen root, plus an optional
`beet import` hand-off. Every step should have a preview and an undo, matching
the app's safety-first tone.

### 3. AcoustID fingerprint verification

Filenames can lie. Fingerprints identify the actual recording, which turns
Tracklist Confidence from "titles look right" into "audio is right".

**How:** Compute Chromaprint fingerprints with **chromaprint-next** (pure Rust,
bit-identical to the C library), look them up through the **AcoustID** web
service, and compare the returned recording MBIDs to the expected tracklist.
Surface the result as a Soundcheck line: "11/12 tracks acoustically confirmed".

### 4. Rip-log, AccurateRip, and CTDB verification

Lossless collectors value EAC/XLD logs and AccurateRip confidence. Forever
already preserves `.log` and `.cue` companion files, so it can verify them.

**How:** Parse EAC/XLD logs (log score, read mode, test and copy CRC match).
Rebuild the TOC from track lengths and query **AccurateRip** and the **CUETools
Database (CTDB)** in the way `cdverify` does. Show "AccurateRip ✓ (conf 12)" in
the Arrival Desk and Smart Match review, and rank verified rips higher.

### 5. Artist Follow and New Release Radar

Today, Wanted albums must be chosen one by one. A follow list would
automatically surface new releases from artists the user cares about,
including artists inferred from the Archive.

**How:** Poll MusicBrainz release groups for followed artists, or use
**ListenBrainz** `GET /1/explore/fresh-releases/` and the per-user
`/fresh_releases` endpoint, at a daily cadence. New items appear in the
Listening Post with **Add to Wanted** (or "auto-add with my default Smart Match
profile").

### 6. Similar-artist discovery shelf

The Missing Shelf answers "what am I missing from artists I own?". A discovery
shelf would answer "which artists should I own?".

**How:** Use **Last.fm** `artist.getSimilar` (no user auth needed) or
ListenBrainz similarity data, seeded from the most-owned Archive artists. Drop
artists already owned and show a ranked shelf with each artist's key albums
and Smart Match hand-off. Soulseek's own **Recommendations (54)** and
**SimilarUsers (110)** server messages can add a network-native angle.

### 7. Import Wanted from external sources

Many users already keep want lists elsewhere.

**How:** Add importers for:
- **Lidarr** wanted/missing (REST API, using the pattern Soularr has proven)
- **Discogs** wantlist (60 req/min with a personal token)
- **Last.fm** and **ListenBrainz** top albums
- Plain **CSV**
- Spotify playlist exports from CSV export tools. Avoid the Spotify Web API
  directly; see Part 3.

All of these resolve to MusicBrainz release groups before calling the existing
`wanted_add_many`.

### 8. Library providers beyond Music Library

Ownership currently depends on one specific external app's database. A
provider abstraction would make Archive features (Owned badges, Missing Shelf,
Fulfilled) work for most collectors.

**How:** Define a `LibraryProvider` trait (`status`, `artists`, `albums_for`,
`owns`). Implement it for the current Music Library database, a **plain folder
scan** (tags read with lofty and cached in SQLite), a **beets** database
(read-only), and **Navidrome/OpenSubsonic** (`getArtists`, `getAlbum`, and
`search3`; `startScan` after filing). A Jellyfin provider can come later.

### 9. Bandwidth limits and scheduling

The app has no speed limits for either direction, which matters on shared or
metered home connections.

**How:** Use a token-bucket limiter shared by `receive_file` and `send_file`,
with global and per-direction limits. Add an "alternate limits" schedule (for
example, unlimited at night) and a pause-on-metered-network toggle. The
existing 128 KB buffer loop makes this a contained change.

### 10. Tray, background mode, autostart, and single instance

Wanted Signals only works while Forever runs. Today, closing the window ends
everything, and launching twice can start two clients that fight over the same
account (code 41, Relogged).

**How:** Add a Tauri tray icon with live status, Pause all, and Open. Add
**minimize-to-tray** on close (Safe Passage still applies on a true exit).
Add the official `tauri-plugin-single-instance` (with the `deep-link` feature,
see #20), `tauri-plugin-autostart`, and `tauri-plugin-window-state`.

### 11. Remote push notifications

Albums often appear on the network while the user is away from the computer.

**How:** Add optional outbound webhooks with **ntfy** (a simple HTTP POST to a
topic, self-hostable), Discord webhooks, and Pushover. Use per-event toggles:
Wanted match found, release complete, Soundcheck failed, and private message.
Send no personal data beyond what the user opts into.

### 12. Command palette and global keyboard map

The app has eight workspaces plus Settings, but only a handful of shortcuts
(Dial Memory).

**How:** Add **Ctrl+K** with `cmdk`: jump to a view, search an artist in Albums,
open a user's shares or profile, run "Pause all", or open a recent release.
Add a documented shortcut sheet (`?`) and consistent list navigation with
arrow keys, Enter, and Space.

### 13. Lyrics fetching (LRCLIB)

Forever already treats lyrics as valued companion files.

**How:** After completion, query **LRCLIB** `GET /api/get` with artist, title,
album, and duration (no API key). Save synced `.lrc` files beside the tracks
when they are missing. Show the lyrics in the player (#1). Cache responses, and
honor `429` with `Retry-After`.

### 14. Own profile editor and interests

Forever always answers profile requests with the fixed text "Sharing music with
Forever." and no picture
([service.rs:3565](src-tauri/src/connection/service.rs:3565)).

**How:** Add a profile editor (description, picture, "only share with
buddies" note). Use **AddThingILike / RemoveThingILike (51/52)** for interests,
which also unlocks the server's recommendations (feature #6).

### 15. User and room network search

Soulseek supports **UserSearch (42)**, which searches one user's shares on the
network without downloading their whole list, and **RoomSearch (120)**. Neither
is exposed today.

**How:** Add "Search this user" in People, Browse, and Search results, and
"Search this room" in Open Frequency. Results flow into a normal Dial Memory
preset, so all the album grouping and ranking applies unchanged.

### 16. Buddy shares and trust tiers

Many users want to share more with trusted people than with everyone.

**How:** Allow shared roots to be marked **Public / Buddies only / Hidden**.
Favorites become "buddies", and buddy-only folders are omitted from public
browse and search responses. Combine this with upload priority tiers
(improvement #11).

### 17. Upgrade Shelf for lossy-owned albums

Collectors often own albums only as MP3 and want lossless versions. The Archive
and Wanted machinery can already do most of this.

**How:** Query the library provider for albums whose tracks are lossy or below
a chosen bitrate. Show them as an **Upgrade Shelf**, and hand them to Wanted
with a `losslessOnly` profile and an "upgrade" flag. That flag keeps the album
watched even though the Archive says it is owned (the `watchDespiteOwnership`
field already exists).

### 18. Statistics and insights dashboard

**What:** Downloaded and uploaded totals, a share ratio, top sources and their
reliability, Wanted hit rate and time-to-find, Soundcheck pass rate, collection
completion over time, and network reachability history.

**How:** Record compact daily aggregates in SQLite (this pairs with
improvement #2), and render small charts in a new Listening Post tab.

### 19. macOS and Linux builds

The protocol, matching, and UI layers are cross-platform. The Windows-specific
pieces are the taskbar overlay badge, the `%APPDATA%` Archive path, and the
release pipeline. `keyring` already supports macOS Keychain and the Linux
Secret Service.

**How:** Gate the overlay badge behind `cfg(windows)` (use the dock badge on
macOS), make the library path configurable (improvement #9), and add
`macos-latest` and `ubuntu-latest` jobs to the release workflow with
`tauri-action`. This would compete directly with Nicotine+ on every platform.

### 20. Local automation API and `slsk://` deep links

Power users want to script Forever. Examples: "add this album to Wanted" from a
browser extension, a Stream Deck button, or Lidarr-style automation like
Soularr does with slskd.

**How:** Add an opt-in localhost-only HTTP/WebSocket API with a token, mirroring
the existing Tauri commands (search, enqueue, wanted, transfers). Register the
`slsk://` URL scheme with `tauri-plugin-deep-link` so links like
`slsk://user/path` open Browse or Download directly. On Windows this relies on
the single-instance plugin from #10.

---

## Part 3: Online services, APIs, and libraries

Findings were checked against current sources in October 2026. **Top picks**
come first, followed by the full catalogue and some cautions.

### Top picks (highest value for the effort)

| Pick | Why | Used by |
|---|---|---|
| **Nicotine+ Soulseek protocol docs** | The best public spec for codes 103/104 (Wishlist), 160 (Excluded Phrases), 121 (Upload Speed), 42/120 (User/Room search), 51/52/54/110 (Interests/Recommendations), and obfuscation fields | Improvements #4, #5; Features #6, #14, #15 |
| **igd-next** + **crab_nat** (Rust) | UPnP IGD plus NAT-PMP/PCP port mapping on tokio. The biggest single gain in peer reachability | Improvement #3 |
| **chromaprint-next** + **AcoustID** | Pure-Rust Chromaprint, bit-identical to the C library, with built-in compressed base64 output for AcoustID lookups | Feature #3 |
| **lofty** (Rust) | Read and write tags for MP3/FLAC/MP4/Ogg/WAV/AIFF | Features #2, #8 |
| **TanStack Virtual** | Row virtualization for the 5,000-row results table and large share trees | Improvement #10 |
| **ListenBrainz API** | Free, MusicBrainz-native fresh releases and recommendations | Features #5, #6, #7 |
| **Official Tauri plugins** | single-instance, window-state, autostart, deep-link, log, and store, all first-party and maintained | Improvements #14, #15; Features #10, #20 |

### Full catalogue

#### Soulseek ecosystem (reference implementations and patterns)

| Resource | What it offers Forever |
|---|---|
| [Nicotine+ protocol documentation](https://nicotine-plus.org/doc/SLSKPROTOCOL.html) | Message-level reference for unimplemented codes. It notes that WishlistInterval is usually 12 min (2 min for privileged users), and that Nicotine+ itself does not support obfuscated connections, so Forever can skip them too |
| [slskd](https://github.com/slskd/slskd/releases) / Soulseek.NET | Mature headless client (0.26.x in Oct 2026) with a REST API. Useful for comparing behavior on retries, enqueue timeouts, and download destinations |
| [Soularr](https://github.com/mrusse/soularr) | A proven pattern for Lidarr-wanted → Soulseek-search → import automation. Inspiration for Features #7 and #20 |
| [SoulseekQt changelog](https://www.slsknet.org/news/changelog) | Track official-client changes, such as the 2026-04-30 distributed-network fixes, that may affect protocol behavior |

#### Metadata and discovery

| Service | Access | What it offers Forever | Notes |
|---|---|---|---|
| **MusicBrainz** (already used) | Free, ~1 req/s, User-Agent required | Persistent cache, editions, durations | Improvements #8, #13 |
| **Cover Art Archive** (already used) | Free | Use sized thumbnails (`-250`, `-500`, `-1200`) for lists vs. full art for embedding | Lower bandwidth in grids |
| [ListenBrainz](https://listenbrainz.readthedocs.io/en/latest/users/api/misc.html) | Free, HTTPS | `/1/explore/fresh-releases/`, `/1/user/{user}/fresh_releases` (up to 90 days), recommendation playlists | The site-wide 90-day feed is large (~10 MB); prefer per-artist filtering |
| [Last.fm API](https://www.last.fm/api/show/artist.getSimilar) | Free API key | `artist.getSimilar` (with match scores), `artist.getTopAlbums`, `album.getInfo` | Became independent again in 2026; the API is still documented |
| [Discogs API](https://www.discogs.com/forum/thread/997721) | Personal token: 60 req/min per IP; 25/min unauthenticated | Pressing and edition details, tracklists, user wantlist and collection import | Needs a unique User-Agent; cache aggressively |
| [Deezer API](https://developers.deezer.com/api) | No auth for catalog | `cover_xl` artwork, `nb_tracks`, per-track durations, ISRC | A good second opinion when MusicBrainz lacks tracklists or durations |
| [LRCLIB](https://lrclib.net/docs) | Free, no key | Synced and plain lyrics by artist, title, album, and duration | Send a User-Agent, honor 429, cache results |
| [AcoustID](https://acoustid.org/webservice) | Free application key (non-commercial) | Fingerprint → recording MBIDs | Pairs with chromaprint-next |

#### Audio and quality (Rust crates and reference tools)

| Library or tool | Use in Forever |
|---|---|
| [chromaprint-next](https://github.com/attilagyorffy/chromaprint-next) / [rusty-chromaprint](https://crates.io/crates/rusty-chromaprint) | Fingerprints. Prefer chromaprint-next for AcoustID compatibility; rusty-chromaprint is older and only faithful for the default algorithm |
| [lofty](https://docs.rs/lofty) | Tag reading and writing. Note that ID3v2 in FLAC is read-only |
| [ebur128](https://docs.rs/ebur128) | Pure-Rust EBU R128. Compute ReplayGain 2.0 (−18 LUFS reference) during Deep Scan and write the tags with lofty |
| `rustfft` | Spectral transcode detection (Improvement #20) |
| [lossless-checker](https://github.com/NaughtyDogOfSchrodinger/lossless-checker), [flaccheck](https://github.com/dasunNimantha/flaccheck), [FlacCompagnon](https://craft-and-code.github.io/FlacCompagnon/) | Open-source Rust implementations of fake-lossless detection. FlacCompagnon is even a Tauri app, so the approach transfers directly. flaccheck publishes a labeled benchmark |
| [cdverify](https://github.com/neheb/cdverify) | Reference for computing AccurateRip v1/v2 and CTDB lookups from track lengths and cue sheets (Feature #4) |
| [CUETools DB](http://cue.tools/wiki/CUETools_Database) | Rip verification and repair database |
| `symphonia` (already used), `cpal`/`rodio` | Decoding plus audio output for the built-in player |

#### Networking

| Crate | Use |
|---|---|
| [igd-next](https://crates.io/crates/igd-next) (0.17.x) | UPnP IGD discovery and port mapping. You must renew leases yourself |
| [crab_nat](https://github.com/waltmck/crab_nat) | NAT-PMP and PCP on tokio. A common strategy is to try PCP/NAT-PMP first, then UPnP |
| [port-control-client](https://docs.rs/port-control-client) | All-in-one PCP, UPnP v1/v2, and NAT-PMP with automatic renewal and removal |

#### Desktop shell and operations

| Library or service | Use |
|---|---|
| [Tauri official plugins](https://v2.tauri.app/plugin/) | `single-instance` (register first; enable its `deep-link` feature on Windows), `deep-link`, `autostart`, `window-state`, `log`, `store` |
| [tauri-plugin-sentry](https://github.com/timfish/sentry-tauri) | Opt-in crash reporting covering Rust panics, JS errors, and native minidumps. Self-hosted GlitchTip is a privacy-friendly Sentry-compatible backend |
| `tracing` + `tracing-appender` | Structured, rotated logs (Improvement #15) |
| `notify` | File-system watching for shares (Improvement #12) |
| `unicode-normalization` | Diacritic folding in Rust, matching the frontend (Improvement #7) |

#### Frontend

| Library | Use |
|---|---|
| [TanStack Virtual](https://tanstack.com/table/latest/docs/framework/react/guide/virtualization) (+ optionally TanStack Table) | Virtualized results, share trees, and transfer history |
| `cmdk` | Command palette (Feature #12) |
| Zustand | Lightweight cross-workspace state (Improvement #17) |

#### Integrations

| Service | Use | Notes |
|---|---|---|
| **Lidarr API** | Import wanted/missing lists; notify on completion | Soularr shows the full pattern |
| [Navidrome / OpenSubsonic](https://www.navidrome.org/docs/developers/subsonic-api/) | Ownership checks (`getArtists`, `getAlbum`, `search3`) and `startScan` after filing | `startScan` needs an admin account |
| **Jellyfin** | Ownership through the `/Items` API | No native Subsonic API |
| [ntfy](https://docs.ntfy.sh/publish/) | Remote push: one HTTP POST per event, with title, priority, and click-URL headers | Public topics are guessable; recommend a self-hosted server or a random topic name |
| **beets** | Optional post-download import and tagging | Command-line hand-off |

#### Distribution and code signing

| Option | Fit | Notes |
|---|---|---|
| [Azure Artifact Signing](https://v2.tauri.app/distribute/sign/windows/) (formerly Trusted Signing) | Tauri `signCommand` integration is documented | About $9.99/month. **Individuals: USA and Canada only**; organizations: USA, Canada, EU, UK. A Norway-based individual may need an organization or an OV certificate instead |
| [SignPath Foundation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) | Free for open-source projects | Requires an **OSI license** (the repo currently has none), CI-built binaries, manual release approval, and "SignPath Foundation" as the publisher |
| OV certificate | Works anywhere | About $150–300/year. Note that EV certificates no longer bypass SmartScreen; reputation still builds over time |

### Cautions

- **Spotify Web API:** Do not build features on it. Since February/March 2026,
  development-mode apps are limited to 5 users, require the owner to have
  Premium, cap search at 10 results, and lost several endpoint families.
  Extended quota is only for organizations with 250k+ MAU. Prefer CSV-export
  import instead.
- **ListenBrainz site-wide fresh-releases feed:** The 90-day window is about 10
  MB and slow. Query per user or per artist, and cache.
- **Discogs rate limits are per IP.** Background importers must pace themselves
  (about 55 req/min) and cache.
- **Protocol extensions:** The Nicotine+ documentation asks client authors not
  to extend the protocol without Soulseek administrators' approval. Keep
  Forever-only features (such as buddy tiers) client-side and
  protocol-compatible.

---

## Suggested sequencing

1. **Stability sprint (1–2 weeks):** Improvements #2 (crash-safe stores), #1
   (progress hot path), #4 (codes 160/121), #13 (version-derived User-Agent),
   #15 (log rotation), and Feature #10 (single instance and tray).
2. **Network and matching sprint:** Improvements #3 (UPnP/NAT-PMP), #5
   (Wishlist scheduling), #6 (query builder), #7 (single ranking authority),
   and #8 (durations and editions).
3. **Collector-quality sprint:** Improvement #20 (transcode detection), and
   Features #3 (AcoustID), #2 (tagging and filing), and #17 (Upgrade Shelf).
4. **Reach sprint:** Improvement #19 (signing and channels), Feature #19
   (macOS/Linux), and Feature #8 (library providers).
5. **Delight:** Features #1 (player), #5 (New Release Radar), #12 (command
   palette), and #11 (remote push).

---

## Sources

- Nicotine+, *Soulseek Protocol Documentation*: https://nicotine-plus.org/doc/SLSKPROTOCOL.html
- Nicotine+ release notes (code 160 implemented in 3.3.1): https://nicotine-plus.org/NEWS.html
- slskd releases: https://github.com/slskd/slskd/releases
- Soularr: https://github.com/mrusse/soularr · https://soularr.net/
- SoulseekQt changelog: https://www.slsknet.org/news/changelog
- igd-next: https://crates.io/crates/igd-next · crab_nat: https://github.com/waltmck/crab_nat · port-control-client: https://docs.rs/port-control-client/latest/port_control_client/
- chromaprint-next: https://github.com/attilagyorffy/chromaprint-next · rusty-chromaprint: https://crates.io/crates/rusty-chromaprint
- lofty: https://docs.rs/lofty · ebur128: https://docs.rs/ebur128 · loudgain (ReplayGain 2.0 reference): https://github.com/Moonbase59/loudgain
- Fake-lossless references: https://github.com/NaughtyDogOfSchrodinger/lossless-checker · https://github.com/dasunNimantha/flaccheck · https://craft-and-code.github.io/FlacCompagnon/
- CTDB: http://cue.tools/wiki/CUETools_Database · cdverify: https://github.com/neheb/cdverify
- ListenBrainz API: https://listenbrainz.readthedocs.io/en/latest/users/api/misc.html · https://listenbrainz.readthedocs.io/en/latest/users/api/recommendation.html
- Last.fm API: https://www.last.fm/api · https://www.last.fm/api/show/artist.getSimilar
- Discogs rate limits: https://www.discogs.com/forum/thread/997721
- Deezer API: https://developers.deezer.com/api
- LRCLIB: https://lrclib.net/docs
- Tauri plugins: https://v2.tauri.app/plugin/ · Deep linking: https://v2.tauri.app/plugin/deep-linking/
- Tauri Windows signing: https://v2.tauri.app/distribute/sign/windows/
- Microsoft code-signing options: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- tauri-plugin-sentry: https://github.com/timfish/sentry-tauri
- TanStack virtualization guide: https://tanstack.com/table/latest/docs/framework/react/guide/virtualization
- Navidrome Subsonic API compatibility: https://www.navidrome.org/docs/developers/subsonic-api/
- ntfy publishing: https://docs.ntfy.sh/publish/
- Spotify February 2026 migration guide: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- TechCrunch on Spotify dev-mode changes: https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/
