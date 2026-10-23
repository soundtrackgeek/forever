import { matchingCommand as invoke } from "./matchingClient";
import type { AlbumSource, AlbumTrack, WantedPreferences } from "../types";
import type { TracklistConfidence } from "./tracklistConfidence";

export type RankedAlbumSource = {
  source: AlbumSource;
  eligible: boolean;
  score: number;
  format: string;
  minimumBitrateKbps: number | null;
  reason: string;
  tracklistConfidence: TracklistConfidence;
};

export function rankingInput(sources: AlbumSource[], preferences: WantedPreferences, officialTracks: AlbumTrack[] = [], artist = "") {
  return { sources: sources.map((source) => ({
    id: source.id, owner: source.owner, folder: source.folder,
    slotFree: source.slotFree, averageSpeed: source.averageSpeed, queueLength: source.queueLength,
    tracks: source.tracks.map((track) => ({ id: track.id, name: track.filename ?? track.title, format: track.format, bitrate: track.bitrate ?? null, durationSeconds: track.durationSeconds ?? null })),
  })), preferences, officialTracks, artist };
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
