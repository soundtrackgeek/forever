import { expect, it, vi } from "vitest";
import { matchingCommand as invoke } from "./matchingClient";
import type { FolderInspection } from "../types";
import { tracklistConfidenceForInspection, tracklistConfidenceForTitles } from "./tracklistConfidence";
const strict = { durationSeconds: 3, allowedMismatches: 0 };
vi.mock("./matchingClient", () => ({ matchingCommand: vi.fn() }));

it("passes Unicode filenames untouched to Rust", async () => {
  const titles = [{ id: "1", name: "01 - Björk - Jóga.flac" }];
  const confidence = { state: "exact", safeToRecommend: true, score: 6000 };
  vi.mocked(invoke).mockResolvedValue(confidence);
  expect(await tracklistConfidenceForTitles(titles, [], "Björk")).toBe(confidence);
  expect(invoke).toHaveBeenLastCalledWith("tracklist_confidence", { sourceTitles: titles, officialTracks: [], artist: "Björk", tolerance: strict });
});

it("lets a caller widen the length tolerance for one check", async () => {
  vi.mocked(invoke).mockResolvedValue({ state: "exact" });
  await tracklistConfidenceForTitles([], [], "", { durationSeconds: 9, allowedMismatches: 1 });
  expect(invoke).toHaveBeenLastCalledWith("tracklist_confidence", { sourceTitles: [], officialTracks: [], artist: "", tolerance: { durationSeconds: 9, allowedMismatches: 1 } });
});

it("keeps companion files out of inspected tracklists", async () => {
  const inspection = { files: [
    { remoteFilename: "Album/Song.flac", filename: "Song.flac", extension: "FLAC" },
    { remoteFilename: "Album/cover.jpg", filename: "cover.jpg", extension: "jpg" },
  ] } as FolderInspection;
  vi.mocked(invoke).mockResolvedValue({ state: "unavailable" });
  await tracklistConfidenceForInspection(inspection, [], "Artist");
  expect(invoke).toHaveBeenLastCalledWith("tracklist_confidence", { sourceTitles: [{ id: "Album/Song.flac", name: "Song.flac", durationSeconds: null }], officialTracks: [], artist: "Artist", tolerance: strict });
});
