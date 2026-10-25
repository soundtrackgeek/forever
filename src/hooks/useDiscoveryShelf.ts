import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchiveArtistSummary, ArchiveArtistsResponse } from "../types";

export type DiscoverySeed = { artistId: string; name: string; ownedAlbumCount: number };
export type DiscoveryArtist = { artistId: string; name: string; disambiguation: string | null; score: number; because: DiscoverySeed[]; sources: string[] };
export type DiscoveryShelf = { artists: DiscoveryArtist[]; seeds: DiscoverySeed[]; unresolvedArtists: number; notices: string[] };
export type DiscoveryAlbum = { id: string; title: string; firstReleaseDate: string; coverArtUrl: string; musicbrainz: boolean; discogs: boolean };
export type SourceReport = { status: "found" | "empty" | "unavailable" | "notConfigured"; count: number; message: string | null };
export type DiscoveryAlbums = { albums: DiscoveryAlbum[]; musicbrainz: SourceReport; discogs: SourceReport; musicbrainzArtistId: string | null; imageUrl: string | null; basis: "listenbrainz" | "catalog"; notices: string[] };
export type SourceKey = "lastFm" | "discogs" | "fanart";
export type SourceStatus = { configured: boolean; origin: "keyring" | "environment" | "none" };
export type SourcesStatus = Record<SourceKey, SourceStatus>;
/** An Archive artist chosen to steer discovery. */
export type DiscoverySteer = { artistId: string | null; name: string; ownedAlbumCount: number };

export const MAX_STEER = 5;
const steerKey = (steer: DiscoverySteer) => steer.artistId ?? steer.name.toLocaleLowerCase();

const seed = { artistId: "0383dadf-2a4e-4d10-a46a-e9e041da8eb3", name: "Queen", ownedAlbumCount: 19 };
const previewArtists: ArchiveArtistSummary[] = [
  { name: "Queen", ownedAlbumCount: 19, firstYear: 1973, lastYear: 1995, artistId: seed.artistId, canonicalName: "Queen", cachedReleaseCount: 0, catalogFetchedAt: null },
  { name: "Richard Marx", ownedAlbumCount: 7, firstYear: 1987, lastYear: 2014, artistId: null, canonicalName: null, cachedReleaseCount: 0, catalogFetchedAt: null },
  { name: "Bryan Adams", ownedAlbumCount: 5, firstYear: 1984, lastYear: 2022, artistId: "5b24fbab-c58f-4c37-a2c1-a2b4d5ae8b0b", canonicalName: "Bryan Adams", cachedReleaseCount: 0, catalogFetchedAt: null },
];
const previewShelf = (steer: DiscoverySteer[]): DiscoveryShelf => {
  const seeds = steer.length ? steer.map((item) => ({ artistId: item.artistId ?? `name:${item.name.toLocaleLowerCase()}`, name: item.name, ownedAlbumCount: item.ownedAlbumCount })) : [seed];
  return {
    seeds, unresolvedArtists: 1, notices: [],
    artists: [
      { artistId: "5441c29d-3602-4898-b1a1-b77fa23b8e50", name: "David Bowie", disambiguation: "English singer-songwriter", score: 3, because: seeds, sources: ["Last.fm", "ListenBrainz"] },
      { artistId: "83d91898-7763-47d7-b03b-b92132375c47", name: "Pink Floyd", disambiguation: "British rock band", score: 2.5, because: seeds, sources: ["ListenBrainz"] },
      { artistId: "name:coldplay", name: "Coldplay", disambiguation: null, score: 2, because: seeds, sources: ["Last.fm"] },
    ],
  };
};
const previewAlbums = (artist: DiscoveryArtist): DiscoveryAlbums => ({
  basis: "listenbrainz", notices: [], musicbrainzArtistId: artist.artistId, imageUrl: null,
  musicbrainz: { status: "found", count: 3, message: null },
  discogs: { status: "found", count: 3, message: null },
  albums: (artist.name === "David Bowie" ? ["Hunky Dory", "Low", "Heroes"] : artist.name === "Pink Floyd" ? ["The Dark Side of the Moon", "Wish You Were Here", "Animals"] : ["Parachutes", "A Rush of Blood to the Head", "X&Y"])
    .map((title, i) => ({ id: `preview-discovery-${artist.artistId}-${i}`, title, firstReleaseDate: "", coverArtUrl: "", musicbrainz: true, discogs: i !== 2 })),
});
const previewSources: SourcesStatus = {
  lastFm: { configured: true, origin: "keyring" }, discogs: { configured: true, origin: "keyring" }, fanart: { configured: false, origin: "none" },
};

type State = { sourceKey: string; shelf: DiscoveryShelf | null; selected: DiscoveryArtist | null; albums: DiscoveryAlbums | null; steer: DiscoverySteer[]; loading: "idle" | "shelf" | "albums"; error: string | null };
const empty = (sourceKey: string): State => ({ sourceKey, shelf: null, selected: null, albums: null, steer: [], loading: "idle", error: null });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useDiscoveryShelf(sourceKey: string) {
  const native = isTauri();
  const sequence = useRef(0);
  const [stored, setState] = useState<State>(() => empty(sourceKey));
  const [sources, setSources] = useState<SourcesStatus | null>(native ? null : previewSources);
  if (stored.sourceKey !== sourceKey) setState(empty(sourceKey));
  const state = stored.sourceKey === sourceKey ? stored : empty(sourceKey);
  // Invalidate in-flight work on source changes and unmount, even if the path switches back.
  useEffect(() => () => { sequence.current += 1; }, [sourceKey]);
  const resetSource = useCallback(() => {
    sequence.current += 1;
    setState(empty(sourceKey));
  }, [sourceKey]);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    const steer = state.steer;
    setState({ ...empty(sourceKey), steer, loading: "shelf" });
    try {
      const shelf = native
        ? await invoke<DiscoveryShelf>("discovery_shelf", { seeds: steer.length ? steer.map(({ artistId, name }) => ({ artistId, name })) : null })
        : previewShelf(steer);
      if (request === sequence.current) setState({ ...empty(sourceKey), steer, shelf });
    } catch (error) {
      if (request === sequence.current) setState({ ...empty(sourceKey), steer, error: message(error) });
    }
  }, [native, sourceKey, state.steer]);
  const select = useCallback(async (artist: DiscoveryArtist) => {
    const request = ++sequence.current;
    setState((current) => ({ ...current, selected: artist, albums: null, loading: "albums", error: null }));
    try {
      const albums = native ? await invoke<DiscoveryAlbums>("discovery_albums", { artistId: artist.artistId, name: artist.name }) : previewAlbums(artist);
      if (request === sequence.current) setState((current) => ({ ...current, albums, loading: "idle" }));
    } catch (error) {
      if (request === sequence.current) setState((current) => ({ ...current, loading: "idle", error: message(error) }));
    }
  }, [native]);

  const searchArtists = useCallback(async (query: string): Promise<ArchiveArtistSummary[]> => {
    const text = query.trim();
    if (!native) return previewArtists.filter((artist) => artist.name.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
    return (await invoke<ArchiveArtistsResponse>("archive_artists", { query: text })).artists;
  }, [native]);
  const addSteer = useCallback((artist: ArchiveArtistSummary) => {
    const next: DiscoverySteer = { artistId: artist.artistId, name: artist.canonicalName ?? artist.name, ownedAlbumCount: artist.ownedAlbumCount };
    setState((current) => current.steer.length >= MAX_STEER || current.steer.some((item) => steerKey(item) === steerKey(next)) ? current : { ...current, steer: [...current.steer, next] });
  }, []);
  const removeSteer = useCallback((item: DiscoverySteer) => {
    setState((current) => ({ ...current, steer: current.steer.filter((other) => steerKey(other) !== steerKey(item)) }));
  }, []);

  const loadSources = useCallback(async () => {
    if (!native) return;
    try { setSources(await invoke<SourcesStatus>("discovery_sources_status")); } catch { /* keys stay unknown */ }
  }, [native]);
  const saveSource = useCallback(async (source: SourceKey, key: string, secret?: string) => {
    if (!native) { setSources((current) => ({ ...(current ?? previewSources), [source]: { configured: true, origin: "keyring" } })); return; }
    setSources(await invoke<SourcesStatus>("discovery_save_source", { source, key, secret: secret ?? null }));
  }, [native]);
  const clearSource = useCallback(async (source: SourceKey) => {
    if (!native) { setSources((current) => ({ ...(current ?? previewSources), [source]: { configured: false, origin: "none" } })); return; }
    setSources(await invoke<SourcesStatus>("discovery_clear_source", { source }));
  }, [native]);

  return { ...state, preview: !native, sources, resetSource, load, select, searchArtists, addSteer, removeSteer, loadSources, saveSource, clearSource };
}
