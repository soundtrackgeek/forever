import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AlbumReleaseGroup,
  RadarAlbumRequest,
  RadarAlbumScan,
  RadarEvent,
  RadarSnapshot,
  SearchResult,
} from "../types";
import { presentLiveSearchResult } from "./useSoulseekSearch";

const idleSnapshot: RadarSnapshot = {
  state: "idle",
  albums: [],
  activeAlbumId: null,
  completedCount: 0,
  totalCount: 0,
  message: "Shelf Radar is ready.",
  updatedAtMs: Date.now(),
};

const audioTracks = {
  Adrenalize: ["Let’s Get Rocked", "Heaven Is", "Make Love Like a Man", "Tonight", "White Lightning", "Stand Up", "Personal Property", "Have You Ever Needed Someone So Bad", "I Wanna Touch U", "Tear It Down"],
  Slang: ["Truth?", "Turn to Dust", "Slang", "All I Want Is Everything", "Work It Out", "Breathe a Sigh", "Deliver Me", "Gift of Flesh", "Blood Runs Cold", "Where Does Love Go When It Dies", "Pearl of Euphoria"],
} as const;

const previewSource = (
  album: keyof typeof audioTracks,
  owner: string,
  format: "FLAC" | "MP3",
  slotFree: boolean,
  queueLength: number,
  suffix: string,
): SearchResult[] => {
  const folder = `Music\\Def Leppard\\${album} ${suffix}`;
  return audioTracks[album].map((track, index) => ({
    id: `radar-preview-${album}-${owner}-${index}`,
    title: `${String(index + 1).padStart(2, "0")} - ${track}.${format.toLowerCase()}`,
    subtitle: folder.replace(/\\/g, " / "),
    owner,
    trust: slotFree ? 100 : 91,
    format,
    quality: format === "FLAC" ? "16 / 44.1" : "320 kbps",
    size: format === "FLAC" ? "36.4 MB" : "9.20 MB",
    tracks: 1,
    rating: slotFree ? 5 : 4,
    ratingLabel: slotFree ? "Ready" : `${queueLength} queued`,
    availability: [28, 34, 22, 39, 31, 42, 29, 37],
    source: "live",
    filename: `${folder}\\${String(index + 1).padStart(2, "0")} - ${track}.${format.toLowerCase()}`,
    folder,
    sizeBytes: format === "FLAC" ? 36_400_000 + index * 1_150_000 : 9_200_000 + index * 180_000,
    bitrate: format === "FLAC" ? 1_411 : 320,
    durationSeconds: 220 + ((index * 23) % 115),
    vbr: false,
    sampleRate: 44_100,
    bitDepth: format === "FLAC" ? 16 : null,
    slotFree,
    averageSpeed: owner === "rockvault" ? 8_400_000 : 4_600_000,
    queueLength,
    isPrivate: false,
  }));
};

const previewResults = new Map<string, SearchResult[]>([
  ["5b930454-b937-3d49-b26c-e82c4eded9bc", [
    ...previewSource("Adrenalize", "rockvault", "FLAC", true, 0, "(1992) [FLAC]"),
    ...previewSource("Adrenalize", "mirrorball", "MP3", false, 3, "[320]"),
  ]],
  ["d58266a8-e00c-3a64-b7e1-549e28f772ee", previewSource("Slang", "raretracks", "MP3", true, 0, "(1996) [320]")],
]);

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

const requestFor = (artist: string, album: AlbumReleaseGroup): RadarAlbumRequest => ({
  albumId: album.id,
  artist,
  title: album.title,
  firstReleaseDate: album.firstReleaseDate,
  coverArtUrl: album.coverArtUrl || null,
});

const queuedScan = (request: RadarAlbumRequest): RadarAlbumScan => ({
  ...request,
  state: "queued",
  resultCount: 0,
  peerCount: 0,
  startedAtMs: null,
  finishedAtMs: null,
  error: null,
});

export function useShelfRadar() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<RadarSnapshot>(idleSnapshot);
  const [scansById, setScansById] = useState<Map<string, RadarAlbumScan>>(new Map());
  const [resultsById, setResultsById] = useState<Map<string, SearchResult[]>>(new Map());
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const generation = useRef(0);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const mergeScans = useCallback((albums: RadarAlbumScan[]) => {
    setScansById((current) => {
      const next = new Map(current);
      albums.forEach((album) => next.set(album.albumId, album));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listen<RadarEvent>("forever://radar", (event) => {
      if (!mounted) return;
      setSnapshot(event.payload.snapshot);
      mergeScans(event.payload.snapshot.albums);
      if (event.payload.albumId && event.payload.results.length > 0) {
        const albumId = event.payload.albumId;
        setResultsById((current) => {
          const next = new Map(current);
          next.set(albumId, [
            ...(next.get(albumId) ?? []),
            ...event.payload.results.map(presentLiveSearchResult),
          ]);
          return next;
        });
      }
      if (event.payload.event === "error") setError(event.payload.snapshot.message);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });
    void invoke<RadarSnapshot>("radar_snapshot")
      .then((next) => {
        if (!mounted) return;
        setSnapshot(next);
        mergeScans(next.albums);
      })
      .catch((cause) => mounted && setError(errorMessage(cause)))
      .finally(() => mounted && setReady(true));
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [mergeScans, native]);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(async (artist: string, albums: AlbumReleaseGroup[]) => {
    const requests = albums.slice(0, 12).map((album) => requestFor(artist, album));
    if (requests.length === 0) throw new Error("Choose at least one missing album to scan.");
    clearTimers();
    setError(null);
    setResultsById((current) => {
      const next = new Map(current);
      requests.forEach((request) => next.delete(request.albumId));
      return next;
    });
    if (native) {
      try {
        const next = await invoke<RadarSnapshot>("radar_start", { albums: requests });
        setSnapshot(next);
        mergeScans(next.albums);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    }

    const currentGeneration = ++generation.current;
    const initialAlbums = requests.map(queuedScan);
    const started: RadarSnapshot = {
      state: "scanning",
      albums: initialAlbums,
      activeAlbumId: null,
      completedCount: 0,
      totalCount: requests.length,
      message: "Preparing a bounded Shelf Radar scan…",
      updatedAtMs: Date.now(),
    };
    setSnapshot(started);
    mergeScans(initialAlbums);
    requests.forEach((request, index) => {
      const base = index * 920;
      timers.current.push(window.setTimeout(() => {
        if (generation.current !== currentGeneration) return;
        setSnapshot((current) => {
          const albums = current.albums.map((album) => album.albumId === request.albumId ? { ...album, state: "scanning" as const, startedAtMs: Date.now() } : album);
          mergeScans(albums);
          return { ...current, albums, activeAlbumId: request.albumId, message: `Listening for ${request.title}…`, updatedAtMs: Date.now() };
        });
      }, base + 90));
      timers.current.push(window.setTimeout(() => {
        if (generation.current !== currentGeneration) return;
        const results = previewResults.get(request.albumId) ?? [];
        setResultsById((current) => new Map(current).set(request.albumId, results));
      }, base + 390));
      timers.current.push(window.setTimeout(() => {
        if (generation.current !== currentGeneration) return;
        setSnapshot((current) => {
          const results = previewResults.get(request.albumId) ?? [];
          const albums = current.albums.map((album) => album.albumId === request.albumId ? { ...album, state: "completed" as const, resultCount: results.length, peerCount: new Set(results.map((result) => result.owner)).size, finishedAtMs: Date.now() } : album);
          const completedCount = index + 1;
          const finished = completedCount === requests.length;
          mergeScans(albums);
          return { ...current, albums, activeAlbumId: null, completedCount, state: finished ? "completed" : "scanning", message: finished ? `Shelf Radar finished ${completedCount} albums.` : "Waiting briefly before the next album…", updatedAtMs: Date.now() };
        });
      }, base + 760));
    });
    return started;
  }, [clearTimers, mergeScans, native]);

  const stop = useCallback(async () => {
    clearTimers();
    generation.current += 1;
    if (native) {
      const next = await invoke<RadarSnapshot>("radar_stop");
      setSnapshot(next);
      mergeScans(next.albums);
      return next;
    }
    const stopped: RadarSnapshot = {
      ...snapshot,
      state: "stopped",
      activeAlbumId: null,
      message: "Shelf Radar scan stopped.",
      albums: snapshot.albums.map((album) => album.state === "completed" ? album : { ...album, state: "stopped" }),
      updatedAtMs: Date.now(),
    };
    setSnapshot(stopped);
    mergeScans(stopped.albums);
    return stopped;
  }, [clearTimers, mergeScans, native, snapshot]);

  return useMemo(() => ({
    ready,
    snapshot,
    scansByAlbumId: scansById,
    resultsByAlbumId: resultsById,
    error,
    start,
    stop,
    clearError: () => setError(null),
  }), [error, ready, resultsById, scansById, snapshot, start, stop]);
}
