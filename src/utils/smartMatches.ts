import { matchingCommand as invoke } from "./matchingClient";
import type { AlbumSource, AlbumTrack, WantedFormatPreference, WantedPreferences } from "../types";
import type { TracklistConfidence } from "./tracklistConfidence";
import { matchTolerance, type MatchTolerance } from "./matchTolerance";

export type RankedAlbumSource = {
  source: AlbumSource;
  eligible: boolean;
  score: number;
  format: string;
  minimumBitrateKbps: number | null;
  reason: string;
  tracklistConfidence: TracklistConfidence;
};

export function rankingInput(sources: AlbumSource[], preferences: WantedPreferences, officialTracks: AlbumTrack[] = [], artist = "", tolerance: MatchTolerance = matchTolerance()) {
  return { sources: sources.map((source) => ({
    id: source.id, owner: source.owner, folder: source.folder,
    slotFree: source.slotFree, averageSpeed: source.averageSpeed, queueLength: source.queueLength,
    tracks: source.tracks.map((track) => ({ id: track.id, name: track.filename ?? track.title, format: track.format, bitrate: track.bitrate ?? null, durationSeconds: track.durationSeconds ?? null })),
  })), preferences, officialTracks, artist, tolerance };
}

export type RankedSourceResponse = Omit<RankedAlbumSource, "source"> & { sourceId: string };

export async function rankAlbumSources(sources: AlbumSource[], preferences: WantedPreferences, officialTracks: AlbumTrack[] = [], artist = ""): Promise<RankedAlbumSource[]> {
  const ranked = await invoke<RankedSourceResponse[]>("rank_album_sources", rankingInput(sources, preferences, officialTracks, artist));
  return attachSources(ranked, sources);
}

export function attachSources(ranked: RankedSourceResponse[], sources: AlbumSource[]): RankedAlbumSource[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return ranked.flatMap(({ sourceId, ...rank }) => {
    const source = byId.get(sourceId);
    return source ? [{ ...rank, source }] : [];
  });
}

export const wantedFormatOptions: Array<{ value: WantedFormatPreference; label: string; copy: string }> = [
  { value: "preferLossless", label: "Prefer FLAC", copy: "Recommend lossless first, with a high-quality lossy fallback." },
  { value: "losslessOnly", label: "Lossless only", copy: "Ignore MP3, AAC, OGG, and other lossy folders." },
  { value: "mp3Only", label: "MP3 only", copy: "Recommend folders made entirely of MP3 files at your chosen bitrate." },
  { value: "any", label: "Any format", copy: "Rank every source by completeness and availability." },
];

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
