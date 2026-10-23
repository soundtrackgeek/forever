import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchingCommand as invoke } from "./matchingClient";
import fixture from "../../fixtures/matching.json";
import type { AlbumSource, WantedPreferences } from "../types";
import { rankAlbumSources, rankingInput, wantedPreferencesLabel } from "./smartMatches";

vi.mock("./matchingClient", () => ({ matchingCommand: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });
const scenario = fixture.ranking[0];
const sources = scenario.sources.map((s) => ({ ...s, tracks: s.tracks.map((t) => ({ ...t, filename: t.name, title: "display title" })) })) as unknown as AlbumSource[];
const preferences = scenario.preferences as WantedPreferences;

describe("Rust ranking bridge", () => {
  it("sends raw filenames, preferences and the official tracklist without local scoring", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await rankAlbumSources(sources, preferences, scenario.officialTracks, scenario.artist);
    expect(invoke).toHaveBeenCalledWith("rank_album_sources", { sources: scenario.sources, preferences, officialTracks: scenario.officialTracks, artist: scenario.artist });
  });
  it("preserves backend order and attaches current source objects by id", async () => {
    vi.mocked(invoke).mockResolvedValue(scenario.ids.map((sourceId, i) => ({ sourceId, score: scenario.scores[i], eligible: scenario.eligible[i] })));
    const ranked = await rankAlbumSources(sources, preferences);
    expect(ranked.map((r) => r.source.id)).toEqual(scenario.ids);
    expect(ranked.map((r) => r.score)).toEqual(scenario.scores);
    expect(ranked[0].source).toBe(sources.find((s) => s.id === "exact"));
  });
  it("retains unknown bitrate and never substitutes a local recommendation on failure", async () => {
    const unknown = { ...sources[0], tracks: [{ ...sources[0].tracks[0], bitrate: undefined }] };
    expect(rankingInput([unknown], preferences).sources[0].tracks[0].bitrate).toBeNull();
    vi.mocked(invoke).mockRejectedValue(new Error("backend unavailable"));
    await expect(rankAlbumSources(sources, preferences)).rejects.toThrow("backend unavailable");
  });
  it("summarizes persisted preferences", () => {
    expect(wantedPreferencesLabel({ ...preferences, minimumTrackCount: 10 })).toBe("Prefer FLAC · 320+ kbps · 10+ tracks");
  });
});
