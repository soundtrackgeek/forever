# Sonic Soundcheck — 0.0.73

Deep scan keeps the original full-frame decode and embedded integrity checks.
It also inspects decoded samples locally. Quick Soundcheck still reads headers;
it does not perform spectral analysis. Neither mode writes audio or tags.

## Evidence and limits

- A 4096-sample Hann window is transformed with RustFFT at most four times per
  second. Each channel is transformed separately and its power is averaged, so
  opposite-phase stereo does not cancel. There must be at least three decoded
  seconds and 12 active windows before a bandwidth verdict is made.
- Cutoff candidates cover 14–24 kHz in approximately 500 Hz steps, plus the
  22.05 kHz CD-rate boundary. A sharp shelf needs broadband activity below the
  edge, a 30 dB local drop, little total energy above it, and agreement in at
  least 85% of active windows. Silence and tonal windows cannot establish a
  shelf. Mixed bandwidth normally yields **Inconclusive**.
- High-rate streams also check for the broader transition and deep stopband
  typical of 44.1/48 kHz resampling. **Likely upsampled** is an interpretation
  of a persistent bandwidth limit, not evidence of the exact original rate.
- **Likely genuine** means broadband activity and no consistent shelf detected.
  **Suspect transcode** means a shelf worth reviewing. Already-lossy decoded
  codecs get **Lossy source**, not a fake-lossless accusation. Codec detection,
  not the file extension, controls this distinction.
- Padding means every decoded nonzero integer sample fits a 16-bit grid in a
  declared higher-depth stream (minimum three seconds and 10,000 nonzero
  samples). It is not a dynamic-range or effective-number-of-bits measurement.
  Dither or processing can erase this evidence; floating point is excluded.
- Possible clipping requires runs of at least three full-scale samples in a
  channel. All full-scale samples and runs are counted across the complete
  decode. Isolated peaks are shown without creating a clipping warning.
- Spectrograms contain at most 96 time columns × 64 linear frequency bands.
  Cells show peak relative power within each band/window, −96 to 0 dB; successive
  columns are merged by maximum when capacity is reached. The time axis spans
  the scan, with a potentially shorter final column. This is a compact view,
  not a full-resolution waveform or dBFS measurement.

Original band-limited masters can look like transcodes or upsampling. Exact
codec, bitrate, mastering provenance, perceptual quality, and authenticity are
not established. High-bitrate lossy material can evade a spectral detector.
The synthetic regression fixtures are not a representative music benchmark;
no precision/recall claim is made.

## Workflow and storage

Open Archive → Arrival Desk → track evidence → **Deep scan**. Expand **Sonic
evidence** for the verdict, measurements, spectrogram, and interpretation limits.
Sonic concerns put an unfiled release in **Needs attention**. You can open Patch
Bay to select a replacement, or **Mark filed with review notes** after your own
review. That confirmation keeps the evidence and does not move files.

Patch Bay preserves the original using its existing repair flow and deep-scans
the replacement. A new sonic concern remains in attention; a readable stream
alone is no longer sufficient to call that repair successful. Warnings never
automatically replace an existing completed file.

Results live in the existing crash-safe transfer store. Optional fields keep
legacy records readable; absence is displayed as unmeasured, never invented
as a clean verdict. Spectrogram cells are base64-packed, at most 8 KiB per file.
Quick rescans retain sonic evidence only when the saved file size and precise
modification stamp match. A fresh Deep scan replaces it.

Source history stores the last 128 distinct remote-file/size observations per
user, deduplicated across rescans/downloads. Only a digest of that identity is
stored in the observation. Concerns remain separate from transfer failures,
are described as advisory in source tooltips, and subtract 25 ranking points
each up to a 200-point cap. No concern is treated as proof of peer dishonesty.

One deep decode runs at a time, on a blocking worker outside queue locks and
the network executor. Analysis supports 8–384 kHz, up to eight channels, and
bounded conversion buffers. The entire file is decoded, so work still scales
with track duration. Updated transfer identity/evidence and before/after file
stamps reject obsolete results; normal transfer progress continues meanwhile.
File stamps guard ordinary concurrent edits, not adversarial same-stamp rewrites.

## Verification

Native regressions cover 16/19/20 kHz shelves, anti-phase stereo, broadband and
declared lossy streams, silence/tones, short signals, changing bandwidth,
upsampling, padding and true lower-bit content, clipping, non-finite samples,
compact storage bounds, persistence/legacy records, deduplication, and stale
result rejection. Real Symphonia decoding exercises deterministic FLAC fixtures
derived from LAME 128/320 kbps and resampling, with byte-for-byte checks that
inspection did not change the files. Fixture generation is documented in
[`test-fixtures/soundcheck`](../src-tauri/test-fixtures/soundcheck/README.md).

React regressions exercise evidence expansion, Deep scan dispatch, Arrival Desk
attention/filing, per-track repair availability, suspect replacement handling,
and source scoring. Browser QA renders the actual Arrival Desk components with
exported native fixture evidence and stubbed action callbacks. It verifies the
graph and review/repair controls, not installed Tauri IPC or a live network
download. Physical listening and accuracy on a real-music collection remain
untested.

Local release checks on Windows (2026-10-24): 278 backend tests plus 5 matching
crate tests, 172 frontend tests, and 10 release-script tests passed. Rust
formatting/Clippy, frontend lint/type checking, production bundle checks, version
alignment, and whitespace checks passed. Browser inspection used Chromium at
1440×1000 and the application's minimum width, 1024×1000, with no horizontal
overflow at the supported minimum. Evidence expansion, Deep scan dispatch, and
Patch Bay opening were exercised. The temporary harness initially needed its
stylesheet/CJS imports corrected; later browser errors were limited to Vite's
development WebSocket being blocked by Chromium's local-network access policy.
No component/runtime error or framework overlay remained in the tested flow.
Screenshots and native result exports were kept outside the repository.

Implementation references: [RustFFT planner](https://docs.rs/rustfft/latest/rustfft/struct.FftPlanner.html)
and [flaccheck's documented detector limitations](https://github.com/dasunNimantha/flaccheck).
Forever's thresholds and implementation are its own; flaccheck's published
benchmarks are not applicable to this detector.
