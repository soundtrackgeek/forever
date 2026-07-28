import type { AlbumSource, AlbumTrack, FolderInspection } from "../types";

const AUDIO_EXTENSIONS = new Set([
  "aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "wma", "wv",
]);

export type TracklistConfidenceState =
  | "exact"
  | "completeWithExtras"
  | "partial"
  | "unclear"
  | "unavailable";

export type TracklistTitleMatch = {
  official: AlbumTrack;
  sourceName: string;
  similarity: number;
};

export type TracklistConfidence = {
  state: TracklistConfidenceState;
  label: string;
  summary: string;
  matchedCount: number;
  officialCount: number;
  sourceCount: number;
  missingTracks: AlbumTrack[];
  extraSourceNames: string[];
  matches: TracklistTitleMatch[];
  safeToRecommend: boolean;
  score: number;
};

type SourceTitle = {
  id: string;
  name: string;
};

const basename = (value: string) =>
  value.split(/[\\/]/).filter(Boolean).pop() ?? value;

const normalizeWords = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

export const normalizeTrackTitle = (value: string, artist = "") => {
  let title = basename(value)
    .replace(/\.[^.]+$/, "")
    .replace(/^(?:(?:disc|disk|cd)\s*\d+[\s._-]*)?(?:\d{1,3}\s*[-._]\s*\d{1,3}|\d{1,3})(?:\s*[-._)]\s*|\s+)/i, "")
    .replace(/\s*(?:\(|\[)(?:(?:19|20)\d{2}\s+remaster(?:ed)?|remaster(?:ed)?(?:\s+(?:19|20)\d{2})?)(?:\)|\])\s*$/i, "")
    .trim();
  const normalizedArtist = normalizeWords(artist);
  const normalizedTitle = normalizeWords(title);
  if (normalizedArtist && normalizedTitle.startsWith(`${normalizedArtist} `)) {
    title = normalizedTitle.slice(normalizedArtist.length).trim();
  }
  return normalizeWords(title);
};

const bigrams = (value: string) => {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
};

const titleSimilarity = (left: string, right: string) => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length >= 5 && longer.includes(shorter)) return 0.92;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = sharedTokens / Math.max(leftTokens.size, rightTokens.size, 1);
  const rightBigrams = bigrams(right);
  const available = new Map<string, number>();
  for (const pair of rightBigrams) available.set(pair, (available.get(pair) ?? 0) + 1);
  let sharedBigrams = 0;
  for (const pair of bigrams(left)) {
    const count = available.get(pair) ?? 0;
    if (count > 0) {
      sharedBigrams += 1;
      available.set(pair, count - 1);
    }
  }
  const bigramScore = (2 * sharedBigrams) / Math.max(bigrams(left).length + rightBigrams.length, 1);
  return tokenScore * 0.4 + bigramScore * 0.6;
};

export function tracklistConfidenceForTitles(
  sourceTitles: SourceTitle[],
  officialTracks: AlbumTrack[],
  artist = "",
): TracklistConfidence {
  if (officialTracks.length === 0) {
    return {
      state: "unavailable",
      label: "Track count only",
      summary: "Official tracklist unavailable",
      matchedCount: 0,
      officialCount: 0,
      sourceCount: sourceTitles.length,
      missingTracks: [],
      extraSourceNames: [],
      matches: [],
      safeToRecommend: true,
      score: 0,
    };
  }

  const candidates = sourceTitles.flatMap((source) => {
    const sourceKey = normalizeTrackTitle(source.name, artist);
    return officialTracks.flatMap((official) => {
      const similarity = titleSimilarity(sourceKey, normalizeTrackTitle(official.title));
      return similarity >= 0.78 ? [{ source, official, similarity }] : [];
    });
  }).sort((left, right) => right.similarity - left.similarity);

  const usedSources = new Set<string>();
  const usedOfficial = new Set<number>();
  const matches: TracklistTitleMatch[] = [];
  for (const candidate of candidates) {
    if (usedSources.has(candidate.source.id) || usedOfficial.has(candidate.official.position)) continue;
    usedSources.add(candidate.source.id);
    usedOfficial.add(candidate.official.position);
    matches.push({
      official: candidate.official,
      sourceName: basename(candidate.source.name),
      similarity: candidate.similarity,
    });
  }
  matches.sort((left, right) => left.official.position - right.official.position);

  const missingTracks = officialTracks.filter((track) => !usedOfficial.has(track.position));
  const extraSourceNames = sourceTitles
    .filter((source) => !usedSources.has(source.id))
    .map((source) => basename(source.name));
  const matchedCount = matches.length;
  const officialCount = officialTracks.length;
  const sourceCount = sourceTitles.length;
  const complete = matchedCount === officialCount;
  const state: TracklistConfidenceState = complete
    ? extraSourceNames.length > 0 ? "completeWithExtras" : "exact"
    : matchedCount === 0 || matchedCount / officialCount < 0.5
      ? "unclear"
      : "partial";
  const safeToRecommend = state === "exact" || state === "completeWithExtras";
  const label = state === "exact"
    ? "Exact tracklist"
    : state === "completeWithExtras"
      ? `Complete · ${extraSourceNames.length} extra`
      : state === "partial"
        ? `${missingTracks.length} missing`
        : "Unclear match";
  const summary = state === "completeWithExtras"
    ? `${matchedCount}/${officialCount} titles matched · ${extraSourceNames.length} extra`
    : `${matchedCount}/${officialCount} titles matched`;
  const score = state === "exact"
    ? 6_000
    : state === "completeWithExtras"
      ? Math.max(4_500, 5_400 - extraSourceNames.length * 60)
      : state === "partial"
        ? Math.round((matchedCount / officialCount) * 2_500)
        : 0;

  return {
    state,
    label,
    summary,
    matchedCount,
    officialCount,
    sourceCount,
    missingTracks,
    extraSourceNames,
    matches,
    safeToRecommend,
    score,
  };
}

export const tracklistConfidenceForSource = (
  source: AlbumSource,
  officialTracks: AlbumTrack[],
  artist = "",
) => tracklistConfidenceForTitles(
  source.tracks.map((track) => ({
    id: track.id,
    name: track.filename ?? track.title,
  })),
  officialTracks,
  artist,
);

export const tracklistConfidenceForInspection = (
  inspection: FolderInspection,
  officialTracks: AlbumTrack[],
  artist = "",
) => tracklistConfidenceForTitles(
  inspection.files
    .filter((file) => AUDIO_EXTENSIONS.has(file.extension.toLocaleLowerCase()))
    .map((file) => ({ id: file.remoteFilename, name: file.filename })),
  officialTracks,
  artist,
);
