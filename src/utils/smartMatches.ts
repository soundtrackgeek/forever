import type { AlbumSource, AlbumTrack, WantedPreferences } from "../types";
import {
  tracklistConfidenceForSource,
  type TracklistConfidence,
} from "./tracklistConfidence";

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
  tracklistConfidence: TracklistConfidence;
};

export function rankAlbumSources(
  sources: AlbumSource[],
  preferences: WantedPreferences,
  officialTracks: AlbumTrack[] = [],
  artist = "",
): RankedAlbumSource[] {
  return sources
    .map((source) => {
      const tracklistConfidence = tracklistConfidenceForSource(source, officialTracks, artist);
      const lossless = hasLossless(source);
      const mp3Only = source.formats.length > 0
        && source.formats.every((format) => format.toUpperCase() === "MP3");
      const minimumBitrateKbps = minimumLossyBitrate(source);
      const enoughTracks = preferences.minimumTrackCount == null
        || source.tracks.length >= preferences.minimumTrackCount;
      const formatAllowed = preferences.formatPreference === "losslessOnly"
        ? lossless
        : preferences.formatPreference === "mp3Only"
          ? mp3Only
          : true;
      const bitrateAllowed = lossless
        || preferences.minimumBitrateKbps == null
        || (minimumBitrateKbps != null && minimumBitrateKbps >= preferences.minimumBitrateKbps);
      const eligible = enoughTracks
        && formatAllowed
        && bitrateAllowed
        && tracklistConfidence.safeToRecommend;
      const score = ((preferences.formatPreference !== "any" && lossless)
        || (preferences.formatPreference === "mp3Only" && mp3Only) ? 500 : 0)
        + tracklistConfidence.score
        + formatRank(primaryFormat(source)) * 20
        + source.tracks.length * 30
        + (source.slotFree ? 180 : 0)
        + Math.min(120, Math.floor(source.averageSpeed / 100_000))
        + Math.max(0, 100 - Math.min(20, source.queueLength) * 5);
      const reason = !enoughTracks
        ? `Needs ${preferences.minimumTrackCount} tracks`
        : !tracklistConfidence.safeToRecommend
          ? tracklistConfidence.state === "partial"
            ? `${tracklistConfidence.missingTracks.length} official tracks missing`
            : "Track titles do not line up"
        : !formatAllowed
          ? preferences.formatPreference === "mp3Only" ? "MP3 required" : "Lossless required"
          : !bitrateAllowed
            ? `${preferences.minimumBitrateKbps} kbps minimum`
            : source.slotFree
              ? `${tracklistConfidence.state === "unavailable" ? "Matches" : tracklistConfidence.label} · free slot`
              : `${tracklistConfidence.state === "unavailable" ? "Matches" : tracklistConfidence.label} · ${source.queueLength} queued`;
      return {
        source,
        eligible,
        score,
        format: primaryFormat(source),
        minimumBitrateKbps,
        reason,
        tracklistConfidence,
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
    : preferences.formatPreference === "mp3Only"
      ? "MP3 only"
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
