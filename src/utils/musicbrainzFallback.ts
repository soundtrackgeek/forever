export const MUSICBRAINZ_FALLBACK_TRACK_COUNT_STORAGE_KEY =
  "forever.musicbrainzFallbackTrackCount";
export const DEFAULT_MUSICBRAINZ_FALLBACK_TRACK_COUNT = 10;

export function normalizeMusicBrainzFallbackTrackCount(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 250
    ? parsed
    : DEFAULT_MUSICBRAINZ_FALLBACK_TRACK_COUNT;
}

export function readMusicBrainzFallbackTrackCount() {
  try {
    return normalizeMusicBrainzFallbackTrackCount(
      window.localStorage.getItem(
        MUSICBRAINZ_FALLBACK_TRACK_COUNT_STORAGE_KEY,
      ),
    );
  } catch {
    return DEFAULT_MUSICBRAINZ_FALLBACK_TRACK_COUNT;
  }
}

export function saveMusicBrainzFallbackTrackCount(value: number) {
  const normalized = normalizeMusicBrainzFallbackTrackCount(value);
  try {
    window.localStorage.setItem(
      MUSICBRAINZ_FALLBACK_TRACK_COUNT_STORAGE_KEY,
      String(normalized),
    );
  } catch {
    // Keep the in-memory setting when WebView storage is unavailable.
  }
  return normalized;
}
