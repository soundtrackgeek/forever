import type { AlbumSource, PersonProfile, SearchResult } from "../types";

export type SearchFilter = "all" | "lossless" | "compressed";
export const sortLabels = {
  best: "Best match", ready: "Ready first", busy: "Longest queue first",
  fast: "Fastest first", slow: "Slowest first", small: "Smallest first", large: "Largest first",
  nameAsc: "Name A–Z", nameDesc: "Name Z–A", userAsc: "User A–Z", userDesc: "User Z–A",
  qualityDesc: "Highest quality first", qualityAsc: "Lowest quality first",
  tracksDesc: "Most tracks first", tracksAsc: "Fewest tracks first",
  formatAsc: "Format A–Z", formatDesc: "Format Z–A",
} as const;
export type SearchSort = keyof typeof sortLabels;
export type AdvancedSearchFilters = {
  minimumBitrate: number | null;
  minimumSampleRate: number | null;
  minimumBitDepth: number | null;
  freeSlotOnly: boolean;
  maximumQueue: number | null;
  minimumSizeMb: number | null;
  maximumSizeMb: number | null;
  extensions: string;
  excludedWords: string;
  countries: string;
  hideBlockedIgnored: boolean;
  resultsPerUser: number | null;
};
export const defaultAdvancedFilters: AdvancedSearchFilters = {
  minimumBitrate: null, minimumSampleRate: null, minimumBitDepth: null,
  freeSlotOnly: false, maximumQueue: null, minimumSizeMb: null, maximumSizeMb: null,
  extensions: "", excludedWords: "", countries: "", hideBlockedIgnored: false, resultsPerUser: null,
};

// Older pinned presets have no advanced settings. Never trust persisted values.
export function normalizeAdvancedFilters(value: unknown): AdvancedSearchFilters {
  const result = { ...defaultAdvancedFilters };
  if (!value || typeof value !== "object") return result;
  const data = value as Record<string, unknown>;
  for (const key of ["minimumBitrate", "minimumSampleRate", "minimumBitDepth", "maximumQueue", "minimumSizeMb", "maximumSizeMb", "resultsPerUser"] as const) {
    const number = data[key];
    result[key] = typeof number === "number" && Number.isFinite(number) && number >= 0
      ? key === "resultsPerUser" ? Math.max(1, Math.floor(number)) : number : null;
  }
  for (const key of ["extensions", "excludedWords", "countries"] as const) {
    result[key] = typeof data[key] === "string" ? data[key].slice(0, 500) : "";
  }
  result.freeSlotOnly = data.freeSlotOnly === true;
  result.hideBlockedIgnored = data.hideBlockedIgnored === true;
  return result;
}

export const losslessFormats = new Set(["FLAC", "ALAC", "WAV", "AIF", "AIFF", "APE", "WV"]);
export const compressedFormats = new Set(["MP3", "AAC", "M4A", "OGG", "OGA", "OPUS", "WMA"]);
const tokens = (value: string) => value.toLowerCase().split(/[\s,;]+/).filter(Boolean);
const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const atLeast = (value: number | null | undefined, minimum: number | null) => minimum === null || (known(value) && value >= minimum);
const atMost = (value: number | null | undefined, maximum: number | null) => maximum === null || (known(value) && value <= maximum);
export type PersonLookup = (username: string) => PersonProfile | null;

export function createSearchPredicates(filter: SearchFilter, settings: AdvancedSearchFilters, personByUsername: PersonLookup) {
  const extensions = new Set(tokens(settings.extensions).map((token) => token.replace(/^\./, "")));
  const countries = new Set(tokens(settings.countries));
  const excluded = tokens(settings.excludedWords);
  const personMatches = (owner: string) => {
    const person = personByUsername(owner);
    return !(settings.hideBlockedIgnored && (person?.blocked || person?.ignored)) &&
      (!countries.size || countries.has(person?.countryCode?.toLowerCase() || "unknown"));
  };
  const pathMatches = (file: SearchResult) => {
    const path = `${file.folder ?? ""} ${file.filename ?? file.title}`.toLowerCase();
    return !excluded.some((word) => path.includes(word));
  };
  const qualityMatches = (file: SearchResult) => {
    const format = file.format.toUpperCase();
    const extension = (file.filename?.match(/\.([^./\\]+)$/)?.[1] ?? file.format).toLowerCase();
    return (filter === "all" || (filter === "lossless" ? losslessFormats : compressedFormats).has(format)) &&
      (!extensions.size || extensions.has(extension)) &&
      atLeast(file.bitrate, settings.minimumBitrate) &&
      atLeast(file.sampleRate, settings.minimumSampleRate) &&
      atLeast(file.bitDepth, settings.minimumBitDepth);
  };
  const sizeMatches = (bytes: number | undefined) =>
    atLeast(bytes, settings.minimumSizeMb === null ? null : settings.minimumSizeMb * 1_000_000) &&
    atMost(bytes, settings.maximumSizeMb === null ? null : settings.maximumSizeMb * 1_000_000);
  return {
    file: (file: SearchResult) => personMatches(file.owner) && pathMatches(file) && qualityMatches(file) &&
      (!settings.freeSlotOnly || file.slotFree === true) && atMost(file.queueLength, settings.maximumQueue) && sizeMatches(file.sizeBytes),
    // Evaluate complete sources, then retain every original file (including artwork).
    // An active quality constraint must hold for every returned audio track.
    source: (source: AlbumSource) => personMatches(source.owner) && source.files.every(pathMatches) &&
      (source.tracks.length ? source.tracks.every(qualityMatches) : filter === "all" && !extensions.size &&
        settings.minimumBitrate === null && settings.minimumSampleRate === null && settings.minimumBitDepth === null) &&
      (!settings.freeSlotOnly || source.slotFree) &&
      (settings.maximumQueue === null || source.files.every((file) => atMost(file.queueLength, settings.maximumQueue))) &&
      sizeMatches(source.files.every((file) => known(file.sizeBytes)) ? source.totalSizeBytes : undefined),
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const numberOrder = (a: number | null | undefined, b: number | null | undefined, descending = false) =>
  !known(a) ? !known(b) ? 0 : 1 : !known(b) ? -1 : (a - b) * (descending ? -1 : 1);
const minimum = (files: SearchResult[], key: "sampleRate" | "bitDepth" | "bitrate") =>
  files.length && files.every((file) => known(file[key])) ? Math.min(...files.map((file) => file[key]!)) : null;

export function sortSearchItems<T extends SearchResult | AlbumSource>(items: T[], sort: SearchSort): T[] {
  if (sort === "best") return items;
  // Cache sort facts once per item, rather than scanning album tracks in comparisons.
  const facts = items.map((item, index) => {
    const source = "files" in item;
    return {
      item, index, name: source ? item.folderName : item.title, owner: item.owner,
      size: source ? item.files.every((file) => known(file.sizeBytes)) ? item.totalSizeBytes : null : item.sizeBytes,
      tracks: source ? item.tracks.length : item.tracks,
      format: source ? item.formats.join(", ") : item.format,
      sampleRate: source ? minimum(item.tracks, "sampleRate") : item.sampleRate,
      bitDepth: source ? minimum(item.tracks, "bitDepth") : item.bitDepth,
      bitrate: source ? minimum(item.tracks, "bitrate") : item.bitrate,
    };
  });
  facts.sort((a, b) => {
    let order: number;
    if (sort === "nameAsc" || sort === "nameDesc") order = collator.compare(a.name, b.name) * (sort === "nameDesc" ? -1 : 1);
    else if (sort === "userAsc" || sort === "userDesc") order = collator.compare(a.owner, b.owner) * (sort === "userDesc" ? -1 : 1);
    else if (sort === "formatAsc" || sort === "formatDesc") order = collator.compare(a.format, b.format) * (sort === "formatDesc" ? -1 : 1);
    else if (sort === "small" || sort === "large") order = numberOrder(a.size, b.size, sort === "large");
    else if (sort === "fast" || sort === "slow") order = numberOrder(a.item.averageSpeed, b.item.averageSpeed, sort === "fast");
    else if (sort === "tracksAsc" || sort === "tracksDesc") order = numberOrder(a.tracks, b.tracks, sort === "tracksDesc");
    else if (sort === "qualityAsc" || sort === "qualityDesc") order =
      numberOrder(a.sampleRate, b.sampleRate, sort === "qualityDesc") ||
      numberOrder(a.bitDepth, b.bitDepth, sort === "qualityDesc") || numberOrder(a.bitrate, b.bitrate, sort === "qualityDesc");
    else order = numberOrder(a.item.slotFree === undefined ? null : Number(a.item.slotFree), b.item.slotFree === undefined ? null : Number(b.item.slotFree), sort === "ready") ||
      numberOrder(a.item.queueLength, b.item.queueLength, sort === "busy");
    return order || a.index - b.index;
  });
  return facts.map(({ item }) => item);
}

export function capResultsPerUser<T extends { owner: string }>(items: T[], cap: number | null): T[] {
  if (cap === null) return items;
  const counts = new Map<string, number>();
  return items.filter((item) => {
    const owner = item.owner.toLowerCase();
    const count = (counts.get(owner) ?? 0) + 1;
    counts.set(owner, count);
    return count <= cap;
  });
}
