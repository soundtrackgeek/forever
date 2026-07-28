import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AlbumReleaseGroup,
  WantedAlbum,
  WantedDownloadFulfillment,
  WantedPreferences,
  WantedSnapshot,
} from "../types";

const now = Date.now();
export const defaultWantedPreferences: WantedPreferences = {
  formatPreference: "preferLossless",
  minimumBitrateKbps: 320,
  minimumTrackCount: null,
};

const previewSnapshot: WantedSnapshot = {
  defaultPreferences: defaultWantedPreferences,
  albums: [
    {
      albumId: "419fa215-3740-3b1c-aa04-a209eab30789",
      artist: "Def Leppard",
      title: "High ’n’ Dry",
      firstReleaseDate: "1981-07-11",
      coverArtUrl: "https://coverartarchive.org/release-group/419fa215-3740-3b1c-aa04-a209eab30789/front-250",
      paused: false,
      fulfilled: false,
      fulfilledAtMs: null,
      fulfillmentSource: null,
      downloadReceipt: null,
      ownedTrackCount: null,
      preferences: defaultWantedPreferences,
      addedAtMs: now - 86_400_000,
      lastCheckedAtMs: now - 8 * 60_000,
      sourceCount: 7,
      matchingSourceCount: 4,
      readySourceCount: 3,
      completeSourceCount: 4,
      newSourceCount: 2,
      bestFormat: "FLAC",
      bestTrackCount: 10,
      bestSizeBytes: 487_000_000,
      bestSpeedBytesPerSecond: 8_400_000,
      bestSource: {
        username: "audiophile92",
        folder: "Music\\Def Leppard\\1981 - High 'n' Dry [FLAC]",
        format: "FLAC",
        trackCount: 10,
        sizeBytes: 487_000_000,
        slotFree: true,
        averageSpeedBytesPerSecond: 8_400_000,
        queueLength: 0,
        minimumBitrateKbps: null,
        score: 1_280,
      },
      error: null,
    },
    {
      albumId: "preview-waiting",
      artist: "Engine Alley",
      title: "A Sonic Holiday",
      firstReleaseDate: "1992",
      coverArtUrl: null,
      paused: false,
      fulfilled: false,
      fulfilledAtMs: null,
      fulfillmentSource: null,
      downloadReceipt: null,
      ownedTrackCount: null,
      preferences: { ...defaultWantedPreferences, minimumTrackCount: 11 },
      addedAtMs: now - 43_200_000,
      lastCheckedAtMs: now - 12 * 60_000,
      sourceCount: 0,
      matchingSourceCount: 0,
      readySourceCount: 0,
      completeSourceCount: 0,
      newSourceCount: 0,
      bestFormat: null,
      bestTrackCount: null,
      bestSizeBytes: null,
      bestSpeedBytesPerSecond: null,
      bestSource: null,
      error: null,
    },
    {
      albumId: "preview-paused",
      artist: "Ronan",
      title: "Switch",
      firstReleaseDate: "1992",
      coverArtUrl: null,
      paused: true,
      fulfilled: false,
      fulfilledAtMs: null,
      fulfillmentSource: null,
      downloadReceipt: null,
      ownedTrackCount: null,
      preferences: { formatPreference: "any", minimumBitrateKbps: 256, minimumTrackCount: 10 },
      addedAtMs: now - 172_800_000,
      lastCheckedAtMs: now - 86_400_000,
      sourceCount: 1,
      matchingSourceCount: 1,
      readySourceCount: 0,
      completeSourceCount: 1,
      newSourceCount: 0,
      bestFormat: "MP3",
      bestTrackCount: 11,
      bestSizeBytes: 114_000_000,
      bestSpeedBytesPerSecond: 2_100_000,
      bestSource: {
        username: "switchsignal",
        folder: "Music\\Ronan\\Switch (1992) [320]",
        format: "MP3",
        trackCount: 11,
        sizeBytes: 114_000_000,
        slotFree: false,
        averageSpeedBytesPerSecond: 2_100_000,
        queueLength: 3,
        minimumBitrateKbps: 320,
        score: 650,
      },
      error: null,
    },
    {
      albumId: "preview-fulfilled",
      artist: "Def Leppard",
      title: "Hysteria",
      firstReleaseDate: "1987-08-03",
      coverArtUrl: null,
      paused: false,
      fulfilled: true,
      fulfilledAtMs: now - 3_600_000,
      fulfillmentSource: "download",
      downloadReceipt: {
        releaseId: "preview-unveiled",
        username: "signalsource",
        format: "MP3",
        trackCount: 12,
        sizeBytes: 105_000_000,
        soundcheck: "passed",
        completedAtMs: now - 3_600_000,
      },
      ownedTrackCount: null,
      preferences: defaultWantedPreferences,
      addedAtMs: now - 259_200_000,
      lastCheckedAtMs: now - 90_000_000,
      sourceCount: 9,
      matchingSourceCount: 6,
      readySourceCount: 4,
      completeSourceCount: 5,
      newSourceCount: 0,
      bestFormat: "FLAC",
      bestTrackCount: 12,
      bestSizeBytes: 612_000_000,
      bestSpeedBytesPerSecond: 9_400_000,
      bestSource: null,
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
    title: `${album.title} has a Smart Match`,
    body: album.bestSource
      ? `${album.bestSource.format} · ${album.bestSource.trackCount} tracks · ${album.bestSource.slotFree ? "free slot" : `${album.bestSource.queueLength} queued`}. Open Forever to review it.`
      : `${album.matchingSourceCount} matching sources found for ${album.artist}.`,
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
      ? { albums: [], defaultPreferences: defaultWantedPreferences, intervalMinutes: 30, activeAlbumId: null, nextCheckAtMs: null, updatedAtMs: 0 }
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
          !album.fulfilled &&
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
    setAlert((current) => current && next.albums.some(
      (album) => album.albumId === current.albumId && !album.fulfilled,
    ) ? current : null);
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
          albums: current.albums.map((item) => item.albumId === album.id ? item.fulfilled ? {
            ...item,
            ...request,
            paused: false,
            fulfilled: false,
            fulfilledAtMs: null,
            fulfillmentSource: null,
            downloadReceipt: null,
            ownedTrackCount: null,
            watchDespiteOwnership: true,
            addedAtMs: Date.now(),
            lastCheckedAtMs: null,
            sourceCount: 0,
            matchingSourceCount: 0,
            readySourceCount: 0,
            completeSourceCount: 0,
            newSourceCount: 0,
            bestFormat: null,
            bestTrackCount: null,
            bestSizeBytes: null,
            bestSpeedBytesPerSecond: null,
            bestSource: null,
            error: null,
          } : { ...item, paused: false } : item),
          updatedAtMs: Date.now(),
        };
      }
      return {
        ...current,
        albums: [{
        ...request,
          paused: false,
          fulfilled: false,
          fulfilledAtMs: null,
          fulfillmentSource: null,
          downloadReceipt: null,
          ownedTrackCount: null,
          watchDespiteOwnership: false,
          preferences: current.defaultPreferences,
          addedAtMs: Date.now(),
          lastCheckedAtMs: null,
          sourceCount: 0,
          matchingSourceCount: 0,
          readySourceCount: 0,
          completeSourceCount: 0,
          newSourceCount: 0,
          bestFormat: null,
          bestTrackCount: null,
          bestSizeBytes: null,
          bestSpeedBytesPerSecond: null,
          bestSource: null,
          error: null,
        }, ...current.albums],
        updatedAtMs: Date.now(),
      };
    });
  }, [invokeOrPreview]);

  const addMany = useCallback(async (
    artist: string,
    albums: AlbumReleaseGroup[],
    preferences: WantedPreferences,
  ) => {
    const requests = albums.map((album) => requestFor(artist, album));
    return await invokeOrPreview("wanted_add_many", { requests, preferences }, (current) => {
      const byId = new Map(current.albums.map((album) => [album.albumId.toLowerCase(), album]));
      for (const request of requests) {
        const existing = byId.get(request.albumId.toLowerCase());
        if (existing) {
          byId.set(request.albumId.toLowerCase(), {
            ...existing,
            ...request,
            paused: false,
            preferences,
            ...(existing.fulfilled ? {
              fulfilled: false,
              fulfilledAtMs: null,
              fulfillmentSource: null,
              downloadReceipt: null,
              ownedTrackCount: null,
              watchDespiteOwnership: true,
              addedAtMs: Date.now(),
              lastCheckedAtMs: null,
              sourceCount: 0,
              matchingSourceCount: 0,
              readySourceCount: 0,
              completeSourceCount: 0,
              newSourceCount: 0,
              bestFormat: null,
              bestTrackCount: null,
              bestSizeBytes: null,
              bestSpeedBytesPerSecond: null,
              bestSource: null,
              error: null,
            } : {}),
          });
        } else {
          byId.set(request.albumId.toLowerCase(), {
            ...request,
            paused: false,
            fulfilled: false,
            fulfilledAtMs: null,
            fulfillmentSource: null,
            downloadReceipt: null,
            ownedTrackCount: null,
            watchDespiteOwnership: false,
            preferences,
            addedAtMs: Date.now(),
            lastCheckedAtMs: null,
            sourceCount: 0,
            matchingSourceCount: 0,
            readySourceCount: 0,
            completeSourceCount: 0,
            newSourceCount: 0,
            bestFormat: null,
            bestTrackCount: null,
            bestSizeBytes: null,
            bestSpeedBytesPerSecond: null,
            bestSource: null,
            error: null,
          });
        }
      }
      const changedIds = new Set(requests.map((request) => request.albumId.toLowerCase()));
      const changed = [...byId.values()].filter((album) => changedIds.has(album.albumId.toLowerCase()));
      const unchanged = current.albums.filter((album) => !changedIds.has(album.albumId.toLowerCase()));
      return { ...current, albums: [...changed, ...unchanged], updatedAtMs: Date.now() };
    });
  }, [invokeOrPreview]);

  const remove = useCallback(async (albumId: string) =>
    await invokeOrPreview("wanted_remove", { albumId }, (current) => ({
      ...current,
      albums: current.albums.filter((album) => album.albumId !== albumId),
      activeAlbumId: current.activeAlbumId === albumId ? null : current.activeAlbumId,
      updatedAtMs: Date.now(),
    })), [invokeOrPreview]);

  const fulfillDownloaded = useCallback(async (fulfillments: WantedDownloadFulfillment[]) => {
    const byAlbumId = new Map(
      fulfillments.map((fulfillment) => [fulfillment.albumId.toLocaleLowerCase(), fulfillment]),
    );
    return await invokeOrPreview("wanted_fulfill_downloaded", { fulfillments }, (current) => ({
      ...current,
      albums: current.albums.map((album) => {
        const fulfillment = byAlbumId.get(album.albumId.toLocaleLowerCase());
        if (!fulfillment) return album;
        const { albumId: _albumId, ...downloadReceipt } = fulfillment;
        void _albumId;
        return {
          ...album,
          fulfilled: true,
          fulfilledAtMs: fulfillment.completedAtMs,
          fulfillmentSource: "download" as const,
          downloadReceipt,
          ownedTrackCount: null,
          watchDespiteOwnership: false,
          newSourceCount: 0,
          error: null,
        };
      }),
      activeAlbumId: current.activeAlbumId && byAlbumId.has(current.activeAlbumId.toLocaleLowerCase())
        ? null
        : current.activeAlbumId,
      updatedAtMs: Date.now(),
    }));
  }, [invokeOrPreview]);

  const restore = useCallback(async (albumId: string) =>
    await invokeOrPreview("wanted_restore", { albumId }, (current) => ({
      ...current,
      albums: current.albums.map((album) => album.albumId === albumId ? {
        ...album,
        paused: false,
        fulfilled: false,
        fulfilledAtMs: null,
        fulfillmentSource: null,
        downloadReceipt: null,
        ownedTrackCount: null,
        watchDespiteOwnership: true,
        addedAtMs: Date.now(),
        lastCheckedAtMs: null,
        sourceCount: 0,
        matchingSourceCount: 0,
        readySourceCount: 0,
        completeSourceCount: 0,
        newSourceCount: 0,
        bestFormat: null,
        bestTrackCount: null,
        bestSizeBytes: null,
        bestSpeedBytesPerSecond: null,
        bestSource: null,
        error: null,
      } : album),
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

  const setPreferences = useCallback(async (
    albumId: string,
    preferences: WantedPreferences,
  ) => await invokeOrPreview("wanted_set_preferences", { albumId, preferences }, (current) => ({
    ...current,
    albums: current.albums.map((album) => album.albumId === albumId ? {
      ...album,
      preferences,
      lastCheckedAtMs: null,
      matchingSourceCount: 0,
      newSourceCount: 0,
      bestFormat: null,
      bestTrackCount: null,
      bestSizeBytes: null,
      bestSpeedBytesPerSecond: null,
      bestSource: null,
    } : album),
    updatedAtMs: Date.now(),
  })), [invokeOrPreview]);

  const setDefaultPreferences = useCallback(async (
    preferences: WantedPreferences,
  ) => await invokeOrPreview("wanted_set_default_preferences", { preferences }, (current) => ({
    ...current,
    defaultPreferences: preferences,
    updatedAtMs: Date.now(),
  })), [invokeOrPreview]);

  const syncFulfilled = useCallback(async (
    fulfillments: Array<{ albumId: string; owned: boolean; trackCount: number | null }>,
  ) => await invokeOrPreview("wanted_sync_fulfilled", { fulfillments }, (current) => ({
    ...current,
    albums: current.albums.map((album) => {
      const fulfillment = fulfillments.find((item) => item.albumId === album.albumId);
      if (!fulfillment) return album;
      if (album.fulfillmentSource === "download") return album;
      if (album.watchDespiteOwnership) return album;
      return {
        ...album,
        fulfilled: fulfillment.owned,
        fulfilledAtMs: fulfillment.owned ? album.fulfilledAtMs ?? Date.now() : null,
        fulfillmentSource: fulfillment.owned ? "archive" : null,
        downloadReceipt: null,
        ownedTrackCount: fulfillment.owned ? fulfillment.trackCount : null,
        watchDespiteOwnership: false,
        newSourceCount: fulfillment.owned ? 0 : album.newSourceCount,
      };
    }),
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
          matchingSourceCount: album.matchingSourceCount || 2,
          readySourceCount: album.readySourceCount || 1,
          completeSourceCount: album.completeSourceCount || 2,
          newSourceCount: album.sourceCount ? 0 : 3,
          bestFormat: album.bestFormat || "FLAC",
          bestTrackCount: album.bestTrackCount || 10,
          bestSizeBytes: album.bestSizeBytes || 420_000_000,
          bestSpeedBytesPerSecond: album.bestSpeedBytesPerSecond || 6_200_000,
          bestSource: album.bestSource || {
            username: "audiophile92",
            folder: `Music\\${album.artist}\\${album.title} [FLAC]`,
            format: "FLAC",
            trackCount: album.preferences.minimumTrackCount || 10,
            sizeBytes: 420_000_000,
            slotFree: true,
            averageSpeedBytesPerSecond: 6_200_000,
            queueLength: 0,
            minimumBitrateKbps: null,
            score: 1_240,
          },
        } : album),
        updatedAtMs: Date.now(),
      };
      receive(checked, true);
      previewTimer.current = null;
    }, 700);
    return started;
  }, [invokeOrPreview, native, receive, snapshot]);

  const byAlbumId = useMemo(
    () => new Map(snapshot.albums.filter((album) => !album.fulfilled).map((album) => [album.albumId, album])),
    [snapshot.albums],
  );

  return useMemo(() => ({
    snapshot,
    ready,
    error,
    alert,
    byAlbumId,
    add,
    addMany,
    remove,
    fulfillDownloaded,
    restore,
    setPaused,
    setIntervalMinutes,
    setPreferences,
    setDefaultPreferences,
    syncFulfilled,
    check,
    dismissAlert: () => setAlert(null),
    clearError: () => setError(null),
  }), [add, addMany, alert, byAlbumId, check, error, fulfillDownloaded, ready, remove, restore, setDefaultPreferences, setIntervalMinutes, setPaused, setPreferences, snapshot, syncFulfilled]);
}
