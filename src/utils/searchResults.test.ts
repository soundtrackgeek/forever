import { describe, expect, it } from "vitest";
import type { PersonProfile, SearchResult } from "../types";
import { groupAlbumSources } from "./albumSources";
import { capResultsPerUser, createSearchPredicates, defaultAdvancedFilters, normalizeAdvancedFilters, sortSearchItems, type AdvancedSearchFilters } from "./searchResults";

const file = (patch: Partial<SearchResult> = {}): SearchResult => ({
  id: "one", title: "01 Song.flac", filename: "Music\\Album\\01 Song.flac", folder: "Music\\Album",
  owner: "Listener", subtitle: "Album", format: "FLAC", quality: "24 / 96", size: "50 MB", sizeBytes: 50_000_000,
  bitrate: 1200, sampleRate: 96000, bitDepth: 24, tracks: 1, trust: 100, rating: 5, ratingLabel: "Ready",
  availability: [], slotFree: true, queueLength: 0, averageSpeed: 1000, ...patch,
});
const matches = (patch: Partial<AdvancedSearchFilters> = {}) => createSearchPredicates("all", { ...defaultAdvancedFilters, ...patch }, () => null);

describe("search filters and ordering", () => {
  it.each([
    ["minimumBitrate", "bitrate", 1200], ["minimumSampleRate", "sampleRate", 96000], ["minimumBitDepth", "bitDepth", 24],
  ] as const)("uses inclusive %s and excludes absent metadata", (setting, field, value) => {
    const predicate = matches({ [setting]: value }).file;
    expect(predicate(file())).toBe(true);
    expect(predicate(file({ [field]: value - 1 }))).toBe(false);
    expect(predicate(file({ [field]: null }))).toBe(false);
  });
  it("combines slot, queue, inclusive decimal MB sizes, extensions and path exclusions", () => {
    const predicate = matches({ freeSlotOnly: true, maximumQueue: 0, minimumSizeMb: 50, maximumSizeMb: 50, extensions: ".FLAC, mp3", excludedWords: "live remaster" }).file;
    expect(predicate(file())).toBe(true);
    for (const patch of [{ slotFree: false }, { queueLength: 1 }, { queueLength: undefined }, { sizeBytes: undefined }, { sizeBytes: 50_000_001 }, { sizeBytes: 49_999_999 }, { filename: "Music/Live/Song.flac" }, { filename: "song.wav" }]) expect(predicate(file(patch))).toBe(false);
    expect(matches({ minimumSizeMb: 60, maximumSizeMb: 50 }).file(file())).toBe(false);
  });
  it("uses current People countries and blocked/ignored state, with explicit unknown matching", () => {
    const person = { countryCode: "NO", blocked: false, ignored: false } as PersonProfile;
    const predicate = createSearchPredicates("lossless", { ...defaultAdvancedFilters, countries: "no gb", hideBlockedIgnored: true }, () => person).file;
    expect(predicate(file())).toBe(true);
    person.ignored = true;
    expect(predicate(file())).toBe(false);
    person.ignored = false; person.blocked = true;
    expect(predicate(file())).toBe(false);
    expect(matches({ countries: "NO" }).file(file())).toBe(false);
    expect(matches({ countries: "unknown" }).file(file())).toBe(true);
    expect(createSearchPredicates("compressed", defaultAdvancedFilters, () => null).file(file())).toBe(false);
  });
  it("filters whole albums without dropping companions, discs, or lower-quality tracks", () => {
    const track = file();
    const companion = file({ id: "art", filename: "Music/Album/cover.jpg", format: "JPG", bitrate: null, sampleRate: null, bitDepth: null, sizeBytes: 1_000_000 });
    const source = groupAlbumSources([track, companion])[0];
    expect(matches({ minimumBitDepth: 24, extensions: "flac", minimumSizeMb: 51, maximumSizeMb: 51 }).source(source)).toBe(true);
    expect(source.files).toHaveLength(2);
    const mixed = groupAlbumSources([track, companion, file({ id: "two", filename: "Music/Album/02 Song.flac", bitDepth: 16 })])[0];
    expect(matches({ minimumBitDepth: 24 }).source(mixed)).toBe(false);
    expect(matches({ excludedWords: "cover" }).source(source)).toBe(false);
    expect(source.files).toContain(companion);
  });
  it("sorts stably, keeps unknown values last in either direction, then caps whole sources per user", () => {
    const items = [file({ id: "big", sizeBytes: 100, owner: "LISTENER" }), file({ id: "unknown", sizeBytes: undefined }), file({ id: "small", sizeBytes: 10 }), file({ id: "peer", owner: "other", sizeBytes: 10 })];
    expect(sortSearchItems(items, "small").map((item) => item.id)).toEqual(["small", "peer", "big", "unknown"]);
    expect(sortSearchItems(items, "large").map((item) => item.id)).toEqual(["big", "small", "peer", "unknown"]);
    expect(capResultsPerUser(sortSearchItems(items, "small"), 1).map((item) => item.id)).toEqual(["small", "peer"]);
    expect(sortSearchItems([file({ id: "low", sampleRate: 44100 }), file({ id: "hi" })], "qualityDesc")[0].id).toBe("hi");
    const sources = groupAlbumSources([file(), file({ id: "two", folder: "Music/Other" })]);
    expect(capResultsPerUser(sources, 1)).toEqual([sources[0]]);
    expect(items[0].id).toBe("big");
  });
  it("restores old presets with defaults and rejects invalid persisted filter values", () => {
    expect(normalizeAdvancedFilters(undefined)).toEqual(defaultAdvancedFilters);
    expect(normalizeAdvancedFilters({ minimumBitrate: -1, maximumQueue: "0", freeSlotOnly: "false", resultsPerUser: 2.9, minimumBitDepth: Infinity })).toEqual({ ...defaultAdvancedFilters, resultsPerUser: 2 });
    expect(defaultAdvancedFilters.albumsOnly).toBe(true);
    expect(normalizeAdvancedFilters({ albumsOnly: false, minimumAlbumTracks: 0.4 })).toEqual({ ...defaultAdvancedFilters, albumsOnly: false, minimumAlbumTracks: 1 });
    expect(normalizeAdvancedFilters({ albumsOnly: "yes", minimumAlbumTracks: -3 })).toEqual(defaultAdvancedFilters);
  });
});
