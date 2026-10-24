# Soundcheck signal fixtures

These are generated signals, not copyrighted recordings. FFmpeg produces four
seconds of deterministic mono white noise (seed 173, 48 kHz, amplitude 0.3), then
encodes it as 16-bit FLAC. Derived fixtures pass through LAME MP3 at 128 and
320 kbps before returning to FLAC, or through FFmpeg's default resampler to
96 kHz / 24-bit FLAC. They test known signal transformations, not classifier
accuracy on music. Production analysis uses Symphonia/RustFFT, not FFmpeg.

From the repository root, using an empty temporary output directory:

```powershell
ffmpeg -f lavfi -i 'anoisesrc=color=white:amplitude=0.3:sample_rate=48000:duration=4:seed=173' -sample_fmt s16 01-broadband.flac
ffmpeg -i 01-broadband.flac -c:a libmp3lame -b:a 128k transcode-128.mp3
ffmpeg -i transcode-128.mp3 -sample_fmt s16 02-transcoded-128.flac
ffmpeg -i 01-broadband.flac -c:a libmp3lame -b:a 320k transcode-320.mp3
ffmpeg -i transcode-320.mp3 -sample_fmt s16 03-transcoded-320.flac
ffmpeg -i 01-broadband.flac -ar 96000 -sample_fmt s32 04-upsampled.flac
```

Run `cargo test --lib sonic_encoded_flac_fixtures` in `src-tauri` to decode the
committed fixtures without FFmpeg installed. Set `FOREVER_SONIC_EVIDENCE_DIR`
to an external output directory to export the native scan JSON for UI inspection.
