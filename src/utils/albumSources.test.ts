import { describe, expect, it } from "vitest";
import type { SearchResult } from "../types";
import { formatAlbumBytes, groupAlbumSources } from "./albumSources";

const result = (
  id: string,
  owner: string,
  folder: string,
  filename: string,
  format: string,
  sizeBytes: number,
): SearchResult => ({
  id,
  title: filename,
  subtitle: folder,
  owner,
  trust: 100,
  format,
  quality: format === "FLAC" ? "16 / 44.1" : "320 kbps",
  size: formatAlbumBytes(sizeBytes),
  tracks: 1,
  rating: 5,
  ratingLabel: "Ready",
  availability: [20, 40],
  source: "live",
  filename: `${folder}\\${filename}`,
  folder,
  sizeBytes,
  slotFree: true,
  averageSpeed: 4_000_000,
  queueLength: 0,
  isPrivate: false,
});

describe("groupAlbumSources", () => {
  it("groups matching files by user and remote folder", () => {
    const grouped = groupAlbumSources([
      result("1", "archive", "Music/Def Leppard/Hysteria", "02 - Animal.flac", "FLAC", 40_000_000),
      result("2", "archive", "Music\\Def Leppard\\Hysteria", "01 - Women.flac", "FLAC", 42_000_000),
      result("3", "another", "Music\\Def Leppard\\Hysteria", "01 - Women.mp3", "MP3", 9_000_000),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      owner: "archive",
      folderName: "Hysteria",
      formats: ["FLAC"],
      totalSizeBytes: 82_000_000,
    });
    expect(grouped[0].tracks.map((track) => track.title)).toEqual([
      "01 - Women.flac",
      "02 - Animal.flac",
    ]);
  });

  it("counts only audio files as tracks while preserving companion files", () => {
    const grouped = groupAlbumSources([
      result("1", "archive", "Music\\Album", "01 - Song.flac", "FLAC", 40_000_000),
      result("2", "archive", "Music\\Album", "cover.jpg", "JPG", 2_000_000),
    ]);

    expect(grouped[0].files).toHaveLength(2);
    expect(grouped[0].tracks).toHaveLength(1);
    expect(grouped[0].totalSizeBytes).toBe(42_000_000);
    expect(formatAlbumBytes(grouped[0].totalSizeBytes)).toBe("42.0 MB");
  });
});
