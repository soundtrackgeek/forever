import type { AlbumSource, WantedPreferences } from "../types";

const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "AIFF", "APE", "WV"]);

const formatRank = (format: string) => {
  switch (format.toUpperCase()) {
    case "FLAC": return 10;
    case "ALAC": return 9;
    case "WAV":
    case "AIFF": return 8;
    case "APE":
    case "WV": return 7;
    case "MP3": return 5;
    case "M4A":
    case "AAC": return 4;
    case "OGG":
    case "OPUS": return 3;
    case "WMA": return 2;
    default: return 1;
  }
};

const primaryFormat = (source: AlbumSource) =>
  [...source.formats].sort((left, right) => formatRank(right) - formatRank(left))[0] ?? "Unknown";

const hasLossless = (source: AlbumSource) =>
  source.formats.some((format) => LOSSLESS.has(format.toUpperCase()));

const minimumLossyBitrate = (source: AlbumSource) => {
  const bitrates = source.tracks
    .filter((track) => !LOSSLESS.has(track.format.toUpperCase()))
    .map((track) => track.bitrate)
    .filter((bitrate): bitrate is number => bitrate != null && bitrate > 0);
  return bitrates.length ? Math.min(...bitrates) : null;
};

export type RankedAlbumSource = {
  source: AlbumSource;
  eligible: boolean;
  score: number;
  format: string;
  minimumBitrateKbps: number | null;
  reason: string;
};

export function rankAlbumSources(
  sources: AlbumSource[],
  preferences: WantedPreferences,
): RankedAlbumSource[] {
  return sources
    .map((source) => {
      const lossless = hasLossless(source);
      const minimumBitrateKbps = minimumLossyBitrate(source);
      const enoughTracks = preferences.minimumTrackCount == null
        || source.tracks.length >= preferences.minimumTrackCount;
      const formatAllowed = preferences.formatPreference !== "losslessOnly" || lossless;
      const bitrateAllowed = lossless
        || preferences.minimumBitrateKbps == null
        || (minimumBitrateKbps != null && minimumBitrateKbps >= preferences.minimumBitrateKbps);
      const eligible = enoughTracks && formatAllowed && bitrateAllowed;
      const score = (preferences.formatPreference !== "any" && lossless ? 500 : 0)
        + formatRank(primaryFormat(source)) * 20
        + source.tracks.length * 30
        + (source.slotFree ? 180 : 0)
        + Math.min(120, Math.floor(source.averageSpeed / 100_000))
        + Math.max(0, 100 - Math.min(20, source.queueLength) * 5);
      const reason = !enoughTracks
        ? `Needs ${preferences.minimumTrackCount} tracks`
        : !formatAllowed
          ? "Lossless required"
          : !bitrateAllowed
            ? `${preferences.minimumBitrateKbps} kbps minimum`
            : source.slotFree
              ? "Matches · free slot"
              : `Matches · ${source.queueLength} queued`;
      return {
        source,
        eligible,
        score,
        format: primaryFormat(source),
        minimumBitrateKbps,
        reason,
      };
    })
    .sort((left, right) => Number(right.eligible) - Number(left.eligible)
      || right.score - left.score
      || right.source.tracks.length - left.source.tracks.length
      || right.source.averageSpeed - left.source.averageSpeed);
}

export const wantedPreferencesLabel = (preferences: WantedPreferences) => {
  const format = preferences.formatPreference === "losslessOnly"
    ? "Lossless only"
    : preferences.formatPreference === "preferLossless"
      ? "Prefer FLAC"
      : "Any format";
  const bitrate = preferences.formatPreference === "losslessOnly"
    ? null
    : preferences.minimumBitrateKbps
      ? `${preferences.minimumBitrateKbps}+ kbps`
      : "any bitrate";
  const tracks = preferences.minimumTrackCount
    ? `${preferences.minimumTrackCount}+ tracks`
    : null;
  return [format, bitrate, tracks].filter(Boolean).join(" · ");
};
