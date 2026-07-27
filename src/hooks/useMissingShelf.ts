import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AlbumArtist,
  AlbumCatalog,
  AlbumReleaseGroup,
  ArchiveAlbumMatch,
  ArchiveArtistSummary,
  ArchiveArtistsResponse,
  ArchiveCachedCatalog,
  ArchiveMatchResponse,
} from "../types";

const defLeppardId = "7249b899-8db8-43e7-9e6e-22f1e736024e";
const previewArtists: ArchiveArtistSummary[] = [
  { name: "Def Leppard", ownedAlbumCount: 8, firstYear: 1980, lastYear: 2022, artistId: defLeppardId, canonicalName: "Def Leppard", cachedReleaseCount: 14, catalogFetchedAt: "2026-07-26T16:42:00Z" },
  { name: "Queen", ownedAlbumCount: 19, firstYear: 1973, lastYear: 1995, artistId: "0383dadf-2a4e-4d10-a46a-e9e041da8eb3", canonicalName: "Queen", cachedReleaseCount: 21, catalogFetchedAt: "2026-07-25T14:10:00Z" },
  { name: "KISS", ownedAlbumCount: 20, firstYear: 1974, lastYear: 2012, artistId: "e1f1e33e-2e4c-4c7c-b420-3b58f63d4c84", canonicalName: "KISS", cachedReleaseCount: 27, catalogFetchedAt: "2026-07-24T09:20:00Z" },
  { name: "Engine Alley", ownedAlbumCount: 3, firstYear: 1992, lastYear: 1996, artistId: null, canonicalName: null, cachedReleaseCount: 0, catalogFetchedAt: null },
];

const release = (
  id: string,
  title: string,
  year: string,
  primaryType = "Album",
  secondaryTypes: string[] = [],
): AlbumReleaseGroup => ({
  id,
  title,
  firstReleaseDate: year,
  primaryType,
  secondaryTypes,
  coverArtUrl: `https://coverartarchive.org/release-group/${id}/front-250`,
});

const previewAlbums: AlbumReleaseGroup[] = [
  release("23434a86-e665-3722-8dae-214f0fb97f3a", "On Through the Night", "1980-03-14"),
  release("419fa215-3740-3b1c-aa04-a209eab30789", "High ’n’ Dry", "1981-07-11"),
  release("d77df681-b779-3d6d-b66a-3bfd15985e3e", "Pyromania", "1983-01-20"),
  release("12fa3845-7c62-36e5-a8da-8be137155a72", "Hysteria", "1987-08-03"),
  release("5b930454-b937-3d49-b26c-e82c4eded9bc", "Adrenalize", "1992-03-23"),
  release("d58266a8-e00c-3a64-b7e1-549e28f772ee", "Slang", "1996-05-10"),
  release("2dca8523-24e2-3a51-8bb4-038e979e689b", "Euphoria", "1999-06-08"),
  release("233dec0f-611d-36c6-8675-90fb53707adb", "X", "2002-07-24"),
  release("preview-songs-sparkle", "Songs From the Sparkle Lounge", "2008-04-25"),
  release("preview-diamond", "Diamond Star Halos", "2022-05-27"),
  release("preview-viva-live", "Viva! Hysteria", "2013", "Album", ["Live"]),
  release("preview-vault", "Vault: Greatest Hits", "1995", "Album", ["Compilation"]),
  release("preview-ep", "The Def Leppard E.P.", "1979", "EP"),
];

const previewOwnedIds = new Set([
  "23434a86-e665-3722-8dae-214f0fb97f3a",
  "d77df681-b779-3d6d-b66a-3bfd15985e3e",
  "12fa3845-7c62-36e5-a8da-8be137155a72",
]);

const previewCatalog: AlbumCatalog = {
  artistId: defLeppardId,
  albums: previewAlbums,
  truncated: false,
};

const previewMatches = previewAlbums.map<ArchiveAlbumMatch>((album) => ({
  albumId: album.id,
  ownership: previewOwnedIds.has(album.id) ? "owned" : "notOwned",
  localAlbumId: previewOwnedIds.has(album.id) ? `preview-${album.id}` : null,
  localTitle: previewOwnedIds.has(album.id) ? album.title : null,
  localArtist: previewOwnedIds.has(album.id) ? "Def Leppard" : null,
  localYear: previewOwnedIds.has(album.id) ? Number(album.firstReleaseDate.slice(0, 4)) : null,
  trackCount: previewOwnedIds.has(album.id) ? (album.title === "Hysteria" ? 12 : 10) : null,
}));

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export type MissingShelfLoading = "idle" | "artists" | "identity" | "catalog";

type CachedComparison = {
  catalog: AlbumCatalog;
  matches: ArchiveAlbumMatch[];
  source: "archiveCache" | "musicbrainz";
  fetchedAt: string | null;
};

export function useMissingShelf() {
  const native = isTauri();
  const [activated, setActivated] = useState(!native);
  const [query, setQuery] = useState("");
  const [artists, setArtists] = useState<ArchiveArtistSummary[]>(native ? [] : previewArtists);
  const [artistsTruncated, setArtistsTruncated] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<ArchiveArtistSummary | null>(native ? null : previewArtists[0]);
  const [identityOptions, setIdentityOptions] = useState<AlbumArtist[]>([]);
  const [catalog, setCatalog] = useState<AlbumCatalog | null>(native ? null : previewCatalog);
  const [matches, setMatches] = useState<ArchiveAlbumMatch[]>(native ? [] : previewMatches);
  const [catalogSource, setCatalogSource] = useState<"archiveCache" | "musicbrainz" | null>(native ? null : "archiveCache");
  const [catalogFetchedAt, setCatalogFetchedAt] = useState<string | null>(native ? null : previewArtists[0].catalogFetchedAt);
  const [loading, setLoading] = useState<MissingShelfLoading>("idle");
  const [error, setError] = useState<string | null>(null);
  const comparisons = useRef(new Map<string, CachedComparison>());

  const loadArtists = useCallback(async (nextQuery: string) => {
    const normalized = nextQuery.trim();
    setQuery(normalized);
    setLoading("artists");
    setError(null);
    try {
      const response = native
        ? await invoke<ArchiveArtistsResponse>("archive_artists", { query: normalized })
        : {
            source: null,
            artists: previewArtists.filter((artist) => artist.name.toLowerCase().includes(normalized.toLowerCase())),
            truncated: false,
          };
      setArtists(response.artists);
      setArtistsTruncated(response.truncated);
      setActivated(true);
      return response.artists;
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setLoading("idle");
    }
  }, [native]);

  const matchCatalog = useCallback(async (artist: string, nextCatalog: AlbumCatalog) => {
    const response = native
      ? await invoke<ArchiveMatchResponse>("archive_match_albums", {
          artist,
          albums: nextCatalog.albums.map((album) => ({
            id: album.id,
            title: album.title,
            firstReleaseDate: album.firstReleaseDate,
          })),
        })
      : { source: null, matches: previewMatches };
    setMatches(response.matches);
    return response.matches;
  }, [native]);

  const loadCatalog = useCallback(async (
    artist: ArchiveArtistSummary,
    identity?: AlbumArtist,
  ) => {
    setSelectedArtist(artist);
    setIdentityOptions([]);
    setCatalog(null);
    setMatches([]);
    setError(null);
    const artistId = identity?.id ?? artist.artistId;
    if (!artistId) {
      setLoading("identity");
      try {
        const options = native
          ? await invoke<AlbumArtist[]>("album_artists_search", { query: artist.name })
          : [{ id: defLeppardId, name: artist.name, disambiguation: null, country: null, artistType: "Group", score: 100 }];
        setIdentityOptions(options);
        if (options.length === 0) setError("MusicBrainz did not return an identity for this artist.");
        return null;
      } catch (cause) {
        setError(message(cause));
        throw cause;
      } finally {
        setLoading("idle");
      }
    }
    const cacheKey = `${artist.name.toLowerCase()}\u0000${artistId.toLowerCase()}`;
    const cachedComparison = comparisons.current.get(cacheKey);
    if (cachedComparison) {
      setCatalog(cachedComparison.catalog);
      setMatches(cachedComparison.matches);
      setCatalogSource(cachedComparison.source);
      setCatalogFetchedAt(cachedComparison.fetchedAt);
      return cachedComparison.catalog;
    }
    setLoading("catalog");
    try {
      let nextCatalog: AlbumCatalog;
      let nextSource: "archiveCache" | "musicbrainz";
      let nextFetchedAt: string | null;
      if (!identity && artist.cachedReleaseCount > 0) {
        const cached = native
          ? await invoke<ArchiveCachedCatalog>("archive_cached_catalog", { artistId })
          : { catalog: previewCatalog, fetchedAt: artist.catalogFetchedAt };
        nextCatalog = cached.catalog;
        nextSource = "archiveCache";
        nextFetchedAt = cached.fetchedAt;
      } else {
        nextCatalog = native
          ? await invoke<AlbumCatalog>("album_catalog", { artistId })
          : previewCatalog;
        nextSource = "musicbrainz";
        nextFetchedAt = null;
      }
      setCatalog(nextCatalog);
      setCatalogSource(nextSource);
      setCatalogFetchedAt(nextFetchedAt);
      const nextMatches = await matchCatalog(artist.name, nextCatalog);
      comparisons.current.set(cacheKey, {
        catalog: nextCatalog,
        matches: nextMatches,
        source: nextSource,
        fetchedAt: nextFetchedAt,
      });
      return nextCatalog;
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setLoading("idle");
    }
  }, [matchCatalog, native]);

  const activate = useCallback(async () => {
    if (activated) return artists;
    return await loadArtists("");
  }, [activated, artists, loadArtists]);

  const selectIdentity = useCallback(async (identity: AlbumArtist) => {
    if (!selectedArtist) return null;
    return await loadCatalog(selectedArtist, identity);
  }, [loadCatalog, selectedArtist]);

  const matchByAlbumId = useMemo(
    () => new Map(matches.map((match) => [match.albumId, match])),
    [matches],
  );

  return useMemo(() => ({
    activated,
    query,
    artists,
    artistsTruncated,
    selectedArtist,
    identityOptions,
    catalog,
    catalogSource,
    catalogFetchedAt,
    loading,
    error,
    matchByAlbumId,
    activate,
    loadArtists,
    loadCatalog,
    selectIdentity,
    clearCache: () => comparisons.current.clear(),
    clearError: () => setError(null),
  }), [activate, activated, artists, artistsTruncated, catalog, catalogFetchedAt, catalogSource, error, identityOptions, loadCatalog, loadArtists, loading, matchByAlbumId, query, selectIdentity, selectedArtist]);
}
