import { matchingCommand as invoke } from "./matchingClient";
import type { AlbumTrack, FolderInspection } from "../types";
import { matchTolerance, type MatchTolerance } from "./matchTolerance";

export type TracklistConfidenceState =
  | "exact"
  | "completeWithExtras"
  | "durationMismatch"
  | "partial"
  | "unclear"
  | "unavailable";

export type TracklistTitleMatch = {
  official: AlbumTrack;
  sourceName: string;
  similarity: number;
  sourceDurationSeconds: number | null;
  durationDeltaMs: number | null;
  durationState: "matched" | "mismatch" | "unknown";
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
  durationMatchedCount: number;
  durationMismatchCount: number;
  durationUnknownCount: number;
  durationAgreement: number;
};

type SourceTitle = {
  id: string;
  name: string;
  durationSeconds?: number | null;
};

export function tracklistConfidenceForTitles(sourceTitles: SourceTitle[], officialTracks: AlbumTrack[], artist = "", tolerance: MatchTolerance = matchTolerance()): Promise<TracklistConfidence> {
  return invoke("tracklist_confidence", { sourceTitles, officialTracks, artist, tolerance });
}

const audioExtensions = ["aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "wma", "wv"];
export const inspectionAudioFiles = (inspection: FolderInspection) =>
  inspection.files.filter((file) => audioExtensions.includes(file.extension.toLowerCase()));

export function inspectionTitles(inspection: FolderInspection) {
  return inspectionAudioFiles(inspection)
    .map((file) => ({ id: file.remoteFilename, name: file.filename, durationSeconds: file.durationSeconds ?? null }));
}

export const tracklistConfidenceForInspection = (inspection: FolderInspection, officialTracks: AlbumTrack[], artist = "", tolerance?: MatchTolerance) =>
  tracklistConfidenceForTitles(inspectionTitles(inspection), officialTracks, artist, tolerance);

export const durationEvidence = (match: TracklistTitleMatch) => {
  if (match.durationDeltaMs == null) return "Length unknown";
  const delta = match.durationDeltaMs / 1000;
  const difference = (delta > 0 ? "+" : "") + Number(delta.toFixed(1)) + "s";
  return match.durationState === "matched" ? "Length agrees (" + difference + ")" : "Length differs (" + difference + ")";
};
