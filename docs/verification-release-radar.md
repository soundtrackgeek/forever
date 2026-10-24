# Artist Follow and New Release Radar — 0.0.76

Verified on Windows, 2026-10-24, for Part 2 item 5 in `FOREVER-REVIEW.md`.

## Automated checks

- `npm run check`: lint, TypeScript, 189 frontend tests, 10 release tests,
  production build, and all 10 lazy workspace boundaries passed.
- Final focused radar frontend tests: 6 passed; final production build passed.
- `cargo clippy --all-targets --all-features -- -D warnings`: passed.
- `cargo test --workspace`: 310 application tests and 5 matching tests passed.
- `cargo fmt --all -- --check`, version verification, and diff whitespace checks
  passed before commit.

New regression cases cover partial/invalid dates, old reissues, upcoming releases,
provider pagination, artist-credit validation, release-group deduplication,
independence from the seven-day catalog cache, daily/manual/retry cadence,
restart persistence, stale unfollow/refollow results, opt-out during a request,
dismissal/restore, verified ownership, failed Wanted additions, collaboration
history, corrupt-store recovery, unknown versions, and save failures.

Wanted insertion uses the defaults current at addition time, preserves existing
paused/fulfilled/edition choices, and writes before publishing its new state.
Radar receipts are saved separately; retrying across an interrupted receipt write
is insert-only and cannot reset an existing Wanted item.

## Browser preview

Playwright exercised:

- Add to Wanted changes the release action to In Wanted.
- Dismiss/Restore changes the inbox; the restored item and addition receipt
  survive reloading.
- Archive suggestions load on request; following Queen updates the follow count.
- The Def Leppard album-search Follow button updates to Following artist.
  Returning Home and reloading retains the artist in the follow manager.
- The radar fits the minimum supported 1024 × 680 window without horizontal
  overflow. The page scrolls vertically to the rest of the inbox.
- No browser console errors occurred during these flows.

Screenshots: [follow manager and inbox](../output/playwright/release-radar-0.0.76.png)
and [minimum window](../output/playwright/release-radar-0.0.76-minimum.png).

## Boundaries

The browser explicitly uses fictional release data and sample Archive suggestions;
it does not poll providers or perform automatic Wanted additions. Native behavior
is covered by Rust tests with local HTTP fixtures and temporary stores. A live
MusicBrainz spot check returned HTTP 503; the live provider was not a reliable
verification source during this run. The shared transport's retry/backoff and
response-size/deadline behavior passed its existing regression tests.

Installed-app interaction, a real elapsed 24-hour scheduling cycle, and live public
Soulseek source checks were not exercised. Automatic scheduling is an in-process
desktop task: closing Forever stops it, and reopening resumes due checks. No
closed-app service or ListenBrainz account integration is part of this feature.
