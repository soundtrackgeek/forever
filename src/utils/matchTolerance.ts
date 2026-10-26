import { defaultSmartDownloads, getSettingsState } from "../settings";

/** How far a track's length may drift from MusicBrainz before it counts as different. */
export type MatchTolerance = { durationSeconds: number; allowedMismatches: number };

// Read at call time so every ranking and tracklist check uses the same window
// the user last saved, without threading settings through each caller.
export function matchTolerance(): MatchTolerance {
  const smart = getSettingsState().settings.wanted?.smart ?? defaultSmartDownloads();
  return { durationSeconds: smart.durationToleranceSeconds, allowedMismatches: smart.allowedLengthMismatches };
}
