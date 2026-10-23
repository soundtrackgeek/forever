import { describe, expect, it } from "vitest";
import type { SearchResult } from "../types";
import fixture from "../../fixtures/matching.json";
import {
  albumSourcesMeetingTrackMinimum,
  formatAlbumBytes,
  groupAlbumSources,
  albumFolder,
} from "./albumSources";

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
  it("matches the Rust disc-folder policy and groups discs without merging editions or peers", () => {
    for (const entry of fixture.albumFolders) expect(albumFolder(entry.input)).toBe(entry.expected);
    const disc = result("1", "owner", "Music\\Album\\CD1", "01 Song.flac", "FLAC", 10);
    const sources = groupAlbumSources([
      disc, { ...disc, id: "repeated-reply" },
      result("2", "owner", "Music\\Album\\Disc 2", "01 Song.flac", "FLAC", 20),
      result("3", "owner", "Music\\Album\\Deluxe", "01 Song.flac", "FLAC", 30),
      result("4", "another", "Music\\Album\\CD1", "01 Song.flac", "FLAC", 40),
    ]);
    expect(sources).toHaveLength(3);
    expect(sources[0]).toMatchObject({
      folder: "Music\\Album", folderName: "Album", totalSizeBytes: 30,
      folders: ["Music\\Album\\CD1", "Music\\Album\\Disc 2"],
      representative: { folder: "Music\\Album" },
    });
    expect(sources[0].tracks).toHaveLength(2);
  });
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

  it("hides partial folders from a minimum-track album comparison", () => {
    const grouped = groupAlbumSources([
      result("partial", "archive", "Music\\Singles", "01 - Single.flac", "FLAC", 40_000_000),
      ...Array.from({ length: 10 }, (_, index) => result(
        `album-${index}`,
        "complete",
        "Music\\Original Sin",
        `${String(index + 1).padStart(2, "0")} - Track.flac`,
        "FLAC",
        40_000_000,
      )),
    ]);

    expect(albumSourcesMeetingTrackMinimum(grouped, 10)).toMatchObject([
      { owner: "complete", tracks: { length: 10 } },
    ]);
    expect(albumSourcesMeetingTrackMinimum(grouped, null)).toHaveLength(2);
  });
});
