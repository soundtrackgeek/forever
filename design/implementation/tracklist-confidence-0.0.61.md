# Tracklist Confidence and edition choice — 0.0.61

Verified on Windows, 2026-10-23.

## Delivered behavior

- Shared Rust confidence compares reported per-track durations within ±3 seconds.
  Known differences block recommendations; missing/zero lengths stay unknown.
  Duration agreement breaks equal album-source scores.
- Review and profile edition pickers show MusicBrainz release details and save
  a per-Wanted-album selection. Changing editions invalidates old recommendations.
  Profiles keep their format, bitrate, and minimum-track-count rules.
- Exact numbered disc siblings group into one source. Inspection requests all
  advertised discs; downloads preserve their local subdirectories.

## Verification

- 102 frontend tests passed across 26 files:
  node node_modules/vitest/vitest.mjs run --maxWorkers=2.
  An earlier unrestricted run during the Rust build hit process-startup and
  clock-sensitive test timeouts; the bounded run passed the complete suite.
- 187 Rust tests passed with cargo test --workspace --all-targets --all-features --locked.
- ESLint (zero warnings), TypeScript, production Vite build, version verification,
  rustfmt, and Clippy (--workspace --all-targets --all-features -- -D warnings) passed.
- Live read-only MusicBrainz browse and release requests for Hysteria confirmed
  media track counts, official status, release-group membership, and millisecond
  track lengths against the [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API).
- Playwright CLI at http://127.0.0.1:1421, viewports 1440×1000 and 1100×760.
  Browser plugin skill was unavailable, so the Playwright fallback was used.
  Wanted → check A Sonic Holiday → review → choose deluxe shows the missing
  bonus recording and prevents queueing as a recommended source.
  The app rendered without a framework overlay; browser logs had zero errors
  and zero warnings. The component/App tests additionally cover duration
  mismatch gating, edition persistence in the UI, and stale edition-list replies.

## Evidence

- [Desktop review](tracklist-confidence-0.0.61-desktop.png)
- [Compact review](tracklist-confidence-0.0.61-compact.png)

## Limits

Browser flows use preview data and the real Rust matcher; they do not establish
native WebView or public Soulseek peer interoperability. Automated tests cover
multi-disc inspection and safe local paths. Duration metadata does not verify
audio identity, and equal titles/lengths cannot distinguish pressings.
