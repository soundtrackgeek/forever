import { matchingCommand as invoke } from "./matchingClient";
import type { AlbumTrack, FolderInspection } from "../types";

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

export function tracklistConfidenceForTitles(sourceTitles: SourceTitle[], officialTracks: AlbumTrack[], artist = ""): Promise<TracklistConfidence> {
  return invoke("tracklist_confidence", { sourceTitles, officialTracks, artist });
}

export function inspectionTitles(inspection: FolderInspection) {
  return inspection.files.filter((file) => ["aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "wma", "wv"].includes(file.extension.toLowerCase()))
    .map((file) => ({ id: file.remoteFilename, name: file.filename }));
}

export const tracklistConfidenceForInspection = (inspection: FolderInspection, officialTracks: AlbumTrack[], artist = "") =>
  tracklistConfidenceForTitles(inspectionTitles(inspection), officialTracks, artist);
