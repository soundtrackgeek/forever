import { describe, expect, it } from "vitest";
import type { AlbumSource, SearchResult, WantedPreferences } from "../types";
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
});
