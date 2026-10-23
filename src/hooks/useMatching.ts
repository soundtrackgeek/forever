import { matchingCommand as invoke } from "../utils/matchingClient";
import { useEffect, useState } from "react";
import type { AlbumSource, AlbumTrack, FolderInspection, WantedPreferences } from "../types";
import { attachSources, rankingInput, type RankedSourceResponse } from "../utils/smartMatches";
import { inspectionTitles, type TracklistConfidence } from "../utils/tracklistConfidence";

// The serialized request is also the result identity. Old results disappear on
// the first render of new inputs, before the next effect has run.
export function useMatchingRequest<T>(command: string, request: string | null) {
  const [result, setResult] = useState<{ command: string; request: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (request === null) return;
    let current = true;
    void invoke<T>(command, JSON.parse(request)).then(
      (data) => { if (current) setResult({ command, request, data, error: null }); },
      (error: unknown) => { if (current) setResult({ command, request, data: null, error: String(error) }); },
    );
    return () => { current = false; };
  }, [command, request]);
  const current = result?.command === command && result?.request === request ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, pending: request !== null && current === null };
}

const emptyTracks: AlbumTrack[] = [];
export function useRankedSources(sources: AlbumSource[], preferences: WantedPreferences, officialTracks = emptyTracks, artist = "") {
  const request = sources.length ? JSON.stringify(rankingInput(sources, preferences, officialTracks, artist)) : null;
  const result = useMatchingRequest<RankedSourceResponse[]>("rank_album_sources", request);
  return { ...result, ranked: attachSources(result.data ?? [], sources) };
}

export function useInspectionConfidence(inspection: FolderInspection | null, officialTracks: AlbumTrack[], artist: string) {
  return useMatchingRequest<TracklistConfidence>("tracklist_confidence", inspection ? JSON.stringify({ sourceTitles: inspectionTitles(inspection), officialTracks, artist }) : null);
}
