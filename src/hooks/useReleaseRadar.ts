import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlbumReleaseGroup } from "../types";

export type FollowedArtist = { artistId: string; name: string; autoAdd: boolean; followedAtMs: number; lastAttemptAtMs: number | null; lastCheckedAtMs: number | null; error: string | null };
export type RadarRelease = { artistId: string; artist: string; album: AlbumReleaseGroup; discoveredAtMs: number; dismissed: boolean; addedToWanted: boolean; owned: boolean; autoAddError: string | null };
export type ReleaseRadarSnapshot = { artists: FollowedArtist[]; releases: RadarRelease[]; revision: number; checking: string | null; error: string | null; notices: { store: string; message: string }[] };
const empty: ReleaseRadarSnapshot = { artists: [], releases: [], revision: -1, checking: null, error: null, notices: [] };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const previewKey = "forever:release-radar:preview:v1";
const previewArtist = { artistId: "preview-radar-artist", name: "The Paper Satellites", autoAdd: false, followedAtMs: Date.now(), lastAttemptAtMs: Date.now(), lastCheckedAtMs: Date.now(), error: null };
const sample = (): ReleaseRadarSnapshot => ({ ...empty, revision: 0, artists: [previewArtist], releases: [{
  artistId: previewArtist.artistId, artist: previewArtist.name, discoveredAtMs: Date.now(), dismissed: false, addedToWanted: false, owned: false, autoAddError: null,
  album: { id: "preview-radar-album", title: "Signals at Dawn", firstReleaseDate: new Date().toISOString().slice(0, 10), primaryType: "Album", secondaryTypes: [], coverArtUrl: "" },
}] });
function loadPreview() {
  try {
    const value = JSON.parse(localStorage.getItem(previewKey) ?? "null") as ReleaseRadarSnapshot | null;
    if (value && Array.isArray(value.artists) && Array.isArray(value.releases) && typeof value.revision === "number") return value;
  } catch { /* Preview storage is optional. */ }
  return sample();
}

export function useReleaseRadar() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<ReleaseRadarSnapshot>(() => native ? empty : loadPreview());
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);
  const accept = useCallback((next: ReleaseRadarSnapshot) => {
    setSnapshot((current) => next.revision >= current.revision ? next : current);
  }, []);
  useEffect(() => {
    if (!native) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const stop = await listen<ReleaseRadarSnapshot>("forever://release-radar", ({ payload }) => { if (active) accept(payload); });
        if (!active) { stop(); return; }
        unlisten = stop;
        const next = await invoke<ReleaseRadarSnapshot>("release_radar_snapshot");
        if (active) { accept(next); setReady(true); }
      } catch (e) { if (active) setError(message(e)); }
    })();
    return () => { active = false; unlisten?.(); };
  }, [accept, native, retry]);
  useEffect(() => {
    if (!native) { try { localStorage.setItem(previewKey, JSON.stringify(snapshot)); } catch { /* Optional preview only. */ } }
  }, [native, snapshot]);

  const change = useCallback(async (command: string, args: Record<string, unknown>, preview: (current: ReleaseRadarSnapshot) => ReleaseRadarSnapshot) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      if (native) accept(await invoke<ReleaseRadarSnapshot>(command, args));
      else setSnapshot((current) => ({ ...preview(current), revision: current.revision + 1 }));
    } catch (e) { setError(message(e)); throw e; }
    finally { busy.current = false; setPending(false); }
  }, [accept, native]);
  const follow = useCallback((artistId: string, name: string, autoAdd = false) => change("release_radar_follow", { artistId, name, autoAdd }, (current) => ({ ...current,
    artists: current.artists.some((a) => a.artistId === artistId) ? current.artists.map((a) => a.artistId === artistId ? { ...a, autoAdd } : a) : [...current.artists, { artistId, name, autoAdd, followedAtMs: Date.now(), lastAttemptAtMs: null, lastCheckedAtMs: null, error: null }],
  })), [change]);
  const unfollow = useCallback((artistId: string) => change("release_radar_unfollow", { artistId }, (current) => ({ ...current, artists: current.artists.filter((a) => a.artistId !== artistId), releases: current.releases.filter((r) => r.artistId !== artistId) })), [change]);
  const dismiss = useCallback((albumId: string, dismissed: boolean) => change("release_radar_dismiss", { albumId, dismissed }, (current) => ({ ...current, releases: current.releases.map((r) => r.album.id === albumId ? { ...r, dismissed } : r) })), [change]);
  const addWanted = useCallback(async (release: RadarRelease, addPreview: (artist: string, album: AlbumReleaseGroup) => Promise<unknown>) => {
    if (!native) await addPreview(release.artist, release.album);
    return change("release_radar_add_wanted", { albumId: release.album.id }, (current) => ({ ...current, releases: current.releases.map((r) => r.album.id === release.album.id ? { ...r, addedToWanted: true } : r) }));
  }, [change, native]);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      if (native) {
        if (!ready) { setRetry((value) => value + 1); return; }
        await invoke("release_radar_refresh");
      } else setSnapshot((current) => ({ ...current, revision: current.revision + 1, artists: current.artists.map((a) => ({ ...a, lastAttemptAtMs: Date.now(), lastCheckedAtMs: Date.now() })) }));
    } catch (e) { setError(message(e)); }
  }, [native, ready]);
  return { snapshot, ready, pending, error, preview: !native, follow, unfollow, dismiss, addWanted, refresh };
}
