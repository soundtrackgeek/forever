# Midnight Radio design QA

## 0.0.9 — User Shares Explorer

- Approved shell reference: `design/concepts/03-midnight-radio.png`
  (1584 × 992)
- Coordinated shares reference:
  `design/concepts/07-midnight-radio-user-shares.png` (1584 × 992)
- Native implementation capture:
  `design/implementation/release-user-shares-0.0.9.png` (1584 × 992)
- Minimum-window capture:
  `design/implementation/release-user-shares-0.0.9-minimum.png` (1024 × 680)
- Render method: the live Vite application was opened and the complete
  search-result → user shares → selection → transfer handoff was exercised in
  the Codex in-app browser. No console warnings or errors were present.

### Fidelity ledger

1. Layout matched: the persistent navigation rail and transfer shelf frame a
   dedicated three-pane explorer with folder navigation, file table, and user/
   selection inspector in the same hierarchy as the coordinated reference.
2. Palette matched: midnight navy surfaces, indigo hairlines, violet navigation
   and metadata signals, amber folders/checks/primary action, and green online
   state carry directly from the accepted system.
3. Typography matched: the light editorial user heading and compact uppercase
   utility labels, file metadata, path text, and transfer details retain the
   established desktop scale.
4. Component geometry matched: shallow radii, restrained framed controls,
   unboxed table rows, square selection checks, fine dividers, and the circular
   selection summary preserve the reference's dense precision.
5. Interaction hierarchy matched: browse and search remain primary, individual
   files or a whole folder feed a persistent selection, and one amber Download
   selection action hands the exact files to the grouped transfer queue.
6. Responsive behavior passed: at 1024 × 680 the existing navigation rail
   collapses to icons, all three explorer panes remain available, the file table
   gains an intentional horizontal scroll rail, and nothing overlaps the fixed
   transfer shelf.

### Copy and intentional deviations

- The visible reference copy—user shares, Refresh, share search, Folders,
  Format, Quality, Size, Selection, Select folder, and Download selection—is
  preserved or made more explicit without adding promotional copy.
- Reference-only library totals are replaced by counts and bytes returned by
  the actual peer. Private directories remain identifiable but private files
  cannot be selected as if they were publicly downloadable.
- The coordinated concept shows a nested sample tree and a playback-oriented
  bottom rail. The implementation lists the peer's real shared directories and
  retains Forever's already-approved live transfer shelf because playback is
  outside 0.0.9.
- A short session-cache note explains that received share lists are not written
  to disk. Empty, loading, timeout, retry, and truncated-search states add only
  the copy necessary for the live protocol workflow.

### Browser interaction review

- Opened `audiophile92` from the search result row and confirmed the explorer
  defaulted to Night Geometry after the share list arrived.
- Selected a complete ten-file folder, searched the cached list for
  “thresholds,” returned to folder view with the search field reset, and kept
  the selection intact.
- Download selection navigated into the Transfers workspace and preserved the
  existing grouped-release queue behavior.

The 0.0.9 explorer is faithful to the approved Midnight Radio shares direction.
Its intentional differences are driven by real Soulseek data and the existing
release scope; no material visual mismatch remains.

## 0.0.7 — Download the Release

- Approved primary reference: `design/concepts/03-midnight-radio.png`
  (1584 × 992)
- Coordinated Transfers-state reference:
  `design/concepts/06-midnight-radio-transfers.png` (1668 × 943)
- Release-selection capture:
  `design/implementation/release-selection-0.0.7.png` (1440 × 900)
- Transfers workspace capture:
  `design/implementation/release-transfers-0.0.7.png` (1440 × 900)
- Minimum-window capture:
  `design/implementation/release-transfers-0.0.7-minimum.png` (1024 × 680)
- Render method: live Vite application opened and exercised in the Codex
  in-app browser at both configured Tauri viewport sizes.

### Fidelity ledger

1. Layout matched: the persistent navigation rail and bottom transfer shelf
   retain the primary concept's proportions; the Transfers route uses the
   coordinated reference's wide central canvas, filter rail, expandable release
   rows, and dense file table.
2. Palette matched: true midnight navy remains the background, with fine indigo
   borders, restrained violet active/progress signals, amber utility actions,
   green completion state, and neutral off-white hierarchy.
3. Typography matched: headings remain light and editorial while navigation,
   tabs, filenames, byte progress, speeds, and statuses use the compact UI
   scale established by the approved application shell.
4. Component geometry matched: shallow six-to-seven-pixel radii, hairline
   borders, unboxed filter tabs, horizontal progress rails, compact icon
   controls, and an open list/table container preserve the reference language.
5. Release behavior matched: one expanded active release exposes ten ordered
   files, while queued and completed releases stay compact; aggregate progress,
   speed, ETA, pause/cancel/reveal actions, and the compact shelf agree across
   both surfaces.
6. Responsive behavior passed: at 1024 × 680 the sidebar collapses to named
   icon controls, secondary table columns are removed, the release list becomes
   the single intentional scroll region, and there is no document-width
   overflow or overlap with the shelf.

### Copy and interaction review

- The coordinated reference's visible labels—Transfers, All, Active, Queued,
  Completed, Failed, Clear completed, Pause, Cancel, Reveal, filenames, status,
  progress, speed, and ETA—are preserved.
- The implementation adds only functional copy required by the real workflow:
  “Complete releases, one carefully resumed file at a time,” “Search
  transfers,” source usernames, exact byte totals, and empty/error states.
- Browse folder, Select all/Deselect all, per-file toggles, aggregate selected
  size, Download files, release enqueue, release pause/resume, per-file pause,
  filter selection, and completion/history controls were exercised.
- No unapproved marketing copy, dashboard metrics, decorative pills, bento
  cards, or new navigation families were introduced.

### Material mismatches fixed

- Compact navigation labels visually collapse at the minimum size, so explicit
  accessible names were added to retain the semantic navigation model.
- The compact transfer shelf initially exceeded its minimum-height content box;
  row and header density were reduced at the breakpoint to remove clipping.
- The generated Transfers reference shows separate pause/cancel labels beneath
  icons at desktop size. The implementation keeps those labels on release cards
  and hides only the label text at the minimum viewport.

The v0.0.7 release and selection flows were faithfully verified against the
approved Midnight Radio system. No material visual mismatch remains.

## 0.0.4 — Live Search

- Approved reference:
  `design/concepts/03-midnight-radio.png` (1584 × 992)
- Default implementation capture:
  `design/implementation/midnight-radio-0.0.4.png`
- Live-search implementation capture:
  `design/implementation/live-search-0.0.4.png`
- Minimum supported viewport:
  `design/implementation/live-search-0.0.4-minimum.png` (1024 × 680)
- Render and interaction check: React preview exercised in the Codex in-app
  browser with no console errors.

### Fidelity comparison

1. The three-column shell, persistent left navigation, central search workspace,
   right inspector, and bottom transfer shelf retain the reference hierarchy.
2. The midnight navy surfaces, restrained violet borders and signals, amber
   highlights, and bright-neutral text preserve the approved color language.
3. Search controls, result columns, dense rows, format badges, availability
   signals, and circular actions keep the reference scale and rhythm.
4. The approved cover-art presentation remains the default discovery state;
   live files switch to a geometric signal/file treatment within the same
   visual system.
5. At 1024 × 680 the sidebar collapses to icons, the inspector remains useful,
   result columns stay legible, and the transfer shelf preserves its hierarchy
   without overlapping the search workspace.

### Copy and intentional deviations

- The concept’s fixed “142 results” is replaced with actual streamed file and
  peer counts.
- “Selected release” becomes “Selected file” for a live result, and release
  metadata becomes filename, folder, size, speed, queue, and visibility.
- The featured release becomes a live signal/search report after a query so
  network progress and completion are visible without adding a new panel.
- Live download actions are disabled and labeled “Downloads in 0.0.5” because
  this release intentionally stops at trustworthy discovery.
- The transfer shelf remains staged data in 0.0.4 to preserve the accepted
  shell while real transfer orchestration is built next.

The release candidate is a faithful implementation of Midnight Radio: the
information architecture, density, palette, geometry, and interaction emphasis
match the approved direction, while deviations communicate real v0.0.4 state.
