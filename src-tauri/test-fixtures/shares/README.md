These original two-second 440 Hz sine tones exercise header-only share indexing.
They contain no third-party recordings. Generated with FFmpeg:

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000:duration=2 -ac 2 -c:a flac -sample_fmt s32 -bits_per_raw_sample 24 tone.flac
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=2 -ac 2 -c:a libmp3lame -b:a 192k tone.mp3
```

Tests use these saved fixtures; FFmpeg is not required to run them.
