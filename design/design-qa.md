# Midnight Radio design QA

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
