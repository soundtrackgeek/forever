import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlbumReleaseGroup, WantedAlbum, WantedSnapshot } from "../types";

const now = Date.now();

const previewSnapshot: WantedSnapshot = {
  albums: [
    {
      albumId: "419fa215-3740-3b1c-aa04-a209eab30789",
      artist: "Def Leppard",
      title: "High ’n’ Dry",
      firstReleaseDate: "1981-07-11",
      coverArtUrl: "https://coverartarchive.org/release-group/419fa215-3740-3b1c-aa04-a209eab30789/front-250",
      paused: false,
      addedAtMs: now - 86_400_000,
      lastCheckedAtMs: now - 8 * 60_000,
      sourceCount: 7,
      readySourceCount: 3,
      completeSourceCount: 4,
      newSourceCount: 2,
      bestFormat: "FLAC",
      bestTrackCount: 10,
      bestSizeBytes: 487_000_000,
      bestSpeedBytesPerSecond: 8_400_000,
      error: null,
    },
    {
      albumId: "preview-waiting",
      artist: "Engine Alley",
      title: "A Sonic Holiday",
      firstReleaseDate: "1992",
      coverArtUrl: null,
      paused: false,
      addedAtMs: now - 43_200_000,
      lastCheckedAtMs: now - 12 * 60_000,
      sourceCount: 0,
      readySourceCount: 0,
      completeSourceCount: 0,
      newSourceCount: 0,
      bestFormat: null,
      bestTrackCount: null,
      bestSizeBytes: null,
      bestSpeedBytesPerSecond: null,
      error: null,
    },
    {
      albumId: "preview-paused",
      artist: "Ronan",
      title: "Switch",
      firstReleaseDate: "1992",
      coverArtUrl: null,
      paused: true,
      addedAtMs: now - 172_800_000,
      lastCheckedAtMs: now - 86_400_000,
      sourceCount: 1,
      readySourceCount: 0,
      completeSourceCount: 1,
      newSourceCount: 0,
      bestFormat: "MP3",
      bestTrackCount: 11,
      bestSizeBytes: 114_000_000,
      bestSpeedBytesPerSecond: 2_100_000,
      error: null,
    },
  ],
  intervalMinutes: 30,
  activeAlbumId: null,
  nextCheckAtMs: now + 7 * 60_000,
  updatedAtMs: now,
};

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const notify = async (album: WantedAlbum) => {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === "granted";
  }
  if (!permissionGranted) return;
  sendNotification({
    title: `${album.title} is transmitting`,
    body: `${album.sourceCount} ${album.sourceCount === 1 ? "source" : "sources"} found for ${album.artist}. Open Forever to compare them.`,
  });
};

const requestFor = (artist: string, album: AlbumReleaseGroup) => ({
  albumId: album.id,
  artist,
  title: album.title,
  firstReleaseDate: album.firstReleaseDate,
  coverArtUrl: album.coverArtUrl || null,
});

export function useWantedAlbums() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<WantedSnapshot>(
    native
      ? { albums: [], intervalMinutes: 30, activeAlbumId: null, nextCheckAtMs: null, updatedAtMs: 0 }
      : previewSnapshot,
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<WantedAlbum | null>(null);
  const knownChecks = useRef(new Map<string, number>());
  const initialized = useRef(false);
  const previewTimer = useRef<number | null>(null);

  const receive = useCallback((next: WantedSnapshot, announce: boolean) => {
    if (announce && initialized.current) {
      const available = next.albums.find((album) => {
        const previous = knownChecks.current.get(album.albumId) ?? 0;
        return Boolean(
          album.newSourceCount > 0 &&
          album.lastCheckedAtMs &&
          album.lastCheckedAtMs > previous,
        );
      });
      if (available) {
        setAlert(available);
        if (native) void notify(available).catch(() => undefined);
      }
    }
    for (const album of next.albums) {
      if (album.lastCheckedAtMs) knownChecks.current.set(album.albumId, album.lastCheckedAtMs);
    }
    initialized.current = true;
    setSnapshot(next);
  }, [native]);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listen<WantedSnapshot>("forever://wanted", (event) => {
      if (mounted) receive(event.payload, true);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });
    void invoke<WantedSnapshot>("wanted_snapshot")
      .then((next) => {
        if (mounted) receive(next, false);
      })
      .catch((cause) => {
        if (mounted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [native, receive]);

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
  }, []);

  const invokeOrPreview = useCallback(async (
    command: string,
    args: Record<string, unknown>,
    preview: (current: WantedSnapshot) => WantedSnapshot,
  ) => {
    setError(null);
    try {
      const next = native
        ? await invoke<WantedSnapshot>(command, args)
        : preview(snapshot);
      receive(next, false);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, [native, receive, snapshot]);

  const add = useCallback(async (artist: string, album: AlbumReleaseGroup) => {
    const request = requestFor(artist, album);
    return await invokeOrPreview("wanted_add", { request }, (current) => {
      const existing = current.albums.find((item) => item.albumId === album.id);
      if (existing) {
        return {
          ...current,
          albums: current.albums.map((item) => item.albumId === album.id ? { ...item, paused: false } : item),
          updatedAtMs: Date.now(),
        };
      }
      return {
        ...current,
        albums: [{
          ...request,
          paused: false,
          addedAtMs: Date.now(),
          lastCheckedAtMs: null,
          sourceCount: 0,
          readySourceCount: 0,
          completeSourceCount: 0,
          newSourceCount: 0,
          bestFormat: null,
          bestTrackCount: null,
          bestSizeBytes: null,
          bestSpeedBytesPerSecond: null,
          error: null,
        }, ...current.albums],
        updatedAtMs: Date.now(),
      };
    });
  }, [invokeOrPreview]);

  const remove = useCallback(async (albumId: string) =>
    await invokeOrPreview("wanted_remove", { albumId }, (current) => ({
      ...current,
      albums: current.albums.filter((album) => album.albumId !== albumId),
      activeAlbumId: current.activeAlbumId === albumId ? null : current.activeAlbumId,
      updatedAtMs: Date.now(),
    })), [invokeOrPreview]);

  const setPaused = useCallback(async (albumId: string, paused: boolean) =>
    await invokeOrPreview("wanted_set_paused", { albumId, paused }, (current) => ({
      ...current,
      albums: current.albums.map((album) => album.albumId === albumId ? { ...album, paused } : album),
      activeAlbumId: paused && current.activeAlbumId === albumId ? null : current.activeAlbumId,
      updatedAtMs: Date.now(),
    })), [invokeOrPreview]);

  const setIntervalMinutes = useCallback(async (intervalMinutes: 0 | 15 | 30 | 60) =>
    await invokeOrPreview("wanted_set_interval", { intervalMinutes }, (current) => ({
      ...current,
      intervalMinutes,
      nextCheckAtMs: intervalMinutes ? Date.now() + intervalMinutes * 60_000 : null,
      updatedAtMs: Date.now(),
    })), [invokeOrPreview]);

  const check = useCallback(async (albumId: string) => {
    if (native) return await invokeOrPreview("wanted_check", { albumId }, (current) => current);
    const started: WantedSnapshot = { ...snapshot, activeAlbumId: albumId, updatedAtMs: Date.now() };
    receive(started, false);
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const checked: WantedSnapshot = {
        ...started,
        activeAlbumId: null,
        albums: started.albums.map((album) => album.albumId === albumId ? {
          ...album,
          lastCheckedAtMs: Date.now(),
          sourceCount: album.sourceCount || 3,
          readySourceCount: album.readySourceCount || 1,
          completeSourceCount: album.completeSourceCount || 2,
          newSourceCount: album.sourceCount ? 0 : 3,
          bestFormat: album.bestFormat || "FLAC",
          bestTrackCount: album.bestTrackCount || 10,
          bestSizeBytes: album.bestSizeBytes || 420_000_000,
          bestSpeedBytesPerSecond: album.bestSpeedBytesPerSecond || 6_200_000,
        } : album),
        updatedAtMs: Date.now(),
      };
      receive(checked, true);
      previewTimer.current = null;
    }, 700);
    return started;
  }, [invokeOrPreview, native, receive, snapshot]);

  const byAlbumId = useMemo(
    () => new Map(snapshot.albums.map((album) => [album.albumId, album])),
    [snapshot.albums],
  );

  return useMemo(() => ({
    snapshot,
    ready,
    error,
    alert,
    byAlbumId,
    add,
    remove,
    setPaused,
    setIntervalMinutes,
    check,
    dismissAlert: () => setAlert(null),
    clearError: () => setError(null),
  }), [add, alert, byAlbumId, check, error, ready, remove, setIntervalMinutes, setPaused, snapshot]);
}
