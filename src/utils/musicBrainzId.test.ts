import { describe, expect, it } from "vitest";
import { musicBrainzId } from "./musicBrainzId";

describe("musicBrainzId", () => {
  it("keeps a release-group MBID and trims surrounding space", () => {
    expect(musicBrainzId("81541950-5532-4248-addb-de20991a332a")).toBe(
      "81541950-5532-4248-addb-de20991a332a",
    );
    expect(musicBrainzId("  81541950-5532-4248-addb-de20991a332a  ")).toBe(
      "81541950-5532-4248-addb-de20991a332a",
    );
  });

  it("drops Discogs-only discovery ids and other non-MusicBrainz values", () => {
    expect(musicBrainzId("discogs:123456")).toBeNull();
    expect(musicBrainzId("discogs:master-1")).toBeNull();
    expect(musicBrainzId("not-a-release-group")).toBeNull();
    expect(musicBrainzId("")).toBeNull();
    expect(musicBrainzId("   ")).toBeNull();
    expect(musicBrainzId(null)).toBeNull();
    expect(musicBrainzId(undefined)).toBeNull();
  });
});
