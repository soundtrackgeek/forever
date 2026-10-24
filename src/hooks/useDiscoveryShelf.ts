import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlbumReleaseGroup } from "../types";

export type DiscoverySeed = { artistId: string; name: string; ownedAlbumCount: number };
export type DiscoveryArtist = { artistId: string; name: string; disambiguation: string | null; score: number; because: DiscoverySeed[] };
export type DiscoveryShelf = { artists: DiscoveryArtist[]; seeds: DiscoverySeed[]; unresolvedArtists: number; notices: string[] };
export type DiscoveryAlbums = { albums: AlbumReleaseGroup[]; basis: "listenbrainz" | "catalog"; notices: string[] };

const seed = { artistId: "0383dadf-2a4e-4d10-a46a-e9e041da8eb3", name: "Queen", ownedAlbumCount: 19 };
const preview: DiscoveryShelf = {
  seeds: [seed], unresolvedArtists: 1, notices: [],
  artists: [
    { artistId: "5441c29d-3602-4898-b1a1-b77fa23b8e50", name: "David Bowie", disambiguation: "English singer-songwriter", score: 3, because: [seed] },
    { artistId: "83d91898-7763-47d7-b03b-b92132375c47", name: "Pink Floyd", disambiguation: "British rock band", score: 2.5, because: [seed] },
    { artistId: "cc197bad-dc9c-440d-a5b5-d52ba2e14234", name: "Coldplay", disambiguation: "British alternative rock band", score: 2, because: [seed] },
  ],
};
const previewAlbums = (artist: DiscoveryArtist): DiscoveryAlbums => ({
  basis: "listenbrainz", notices: [],
  albums: (artist.name === "David Bowie" ? ["Hunky Dory", "Low", "Heroes"] : artist.name === "Pink Floyd" ? ["The Dark Side of the Moon", "Wish You Were Here", "Animals"] : ["Parachutes", "A Rush of Blood to the Head", "X&Y"])
    .map((title, i) => ({ id: `preview-discovery-${artist.artistId}-${i}`, title, firstReleaseDate: "", primaryType: "Album", secondaryTypes: [], coverArtUrl: "" })),
});

type State = { sourceKey: string; shelf: DiscoveryShelf | null; selected: DiscoveryArtist | null; albums: DiscoveryAlbums | null; loading: "idle" | "shelf" | "albums"; error: string | null };
const empty = (sourceKey: string): State => ({ sourceKey, shelf: null, selected: null, albums: null, loading: "idle", error: null });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useDiscoveryShelf(sourceKey: string) {
  const native = isTauri();
  const sequence = useRef(0);
  const [stored, setState] = useState<State>(() => empty(sourceKey));
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
    setState({ ...empty(sourceKey), loading: "shelf" });
    try {
      const shelf = native ? await invoke<DiscoveryShelf>("discovery_shelf") : preview;
      if (request === sequence.current) setState({ ...empty(sourceKey), shelf });
    } catch (error) {
      if (request === sequence.current) setState({ ...empty(sourceKey), error: message(error) });
    }
  }, [native, sourceKey]);
  const select = useCallback(async (artist: DiscoveryArtist) => {
    const request = ++sequence.current;
    setState((current) => ({ ...current, selected: artist, albums: null, loading: "albums", error: null }));
    try {
      const albums = native ? await invoke<DiscoveryAlbums>("discovery_albums", { artistId: artist.artistId }) : previewAlbums(artist);
      if (request === sequence.current) setState((current) => ({ ...current, albums, loading: "idle" }));
    } catch (error) {
      if (request === sequence.current) setState((current) => ({ ...current, loading: "idle", error: message(error) }));
    }
  }, [native]);
  return { ...state, preview: !native, resetSource, load, select };
}
