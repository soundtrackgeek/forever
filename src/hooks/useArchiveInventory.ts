import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AlbumReleaseGroup,
  ArchiveAlbumMatch,
  ArchiveMatchResponse,
  ArchiveStatus,
  WantedAlbum,
} from "../types";

const previewStatus: ArchiveStatus = {
  path: "C:\\Users\\jtill\\AppData\\Roaming\\com.local.musiclibrary\\music-library.sqlite3",
  connected: true,
  readOnly: true,
  albumCount: 72_366,
  trackCount: 1_101_878,
  lastImportedAt: "2026-07-25T17:42:35.615290100+00:00",
  lastModifiedAtMs: Date.UTC(2026, 6, 26, 14, 32, 4),
  error: null,
};

const previewOwnedIds = new Set([
  "23434a86-e665-3722-8dae-214f0fb97f3a",
  "d77df681-b779-3d6d-b66a-3bfd15985e3e",
  "12fa3845-7c62-36e5-a8da-8be137155a72",
]);

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const previewMatch = (album: AlbumReleaseGroup): ArchiveAlbumMatch => {
  const owned = previewOwnedIds.has(album.id);
  return {
    albumId: album.id,
    ownership: owned ? "owned" : "notOwned",
    localAlbumId: owned ? `preview-${album.id}` : null,
    localTitle: owned ? album.title : null,
    localArtist: owned ? "Def Leppard" : null,
    localYear: owned ? Number(album.firstReleaseDate.slice(0, 4)) || null : null,
    trackCount: owned ? (album.title === "Hysteria" ? 12 : 10) : null,
  };
};

export function useArchiveInventory(
  artist: string | null,
  albums: AlbumReleaseGroup[],
  wantedAlbums: WantedAlbum[],
) {
  const native = isTauri();
  const [status, setStatus] = useState<ArchiveStatus | null>(null);
  const [matches, setMatches] = useState<ArchiveAlbumMatch[]>([]);
  const [wantedMatches, setWantedMatches] = useState<ArchiveAlbumMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const wantedQueryKey = useMemo(
    () => wantedAlbums
      .map((album) => `${album.albumId}\u0000${album.artist}\u0000${album.title}\u0000${album.firstReleaseDate}`)
      .join("\u0001"),
    [wantedAlbums],
  );
  const wantedQueries = useMemo(
    () => wantedQueryKey
      ? wantedQueryKey.split("\u0001").map((entry) => {
          const [id, wantedArtist, title, firstReleaseDate] = entry.split("\u0000");
          return { id, artist: wantedArtist, title, firstReleaseDate };
        })
      : [],
    [wantedQueryKey],
  );

  const readStatus = useCallback(
    async () => (native ? await invoke<ArchiveStatus>("archive_status") : previewStatus),
    [native],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await readStatus();
      setStatus(next);
      if (next.error) setError(next.error);
      setRevision((current) => current + 1);
      return next;
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [readStatus]);

  useEffect(() => {
    let current = true;
    void readStatus()
      .then((next) => {
        if (!current) return;
        setStatus(next);
        setError(next.error);
      })
      .catch((cause) => {
        if (current) setError(message(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [readStatus]);

  useEffect(() => {
    let current = true;
    if (!artist || albums.length === 0) {
      void Promise.resolve().then(() => {
        if (!current) return;
        setMatches([]);
        setMatching(false);
      });
      return () => {
        current = false;
      };
    }

    const load = async () => {
      setMatching(true);
      try {
        const response = native
          ? await invoke<ArchiveMatchResponse>("archive_match_albums", {
              artist,
              albums: albums.map((album) => ({
                id: album.id,
                title: album.title,
                firstReleaseDate: album.firstReleaseDate,
              })),
            })
          : {
              source: previewStatus,
              matches: albums.map(previewMatch),
            };
        if (!current) return;
        setStatus(response.source);
        setMatches(response.matches);
        setError(response.source.error);
      } catch (cause) {
        if (!current) return;
        setMatches([]);
        setError(message(cause));
      } finally {
        if (current) setMatching(false);
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, [albums, artist, native, revision]);

  useEffect(() => {
    let current = true;
    if (!wantedQueryKey) {
      void Promise.resolve().then(() => {
        if (current) setWantedMatches([]);
      });
      return () => {
        current = false;
      };
    }
    void (native
      ? invoke<ArchiveMatchResponse>("archive_match_wanted", { albums: wantedQueries })
      : Promise.resolve({
          source: previewStatus,
          matches: wantedQueries.map((album) => {
            const owned = album.title === "Hysteria";
            return {
              albumId: album.id,
              ownership: owned ? "owned" as const : "notOwned" as const,
              localAlbumId: owned ? `preview-${album.id}` : null,
              localTitle: owned ? album.title : null,
              localArtist: owned ? album.artist : null,
              localYear: owned ? Number(album.firstReleaseDate.slice(0, 4)) || null : null,
              trackCount: owned ? 12 : null,
            };
          }),
        }))
      .then((response) => {
        if (!current) return;
        setWantedMatches(response.matches);
        setStatus(response.source);
      })
      .catch((cause) => {
        if (current) setError(message(cause));
      });
    return () => {
      current = false;
    };
  }, [native, revision, wantedQueries, wantedQueryKey]);

  const matchByAlbumId = useMemo(
    () => new Map(matches.map((match) => [match.albumId, match])),
    [matches],
  );
  const wantedMatchByAlbumId = useMemo(
    () => new Map(wantedMatches.map((match) => [match.albumId, match])),
    [wantedMatches],
  );

  return useMemo(
    () => ({
      status,
      loading,
      matching,
      error,
      matchByAlbumId,
      wantedMatchByAlbumId,
      refresh,
    }),
    [error, loading, matchByAlbumId, matching, refresh, status, wantedMatchByAlbumId],
  );
}
