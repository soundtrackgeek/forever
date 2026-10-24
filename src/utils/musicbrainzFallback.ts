export const MUSICBRAINZ_FALLBACK_TRACK_COUNT_STORAGE_KEY =
  "forever.musicbrainzFallbackTrackCount";
export const DEFAULT_MUSICBRAINZ_FALLBACK_TRACK_COUNT = 10;

export function normalizeMusicBrainzFallbackTrackCount(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 250
    ? parsed
    : DEFAULT_MUSICBRAINZ_FALLBACK_TRACK_COUNT;
}
