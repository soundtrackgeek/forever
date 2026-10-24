import { invoke } from "@tauri-apps/api/core";

export type FilingSettings = { libraryRoot: string; namingTemplate: string; incompleteDirectory: string | null; embedArtwork: boolean };
export const defaultFilingSettings = (): FilingSettings => ({ libraryRoot: "", namingTemplate: "{albumartist}/{year} - {album}/{disc}{track:02} {title}", incompleteDirectory: null, embedArtwork: false });
export type TrackTags = { title: string; artist: string; albumArtist: string; album: string; date: string; disc: number; track: number; releaseGroupId: string | null; releaseId: string | null; recordingId: string | null };
export type TrackInput = { transferId: string; tags: TrackTags };
export type PlannedFile = { transferId: string; source: string; destination: string; backup: string; tags: TrackTags | null; before: [string, string][] };
export type FilingPlan = { id: string; releaseId: string; title: string; albumDirectory: string; files: PlannedFile[]; artworkBytes: number; artworkPreview?: string; warnings: string[]; beetsCommand: string };
export type FilingRecord = { plan: FilingPlan; state: "applying" | "filed" | "undoing" | "undone" };
export const filingApi = {
  notices: () => invoke<{ store: string; message: string }[]>("filing_notices"),
  history: () => invoke<FilingRecord[]>("filing_history"),
  metadata: (releaseGroupId: string, releaseId: string) => invoke<TrackTags[]>("filing_metadata", { releaseGroupId, releaseId }),
  preview: (request: { releaseId: string; settings: FilingSettings; tracks: TrackInput[]; artworkReleaseId: string | null }) => invoke<FilingPlan>("filing_preview", { request }),
  apply: (planId: string) => invoke<FilingRecord>("filing_apply", { planId }),
  undoPreview: (planId: string) => invoke<FilingRecord>("filing_undo_preview", { planId }),
  undo: (planId: string) => invoke<FilingRecord>("filing_undo", { planId }),
};
