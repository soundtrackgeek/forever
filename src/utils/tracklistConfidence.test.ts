import { describe, expect, it } from "vitest";
import type { AlbumTrack } from "../types";
import { normalizeTrackTitle, tracklistConfidenceForTitles } from "./tracklistConfidence";

const official = (...titles: string[]): AlbumTrack[] => titles.map((title, index) => ({
  position: index + 1,
  discNumber: 1,
  discPosition: index + 1,
  title,
  durationMs: null,
}));

const sources = (...names: string[]) => names.map((name, index) => ({
  id: String(index + 1),
  name,
}));

describe("tracklist confidence", () => {
  it("normalizes disc numbers, artist prefixes, punctuation, and remaster tags", () => {
    expect(normalizeTrackTitle("CD1 01 - INXS - Original Sin (2011 Remastered).flac", "INXS"))
      .toBe("original sin");
  });

  it("recognizes a complete official tracklist despite filename decoration", () => {
    const confidence = tracklistConfidenceForTitles(
      sources("01 - Original Sin.flac", "02. Melting in the Sun.flac", "03 - I Send a Message.flac"),
      official("Original Sin", "Melting in the Sun", "I Send a Message"),
      "INXS",
    );
    expect(confidence).toMatchObject({
      state: "exact",
      label: "Exact tracklist",
      matchedCount: 3,
      officialCount: 3,
      safeToRecommend: true,
    });
  });

  it("keeps complete deluxe folders eligible while reporting their extras", () => {
    const confidence = tracklistConfidenceForTitles(
      sources("01 - Original Sin.flac", "02 - Melting in the Sun.flac", "03 - Bonus Demo.flac"),
      official("Original Sin", "Melting in the Sun"),
    );
    expect(confidence).toMatchObject({
      state: "completeWithExtras",
      matchedCount: 2,
      extraSourceNames: ["03 - Bonus Demo.flac"],
      safeToRecommend: true,
    });
  });

  it("rejects same-sized folders containing unrelated songs", () => {
    const confidence = tracklistConfidenceForTitles(
      sources("01 - Wrong Song.flac", "02 - Another Song.flac", "03 - Not This Album.flac"),
      official("Original Sin", "Melting in the Sun", "I Send a Message"),
    );
    expect(confidence.state).toBe("unclear");
    expect(confidence.matchedCount).toBe(0);
    expect(confidence.safeToRecommend).toBe(false);
  });

  it("reports missing official titles for a partial folder", () => {
    const confidence = tracklistConfidenceForTitles(
      sources("01 - Original Sin.flac", "02 - Melting in the Sun.flac"),
      official("Original Sin", "Melting in the Sun", "I Send a Message"),
    );
    expect(confidence.state).toBe("partial");
    expect(confidence.missingTracks.map((track) => track.title)).toEqual(["I Send a Message"]);
  });

  it("keeps the existing rules authoritative when no official list is available", () => {
    expect(tracklistConfidenceForTitles(sources("01 - Unknown.flac"), [])).toMatchObject({
      state: "unavailable",
      safeToRecommend: true,
      score: 0,
    });
  });
});
