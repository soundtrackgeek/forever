import { describe, expect, it } from "vitest";
import type { AlbumSource, AlbumTrack, SearchResult, WantedPreferences } from "../types";
import { rankAlbumSources, wantedPreferencesLabel } from "./smartMatches";

const source = (
  id: string,
  format: string,
  tracks: number,
  bitrate: number | null,
  slotFree: boolean,
): AlbumSource => {
  const files: SearchResult[] = Array.from({ length: tracks }, (_, index) => ({
    id: `${id}-${index}`,
    title: `${index + 1}.${format.toLowerCase()}`,
    subtitle: "",
    owner: id,
    trust: 100,
    format,
    quality: bitrate ? `${bitrate} kbps` : "Lossless",
    size: "10 MB",
    tracks: 1,
    rating: 5,
    ratingLabel: "Ready",
    availability: [],
    bitrate,
  }));
  return {
    id,
    owner: id,
    folder: `Music\\${id}`,
    folderName: id,
    files,
    tracks: files,
    formats: [format],
    qualities: [],
    totalSizeBytes: tracks * 10_000_000,
    slotFree,
    averageSpeed: slotFree ? 8_000_000 : 12_000_000,
    queueLength: slotFree ? 0 : 4,
    isPrivate: false,
    representative: files[0],
  };
};

const preferences: WantedPreferences = {
  formatPreference: "preferLossless",
  minimumBitrateKbps: 320,
  minimumTrackCount: 10,
};

const officialTracks: AlbumTrack[] = Array.from({ length: 10 }, (_, index) => ({
  position: index + 1,
  discNumber: 1,
  discPosition: index + 1,
  title: `Song ${index + 1}`,
  durationMs: null,
}));

const titledSource = (id: string, titles: string[], format = "FLAC") => {
  const candidate = source(id, format, titles.length, format === "MP3" ? 320 : null, true);
  candidate.tracks = candidate.tracks.map((track, index) => ({
    ...track,
    title: `${String(index + 1).padStart(2, "0")} - ${titles[index]}.${format.toLocaleLowerCase()}`,
    filename: `${String(index + 1).padStart(2, "0")} - ${titles[index]}.${format.toLocaleLowerCase()}`,
  }));
  candidate.files = candidate.tracks;
  candidate.representative = candidate.tracks[0];
  return candidate;
};

describe("Smart Match ranking", () => {
  it("recommends a complete ready FLAC source over a larger MP3 folder", () => {
    const ranked = rankAlbumSources([
      source("mp3", "MP3", 12, 320, false),
      source("flac", "FLAC", 10, null, true),
    ], preferences);
    expect(ranked[0].source.id).toBe("flac");
    expect(ranked[0].eligible).toBe(true);
  });

  it("rejects lossy sources below the configured bitrate", () => {
    const ranked = rankAlbumSources([source("mp3", "MP3", 10, 256, true)], preferences);
    expect(ranked[0].eligible).toBe(false);
    expect(ranked[0].reason).toBe("320 kbps minimum");
  });

  it("summarizes persisted preferences clearly", () => {
    expect(wantedPreferencesLabel(preferences)).toBe("Prefer FLAC · 320+ kbps · 10+ tracks");
  });

  it("accepts only MP3 sources in MP3-only mode", () => {
    const mp3Only = { ...preferences, formatPreference: "mp3Only" as const };
    const ranked = rankAlbumSources([
      source("flac", "FLAC", 10, null, true),
      source("mp3", "MP3", 10, 320, true),
    ], mp3Only);
    expect(ranked[0].source.id).toBe("mp3");
    expect(ranked[0].eligible).toBe(true);
    expect(ranked[1].eligible).toBe(false);
    expect(wantedPreferencesLabel(mp3Only)).toBe("MP3 only · 320+ kbps · 10+ tracks");
  });

  it("ranks an exact official tracklist above a faster same-sized wrong album", () => {
    const exact = titledSource("exact", officialTracks.map((track) => track.title));
    const wrong = titledSource("wrong", Array.from({ length: 10 }, (_, index) => `Different ${index + 1}`));
    wrong.averageSpeed = 40_000_000;

    const ranked = rankAlbumSources([wrong, exact], preferences, officialTracks, "Artist");

    expect(ranked[0].source.id).toBe("exact");
    expect(ranked[0].eligible).toBe(true);
    expect(ranked[0].tracklistConfidence.state).toBe("exact");
    expect(ranked[1].eligible).toBe(false);
    expect(ranked[1].reason).toBe("Track titles do not line up");
  });
});
