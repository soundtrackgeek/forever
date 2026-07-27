import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import type { AlbumArtist, AlbumCatalog, AlbumReleaseGroup } from "../types";
import { PREVIEW_DIAL_IDS } from "./useDialMemory";

const previewArtist: AlbumArtist = {
  id: "7249b899-8db8-43e7-9e6e-22f1e736024e",
  name: "Def Leppard",
  disambiguation: null,
  country: "GB",
  artistType: "Group",
  score: 100,
};

const previewAlbums: Array<Pick<AlbumReleaseGroup, "id" | "title" | "firstReleaseDate">> = [
  { id: "23434a86-e665-3722-8dae-214f0fb97f3a", title: "On Through the Night", firstReleaseDate: "1980-03-14" },
  { id: "419fa215-3740-3b1c-aa04-a209eab30789", title: "High ’n’ Dry", firstReleaseDate: "1981-07-11" },
  { id: "d77df681-b779-3d6d-b66a-3bfd15985e3e", title: "Pyromania", firstReleaseDate: "1983-01-20" },
  { id: "12fa3845-7c62-36e5-a8da-8be137155a72", title: "Hysteria", firstReleaseDate: "1987-08-03" },
  { id: "5b930454-b937-3d49-b26c-e82c4eded9bc", title: "Adrenalize", firstReleaseDate: "1992-03-23" },
  { id: "d58266a8-e00c-3a64-b7e1-549e28f772ee", title: "Slang", firstReleaseDate: "1996-05-10" },
  { id: "2dca8523-24e2-3a51-8bb4-038e979e689b", title: "Euphoria", firstReleaseDate: "1999-06-08" },
  { id: "233dec0f-611d-36c6-8675-90fb53707adb", title: "X", firstReleaseDate: "2002-07-24" },
];

const previewCatalog: AlbumCatalog = {
  artistId: previewArtist.id,
  truncated: false,
  albums: previewAlbums.map((album) => ({
    ...album,
    primaryType: "Album",
    secondaryTypes: [],
    coverArtUrl: `https://coverartarchive.org/release-group/${album.id}/front-250`,
  })),
};

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export type AlbumDiscoveryState = {
  artists: AlbumArtist[];
  selectedArtist: AlbumArtist | null;
  catalog: AlbumCatalog | null;
  loading: "idle" | "artists" | "catalog";
  error: string | null;
};

const idleState = (): AlbumDiscoveryState => ({
  artists: [],
  selectedArtist: null,
  catalog: null,
  loading: "idle",
  error: null,
});

export function useAlbumDiscovery(activeSessionId: string) {
  const native = isTauri();
  const [states, setStates] = useState<Record<string, AlbumDiscoveryState>>(() => native ? {} : {
    [PREVIEW_DIAL_IDS.defLeppard]: {
      artists: [previewArtist],
      selectedArtist: previewArtist,
      catalog: previewCatalog,
      loading: "idle",
      error: null,
    } satisfies AlbumDiscoveryState,
  } as Record<string, AlbumDiscoveryState>);
  const current = states[activeSessionId] ?? idleState();

  const patch = useCallback((sessionId: string, next: Partial<AlbumDiscoveryState>) => {
    setStates((all) => ({
      ...all,
      [sessionId]: { ...(all[sessionId] ?? idleState()), ...next },
    }));
  }, []);

  const loadArtist = useCallback(
    async (sessionId: string, artist: AlbumArtist) => {
      patch(sessionId, { selectedArtist: artist, catalog: null, loading: "catalog", error: null });
      try {
        const next = native
          ? await invoke<AlbumCatalog>("album_catalog", { artistId: artist.id })
          : previewCatalog;
        patch(sessionId, { catalog: next });
        return next;
      } catch (cause) {
        patch(sessionId, { error: errorMessage(cause) });
        throw cause;
      } finally {
        setStates((all) => ({
          ...all,
          [sessionId]: { ...(all[sessionId] ?? idleState()), loading: "idle" },
        }));
      }
    },
    [native, patch],
  );

  const selectArtist = useCallback(
    async (artist: AlbumArtist) => {
      return loadArtist(activeSessionId, artist);
    },
    [activeSessionId, loadArtist],
  );

  const searchArtists = useCallback(
    async (nextQuery: string) => {
      const normalized = nextQuery.trim();
      if (!normalized) return [];
      const sessionId = activeSessionId;
      patch(sessionId, {
        artists: [],
        selectedArtist: null,
        catalog: null,
        loading: "artists",
        error: null,
      });
      try {
        const next = native
          ? await invoke<AlbumArtist[]>("album_artists_search", { query: normalized })
          : [previewArtist];
        patch(sessionId, { artists: next });
        const first = next[0];
        const runnerUp = next[1];
        const exact = first?.name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0;
        if (first && (next.length === 1 || (exact && first.score > (runnerUp?.score ?? 0)))) {
          await loadArtist(sessionId, first);
        }
        return next;
      } catch (cause) {
        patch(sessionId, { error: errorMessage(cause) });
        throw cause;
      } finally {
        setStates((all) => {
          const existing = all[sessionId] ?? idleState();
          return existing.loading === "artists"
            ? { ...all, [sessionId]: { ...existing, loading: "idle" } }
            : all;
        });
      }
    },
    [activeSessionId, loadArtist, native, patch],
  );

  const clearError = useCallback(() => patch(activeSessionId, { error: null }), [activeSessionId, patch]);

  return useMemo(
    () => ({
      states,
      ...current,
      searchArtists,
      selectArtist,
      clearError,
    }),
    [clearError, current, searchArtists, selectArtist, states],
  );
}
