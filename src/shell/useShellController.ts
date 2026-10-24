import { invoke, isTauri } from "@tauri-apps/api/core";
import { useDesktopExit } from "../hooks/useDesktopExit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchMode } from "../components/SearchModeSwitch";
import { type AlbumResultView } from "../components/SearchWorkspace";
import { useAutomaticRelay } from "../hooks/useAutomaticRelay";
import { useAlbumDiscovery } from "../hooks/useAlbumDiscovery";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { useArchiveInventory } from "../hooks/useArchiveInventory";
import { useDialMemory } from "../hooks/useDialMemory";
import { useLocalSharing } from "../hooks/useLocalSharing";
import { useMissingShelf } from "../hooks/useMissingShelf";
import { useDiscoveryShelf } from "../hooks/useDiscoveryShelf";
import { useReleaseRadar } from "../hooks/useReleaseRadar";
import { usePrivateMessages } from "../hooks/usePrivateMessages";
import { useShelfRadar } from "../hooks/useShelfRadar";
import { useSoulseekConnection } from "../hooks/useSoulseekConnection";
import { useSoulseekFolders } from "../hooks/useSoulseekFolders";
import { useSoulseekPeople } from "../hooks/useSoulseekPeople";
import { useSoulseekRooms } from "../hooks/useSoulseekRooms";
import { useSoulseekSearch } from "../hooks/useSoulseekSearch";
import { useSoulseekShares } from "../hooks/useSoulseekShares";
import { useSoulseekTransfers } from "../hooks/useSoulseekTransfers";
import { useWantedAlbums } from "../hooks/useWantedAlbums";
import { useSettings } from "../settings";
import type {
  AlbumEditions,
  AlbumReleaseGroup,
  AlbumSearchContext,
  AlbumSource,
  AlbumTrack,
  FolderInspection,
  ReleaseAlternativeSource,
  SearchResult,
  WantedAlbum,
} from "../types";
import {
  albumDownloadStatesByTitle,
  type AlbumDownloadState,
} from "../utils/albumDownloadState";
import { groupAlbumSources } from "../utils/albumSources";
import { tracklistConfidenceForInspection } from "../utils/tracklistConfidence";
import { groupTransfers } from "../utils/transfers";
import {
  verifiedDownloadedWantedFulfillments,
  wantedAlbumDownloadTitle,
} from "../utils/wantedFulfillment";
import type { ViewId } from "./views";
const emptyAlbumCatalog: AlbumReleaseGroup[] = [];
const relaySessionId = (releaseId: string) => `signal-relay:${releaseId}`;
const appStartedAtMs = Date.now();

const albumDownloadTitle = (
  context: AlbumSearchContext | null,
  fallback: string,
) => {
  if (!context) return fallback;
  return wantedAlbumDownloadTitle(context);
};

export function useShellController() {
  const native = isTauri();
  const safeExitPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("safe-exit") === "1";
  const [activeView, setActiveView] = useState<ViewId>("home");
  const appSettings = useSettings();
  const musicBrainzFallbackTrackCount =
    appSettings.settings.preferences.musicBrainzFallbackTrackCount;
  const [transferShelfExpanded, setTransferShelfExpanded] = useState(false);
  const [transferFocus, setTransferFocus] = useState<{
    groupId: string;
    requestId: number;
  } | null>(null);
  const [archiveFocus, setArchiveFocus] = useState<{
    tab: "arrivals" | "missing" | "wanted";
    requestId: number;
  } | null>(null);
  const [roomFocus, setRoomFocus] = useState<{
    roomName: string | null;
    requestId: number;
  } | null>(null);
  const dial = useDialMemory();
  const searchMode = dial.active.mode;
  const albumContext = dial.active.albumContext;
  const albumResultView = dial.active.albumResultView;
  const query = dial.active.query;
  const selectedResultId = dial.active.selectedResultId;
  const setQuery = (next: string) =>
    dial.update(dial.activeId, { query: next });
  const setSearchMode = (next: SearchMode) =>
    dial.update(dial.activeId, { mode: next });
  const setAlbumResultView = (next: AlbumResultView) =>
    dial.update(dial.activeId, { albumResultView: next });
  const setSelectedResultId = (next: string | null) =>
    dial.update(dial.activeId, { selectedResultId: next });
  const setAlbumContext = (next: AlbumSearchContext | null) =>
    dial.update(dial.activeId, { albumContext: next });
  const changeSearchMode = (mode: SearchMode) => {
    if (mode === dial.active.mode) return;
    const existing = dial.sessions.find((item) => item.mode === mode);
    if (existing) {
      dial.select(existing.id);
      return;
    }
    dial.update(dial.activeId, {
      mode,
      albumContext: mode === "albums" ? null : albumContext,
    });
  };
  const updater = useAppUpdater();
  const albums = useAlbumDiscovery(dial.activeId);
  const archiveDiscovery =
    albums.selectedArtist && albums.catalog
      ? albums
      : Object.values(albums.states).find(
          (state) => state.selectedArtist && state.catalog,
        );
  const archiveAlbums = archiveDiscovery?.catalog?.albums ?? emptyAlbumCatalog;
  const wanted = useWantedAlbums();
  const releaseRadar = useReleaseRadar();
  const missingShelf = useMissingShelf();
  const radar = useShelfRadar();
  const connection = useSoulseekConnection();
  const search = useSoulseekSearch(dial.activeId);
  const transfers = useSoulseekTransfers();
  const transferGroups = useMemo(
    () => groupTransfers(transfers.snapshot.transfers),
    [transfers.snapshot.transfers],
  );
  const archive = useArchiveInventory(
    archiveDiscovery?.selectedArtist?.name ?? null,
    archiveAlbums,
    wanted.snapshot.albums,
    transferGroups,
  );
  const discovery = useDiscoveryShelf(`${archive.status?.path ?? ""}:${archive.status?.lastModifiedAtMs ?? ""}:${archive.status?.connected ?? false}`);
  const archiveOwnedReleaseIds = useMemo(
    () =>
      new Set(
        [...archive.transferMatchByReleaseId.entries()]
          .filter(([, match]) => match.ownership === "owned")
          .map(([releaseId]) => releaseId),
      ),
    [archive.transferMatchByReleaseId],
  );
  const sharing = useLocalSharing();
  const folders = useSoulseekFolders();
  const shares = useSoulseekShares();
  const people = useSoulseekPeople();
  useAutomaticRelay({
    enabled: native && transfers.ready && connection.snapshot.state === "online" && transfers.snapshot.safetyState === "running",
    minutes: transfers.snapshot.autoMirrorMinutes ?? 0,
    groups: transferGroups, memory: transfers.snapshot.sourceReliability ?? {}, records: search.records,
    excluded: (user) => { const person = people.personByUsername(user); return !!person?.blocked || !!person?.ignored; },
    startSearch: search.startSearch,
    inspect: (source) => folders.inspect(source.representative, source.folders),
    switchSource: (releaseId, source) => invoke<boolean>("transfer_auto_relay_release_source", { releaseId, source }),
    closeSearch: search.closeSearch,
  });
  const messages = usePrivateMessages();
  const rooms = useSoulseekRooms();
  const [sharesUsername, setSharesUsername] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(
    "audiophile92",
  );
  const [selectedMessageUsername, setSelectedMessageUsername] = useState<
    string | null
  >("audiophile92");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingInProgress, setOnboardingInProgress] = useState(false);
  const [preferencesAlbum, setPreferencesAlbum] = useState<WantedAlbum | null>(
    null,
  );
  const reviewRequest = useRef(0);
  const reviewBusy = useRef(false);
  const [reviewAlbum, setReviewAlbum] = useState<WantedAlbum | null>(null);
  const [reviewInspection, setReviewInspection] =
    useState<FolderInspection | null>(null);
  const [reviewOfficialTracks, setReviewOfficialTracks] = useState<
    AlbumTrack[]
  >([]);
  const [reviewTracklistState, setReviewTracklistState] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [relayClock, setRelayClock] = useState(appStartedAtMs);
  const [relayNotice, setRelayNotice] = useState<{
    groupId: string;
    title: string;
    count: number;
  } | null>(null);
  const desktopExit = useDesktopExit({
    native,
    activeCount: safeExitPreview ? Math.max(1, transfers.snapshot.activeCount) : transfers.snapshot.activeCount,
    prepare: transfers.prepareForRestart,
    cancel: transfers.cancelRestartPreparation,
  });
  const safeExitOpen = desktopExit.open;
  const safeExitPreparing = desktopExit.preparing;
  const safeExitError = desktopExit.error;
  const pauseSafelyAndExit = desktopExit.pauseAndExit;
  const keepRunning = desktopExit.keepRunning;
  const relaysStarted = useRef(new Set<string>());
  const relaysNotified = useRef(new Set<string>());
  const transferVerificationActive = useRef(false);
  const lastFulfillmentSync = useRef("");
  const lastWantedFulfillment = useRef("");
  const needsOnboarding = !connection.profile || !connection.hasPassword;
  const onboardingOpen =
    connection.ready &&
    (needsOnboarding || onboardingInProgress) &&
    !onboardingDismissed;

  const selectedResult =
    search.results.find((result) => result.id === selectedResultId) ??
    search.results[0] ??
    null;

  useEffect(() => {
    const timer = window.setInterval(() => setRelayClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeView !== "transfers") {
      transferVerificationActive.current = false;
      return;
    }
    if (!transfers.ready || transferVerificationActive.current) return;
    transferVerificationActive.current = true;
    void transfers.verifyCompleted().catch(() => undefined);
  }, [activeView, transfers]);

  useEffect(() => {
    const minutes = transfers.snapshot.relaySuggestionMinutes;
    const automaticMinutes = transfers.snapshot.autoMirrorMinutes ?? 0;
    if (!native || minutes === 0 || (automaticMinutes > 0 && automaticMinutes <= minutes) || connection.snapshot.state !== "online")
      return;
    const threshold = minutes * 60_000;
    for (const group of transferGroups) {
      if (!group.releaseId || group.status !== "active") continue;
      const waitingSince = group.transfers
        .filter((transfer) =>
          ["requesting", "remotelyQueued", "connecting"].includes(
            transfer.status,
          ),
        )
        .map((transfer) => transfer.waitingSinceMs)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right)[0];
      const sessionId = relaySessionId(group.releaseId);
      if (
        !waitingSince ||
        relayClock - waitingSince < threshold ||
        search.records[sessionId] ||
        relaysStarted.current.has(sessionId)
      )
        continue;
      relaysStarted.current.add(sessionId);
      void search
        .startSearch(
          sessionId,
          group.title,
          group.transfers.find((transfer) => transfer.searchAlbum)
            ?.searchAlbum ?? undefined,
        )
        .catch(() => relaysStarted.current.delete(sessionId));
    }
  }, [
    connection.snapshot.state,
    native,
    relayClock,
    search,
    transferGroups,
    transfers.snapshot.relaySuggestionMinutes,
    transfers.snapshot.autoMirrorMinutes,
  ]);

  useEffect(() => {
    for (const group of transferGroups) {
      if (!group.releaseId) continue;
      const sessionId = relaySessionId(group.releaseId);
      const record = search.records[sessionId];
      if (
        !record ||
        record.snapshot.state !== "completed" ||
        relaysNotified.current.has(sessionId)
      )
        continue;
      const currentUsers = new Set(
        group.transfers.map((transfer) =>
          transfer.username.toLocaleLowerCase(),
        ),
      );
      const currentFormats = new Set(
        group.transfers
          .map((transfer) =>
            transfer.remoteFilename.split(".").pop()?.toUpperCase(),
          )
          .filter((format): format is string => Boolean(format)),
      );
      const count = groupAlbumSources(record.results).filter(
        (source) =>
          !currentUsers.has(source.owner.toLocaleLowerCase()) &&
          source.formats.some((format) => currentFormats.has(format)),
      ).length;
      if (count > 0) {
        relaysNotified.current.add(sessionId);
        window.setTimeout(
          () =>
            setRelayNotice({ groupId: group.id, title: group.title, count }),
          0,
        );
        break;
      }
    }
  }, [search.records, transferGroups]);

  const findRelaySources = (releaseId: string, title: string) => {
    const sessionId = relaySessionId(releaseId);
    relaysStarted.current.add(sessionId);
    const album = transferGroups
      .find((group) => group.releaseId === releaseId)
      ?.transfers.find((transfer) => transfer.searchAlbum)?.searchAlbum;
    return search.startSearch(sessionId, title, album ?? undefined);
  };

  const editionSelections = JSON.stringify(
    Object.fromEntries(
      wanted.snapshot.albums
        .filter((album) => album.selectedReleaseId)
        .map((album) => [album.albumId, album.selectedReleaseId]),
    ),
  );
  const loadEditions = useCallback(
    async (releaseGroupId: string): Promise<AlbumEditions> => {
      if (native) return invoke("album_editions", { releaseGroupId });
      return {
        defaultReleaseId: "preview-original",
        truncated: false,
        releases: [
          {
            id: "preview-original",
            title: "Original edition",
            date: "1992",
            country: "GB",
            disambiguation: "Original",
            trackCount: 11,
            media: [{ format: "CD", trackCount: 11 }],
          },
          {
            id: "preview-deluxe",
            title: "Deluxe edition",
            date: "2002",
            country: "US",
            disambiguation: "Deluxe bonus disc",
            trackCount: 12,
            media: [{ format: "2×CD", trackCount: 12 }],
          },
        ],
      };
    },
    [native],
  );
  const loadOfficialTracklist = useCallback(
    (releaseGroupId: string, edition?: string | null) => {
      const releaseId =
        edition === undefined
          ? (JSON.parse(editionSelections)[releaseGroupId] ?? null)
          : edition;
      if (native)
        return invoke<AlbumTrack[]>("album_official_tracklist", {
          releaseGroupId,
          releaseId,
        });
      const previewTitles =
        releaseGroupId === "preview-waiting"
          ? [
              "Infamy",
              "Diamond Jill and Crazy Jane",
              "Spare Me",
              "Ballad of the Sinking Star",
              "Photo Lens",
              "Beautiful",
              "Telescope Girl",
              "Rollergirl",
              "Dreams",
              "The Last Night",
              "A Sonic Holiday",
            ]
          : releaseGroupId === "12fa3845-7c62-36e5-a8da-8be137155a72"
            ? [
                "Women",
                "Rocket",
                "Animal",
                "Love Bites",
                "Pour Some Sugar on Me",
                "Armageddon It",
                "Gods of War",
                "Don't Shoot Shotgun",
                "Run Riot",
                "Hysteria",
                "Excitable",
                "Love and Affection",
              ]
            : [];
      if (releaseId === "preview-deluxe") previewTitles.push("Bonus recording");
      return Promise.resolve(
        previewTitles.map((title, index) => ({
          position: index + 1,
          discNumber: 1,
          discPosition: index + 1,
          title,
          durationMs: null,
        })),
      );
    },
    [native, editionSelections],
  );

  const relayReleaseSource = async (releaseId: string, source: AlbumSource) => {
    const inspection = await folders.inspect(
      source.representative,
      source.folders,
    );
    const alternative: ReleaseAlternativeSource = {
      username: source.owner,
      remoteFolder: inspection.requestedFolder,
      files: inspection.files.map((file) => ({
        title: file.filename,
        remoteFilename: file.remoteFilename,
        sizeBytes: file.sizeBytes,
      })),
    };
    await transfers.relayReleaseSource(releaseId, alternative);
    await search.closeSearch(relaySessionId(releaseId));
    relaysStarted.current.delete(relaySessionId(releaseId));
    relaysNotified.current.delete(relaySessionId(releaseId));
  };

  const fulfillmentRequests = useMemo(
    () =>
      wanted.snapshot.albums.flatMap((album) => {
        const match = archive.wantedMatchByAlbumId.get(album.albumId);
        if (!match || match.ownership === "unknown") return [];
        return [
          {
            albumId: album.albumId,
            owned: match.ownership === "owned",
            trackCount: match.trackCount,
          },
        ];
      }),
    [archive.wantedMatchByAlbumId, wanted.snapshot.albums],
  );
  const fulfillmentSignature = useMemo(
    () =>
      fulfillmentRequests
        .map((item) => {
          const album = wanted.snapshot.albums.find(
            (candidate) => candidate.albumId === item.albumId,
          );
          return `${item.albumId}:${item.owned ? 1 : 0}:${item.trackCount ?? ""}:${album?.fulfillmentSource ?? "active"}:${album?.watchDespiteOwnership ? "manual" : "archive"}:${album?.addedAtMs ?? 0}`;
        })
        .sort()
        .join("|"),
    [fulfillmentRequests, wanted.snapshot.albums],
  );

  useEffect(() => {
    if (
      !fulfillmentSignature ||
      lastFulfillmentSync.current === fulfillmentSignature
    )
      return;
    lastFulfillmentSync.current = fulfillmentSignature;
    void wanted.syncFulfilled(fulfillmentRequests).catch(() => {
      lastFulfillmentSync.current = "";
    });
  }, [fulfillmentRequests, fulfillmentSignature, wanted]);

  const downloadedWantedFulfillments = useMemo(
    () =>
      verifiedDownloadedWantedFulfillments(
        wanted.snapshot.albums,
        transfers.snapshot.transfers,
      ),
    [transfers.snapshot.transfers, wanted.snapshot.albums],
  );
  const wantedFulfillmentSignature = downloadedWantedFulfillments
    .map(
      (fulfillment) =>
        `${fulfillment.albumId.toLocaleLowerCase()}:${fulfillment.releaseId}:${fulfillment.completedAtMs}`,
    )
    .sort()
    .join("|");

  useEffect(() => {
    if (!wantedFulfillmentSignature) {
      lastWantedFulfillment.current = "";
      return;
    }
    if (
      !wanted.ready ||
      lastWantedFulfillment.current === wantedFulfillmentSignature
    )
      return;
    lastWantedFulfillment.current = wantedFulfillmentSignature;
    void wanted.fulfillDownloaded(downloadedWantedFulfillments).catch(() => {
      lastWantedFulfillment.current = "";
    });
  }, [
    downloadedWantedFulfillments,
    wanted,
    wanted.ready,
    wantedFulfillmentSignature,
  ]);

  const wantedDownloadStateByAlbumId = useMemo(() => {
    const stateByTitle = albumDownloadStatesByTitle(
      transfers.snapshot.transfers,
    );
    const states = new Map<string, AlbumDownloadState>();
    for (const album of wanted.snapshot.albums) {
      const state = stateByTitle.get(
        albumDownloadTitle(
          {
            albumId: album.albumId,
            artist: album.artist,
            title: album.title,
            coverArtUrl: album.coverArtUrl ?? "",
            firstReleaseDate: album.firstReleaseDate,
          },
          album.title,
        ).toLocaleLowerCase(),
      );
      if (state) states.set(album.albumId, state);
    }
    return states;
  }, [transfers.snapshot.transfers, wanted.snapshot.albums]);

  const missingStudioCount = useMemo(() => {
    if (!missingShelf.catalog) return null;
    const wantedIds = new Set(
      wanted.snapshot.albums
        .filter((album) => !album.fulfilled)
        .map((album) => album.albumId),
    );
    return missingShelf.catalog.albums.filter((album) => {
      const secondary = album.secondaryTypes.map((value) =>
        value.toLocaleLowerCase(),
      );
      const studio =
        album.primaryType?.toLocaleLowerCase() !== "ep" &&
        !secondary.includes("live") &&
        !secondary.includes("compilation");
      return (
        studio &&
        missingShelf.matchByAlbumId.get(album.id)?.ownership !== "owned" &&
        !wantedIds.has(album.id)
      );
    }).length;
  }, [
    missingShelf.catalog,
    missingShelf.matchByAlbumId,
    wanted.snapshot.albums,
  ]);

  const queueDownload = (result: SearchResult) => {
    void transfers.enqueue(result).catch(() => undefined);
  };

  const expectedTrackCountFor = async (
    releaseGroupId: string | null,
    sourceCount: number,
  ) => {
    if (!native || !releaseGroupId) return sourceCount || null;
    try {
      const tracks = await loadOfficialTracklist(releaseGroupId);
      return Math.max(sourceCount, tracks.length) || null;
    } catch {
      return sourceCount || null;
    }
  };

  const officialTrackCountFor = async (album: AlbumReleaseGroup) => {
    if (!native) {
      return (
        new Map<string, number>([
          ["5b930454-b937-3d49-b26c-e82c4eded9bc", 10],
          ["d58266a8-e00c-3a64-b7e1-549e28f772ee", 11],
          ["2dca8523-24e2-3a51-8bb4-038e979e689b", 13],
          ["233dec0f-611d-36c6-8675-90fb53707adb", 14],
        ]).get(album.id) ?? null
      );
    }
    return await invoke<number | null>("album_official_track_count", {
      releaseGroupId: album.id,
    });
  };

  const queueAlbumSourceFor = async (
    context: AlbumSearchContext | null,
    source: AlbumSource,
    availableSources: AlbumSource[] = [],
  ) => {
    const inspection = await folders.inspect(
      source.representative,
      source.folders,
    );
    const expectedTrackCount = await expectedTrackCountFor(
      context?.albumId ?? null,
      source.tracks.length,
    );
    await transfers.enqueueRelease({
      title: albumDownloadTitle(context, source.folderName),
      username: source.owner,
      remoteFolder: inspection.requestedFolder,
      files: inspection.files,
      expectedTrackCount,
      releaseGroupId: context?.albumId ?? null,
      searchAlbum: context
        ? { artist: context.artist, title: context.title }
        : null,
      alternatives: availableSources
        .filter((candidate) => candidate.id !== source.id)
        .slice(0, 12)
        .map((candidate) => ({
          username: candidate.owner,
          remoteFolder: candidate.folder,
          files: candidate.files.flatMap((file) =>
            file.filename && file.sizeBytes
              ? [
                  {
                    title: file.filename.split(/[\\/]/).pop() ?? file.title,
                    remoteFilename: file.filename,
                    sizeBytes: file.sizeBytes,
                  },
                ]
              : [],
          ),
        }))
        .filter((candidate) => candidate.files.length > 0),
    });
  };

  const queueAlbumSource = async (source: AlbumSource) => {
    await queueAlbumSourceFor(
      albumContext,
      source,
      groupAlbumSources(search.results),
    );
  };

  const inspectSmartMatch = async (album: WantedAlbum) => {
    const source = album.bestSource;
    if (!source) return;
    const request = ++reviewRequest.current;
    reviewBusy.current = true;
    setReviewAlbum(album);
    setReviewInspection(null);
    setReviewOfficialTracks([]);
    setReviewTracklistState("loading");
    setReviewError(null);
    setReviewLoading(true);
    const result: SearchResult = {
      id: `wanted-${album.albumId}`,
      title: album.title,
      subtitle: source.folder,
      owner: source.username,
      trust: 100,
      format: source.format,
      quality: source.minimumBitrateKbps
        ? `${source.minimumBitrateKbps} kbps`
        : "Lossless",
      size: String(source.sizeBytes),
      tracks: source.trackCount,
      rating: 5,
      ratingLabel: "Smart Match",
      availability: [],
      source: "live",
      folder: source.folder,
      sizeBytes: source.sizeBytes,
      bitrate: source.minimumBitrateKbps,
      slotFree: source.slotFree,
      averageSpeed: source.averageSpeedBytesPerSecond,
      queueLength: source.queueLength,
      isPrivate: false,
    };
    const [inspectionResult, tracklistResult] = await Promise.allSettled([
      folders.inspect(result, source.folders),
      loadOfficialTracklist(album.albumId, album.selectedReleaseId ?? null),
    ]);
    if (request !== reviewRequest.current) return;
    reviewBusy.current = false;
    if (inspectionResult.status === "fulfilled")
      setReviewInspection(inspectionResult.value);
    else
      setReviewError(
        inspectionResult.reason instanceof Error
          ? inspectionResult.reason.message
          : String(inspectionResult.reason),
      );
    if (
      tracklistResult.status === "fulfilled" &&
      tracklistResult.value.length > 0
    ) {
      setReviewOfficialTracks(tracklistResult.value);
      setReviewTracklistState("ready");
    } else {
      setReviewOfficialTracks([]);
      setReviewTracklistState("unavailable");
    }
    setReviewLoading(false);
  };

  const selectReviewEdition = async (releaseId: string | null) => {
    if (!reviewAlbum) return;
    const album = reviewAlbum;
    const request = ++reviewRequest.current;
    reviewBusy.current = true;
    setReviewLoading(true);
    try {
      const tracks = await loadOfficialTracklist(album.albumId, releaseId);
      if (request !== reviewRequest.current) return;
      await wanted.setEdition(album.albumId, releaseId);
      if (request !== reviewRequest.current) return;
      setReviewAlbum({ ...album, selectedReleaseId: releaseId });
      setReviewOfficialTracks(tracks);
      setReviewTracklistState(tracks.length ? "ready" : "unavailable");
    } finally {
      if (request === reviewRequest.current) {
        reviewBusy.current = false;
        setReviewLoading(false);
      }
    }
  };

  const closeReview = () => {
    ++reviewRequest.current;
    reviewBusy.current = false;
    setReviewAlbum(null);
  };

  const queueReviewedSmartMatch = async () => {
    if (!reviewAlbum || !reviewInspection || reviewBusy.current) return;
    if (reviewAlbum.selectedReleaseId && reviewTracklistState !== "ready") {
      throw new Error("Load the selected edition before queueing.");
    }
    const request = reviewRequest.current;
    if (reviewOfficialTracks.length > 0) {
      const confidence = await tracklistConfidenceForInspection(
        reviewInspection,
        reviewOfficialTracks,
        reviewAlbum.artist,
      );
      if (!confidence.safeToRecommend) {
        throw new Error(
          "This folder does not match the official tracklist closely enough to queue as the recommended source. Compare alternatives instead.",
        );
      }
    }
    const inspectedAudioCount = reviewInspection.files.filter((file) =>
      [
        "aac",
        "aiff",
        "alac",
        "ape",
        "flac",
        "m4a",
        "mp3",
        "ogg",
        "opus",
        "wav",
        "wma",
        "wv",
      ].includes(file.extension.toLocaleLowerCase()),
    ).length;
    const expectedTrackCount =
      Math.max(reviewOfficialTracks.length, inspectedAudioCount) || null;
    if (request !== reviewRequest.current || reviewBusy.current) return;
    await transfers.enqueueRelease({
      title: albumDownloadTitle(
        {
          albumId: reviewAlbum.albumId,
          artist: reviewAlbum.artist,
          title: reviewAlbum.title,
          coverArtUrl: reviewAlbum.coverArtUrl ?? "",
          firstReleaseDate: reviewAlbum.firstReleaseDate,
        },
        reviewAlbum.title,
      ),
      username: reviewInspection.username,
      remoteFolder: reviewInspection.requestedFolder,
      files: reviewInspection.files,
      expectedTrackCount,
      releaseGroupId: reviewAlbum.albumId,
      searchAlbum: { artist: reviewAlbum.artist, title: reviewAlbum.title },
    });
  };

  const openAlbumSources = (context: AlbumSearchContext) => {
    const nextQuery = `${context.artist} ${context.title}`;
    const sessionId = dial.create({
      mode: "files",
      query: nextQuery,
      albumContext: context,
      albumResultView: "sources",
    });
    if (!sessionId) return;
    setActiveView("search");
    void search
      .startSearch(sessionId, nextQuery, context)
      .catch(() => undefined);
  };

  const navigate = (view: ViewId) => {
    if (view === "transfers") {
      setTransferShelfExpanded(false);
      setTransferFocus(null);
    }
    if (view === "messages") {
      const unread = messages.snapshot.conversations.find(
        (conversation) => conversation.unreadCount > 0,
      );
      const next =
        messages.snapshot.conversations.find(
          (conversation) =>
            conversation.username.toLocaleLowerCase() ===
            selectedMessageUsername?.toLocaleLowerCase(),
        ) ??
        unread ??
        messages.snapshot.conversations[0];
      if (next) setSelectedMessageUsername(next.username);
    }
    if (view === "archive") setArchiveFocus(null);
    if (view === "rooms") setRoomFocus(null);
    setActiveView(view);
  };

  const openTransfer = (groupId: string) => {
    setTransferFocus({ groupId, requestId: Date.now() });
    setTransferShelfExpanded(false);
    setActiveView("transfers");
  };

  const openArchive = (tab: "arrivals" | "missing" | "wanted") => {
    setArchiveFocus({ tab, requestId: Date.now() });
    setActiveView("archive");
    if (tab === "missing") void missingShelf.activate().catch(() => undefined);
  };

  const openRoom = (roomName: string | null) => {
    setRoomFocus({ roomName, requestId: Date.now() });
    setActiveView("rooms");
  };

  useEffect(() => {
    if (!transfers.activityNotice) return;
    const timer = window.setTimeout(transfers.clearActivityNotice, 6_000);
    return () => window.clearTimeout(timer);
  }, [transfers.activityNotice, transfers.clearActivityNotice]);

  const browseUser = (username: string) => {
    setSharesUsername(username);
    setActiveView("browse");
    void shares.browse(username).catch(() => undefined);
  };

  const openPerson = (username: string, refresh = false) => {
    setSelectedUsername(username);
    setActiveView("people");
    void people.openProfile(username, refresh).catch(() => undefined);
  };

  const openMessages = (username: string) => {
    setSelectedMessageUsername(username);
    setActiveView("messages");
    void messages.openConversation(username).catch(() => undefined);
  };

  const isFileSearchView =
    activeView === "search" &&
    searchMode === "files" &&
    (!albumContext || albumResultView === "files");
  const {
    activeId: shortcutActiveId,
    close: closeDialShortcut,
    create: createDialShortcut,
    cycle: cycleDialShortcut,
  } = dial;
  const { closeSearch: closeSearchShortcut, markSeen: markSeenShortcut } =
    search;

  useEffect(() => {
    const handleDialShortcut = (event: globalThis.KeyboardEvent) => {
      if (activeView !== "search" || !event.ctrlKey || event.altKey) return;
      if (event.key.toLocaleLowerCase() === "t") {
        event.preventDefault();
        createDialShortcut({ mode: "files" });
      } else if (event.key.toLocaleLowerCase() === "w") {
        event.preventDefault();
        closeDialShortcut(shortcutActiveId);
        void closeSearchShortcut(shortcutActiveId);
      } else if (event.key === "Tab") {
        event.preventDefault();
        const nextId = cycleDialShortcut(event.shiftKey ? -1 : 1);
        if (nextId) markSeenShortcut(nextId);
      }
    };
    window.addEventListener("keydown", handleDialShortcut);
    return () => window.removeEventListener("keydown", handleDialShortcut);
  }, [
    activeView,
    shortcutActiveId,
    closeDialShortcut,
    closeSearchShortcut,
    createDialShortcut,
    cycleDialShortcut,
    markSeenShortcut,
  ]);

  return {
    activeView,
    albumContext,
    albumResultView,
    albums,
    appSettings,
    archive,
    archiveFocus,
    archiveOwnedReleaseIds,
    browseUser,
    changeSearchMode,
    closeReview,
    connection,
    dial,
    findRelaySources,
    folders,
    inspectSmartMatch,
    isFileSearchView,
    loadEditions,
    loadOfficialTracklist,
    messages,
    missingShelf,
    discovery,
    releaseRadar,
    missingStudioCount,
    musicBrainzFallbackTrackCount,
    native,
    navigate,
    officialTrackCountFor,
    onboardingOpen,
    openAlbumSources,
    openArchive,
    openMessages,
    openPerson,
    openRoom,
    openTransfer,
    pauseSafelyAndExit,
    people,
    preferencesAlbum,
    query,
    queueAlbumSource,
    queueAlbumSourceFor,
    queueDownload,
    queueReviewedSmartMatch,
    radar,
    relayNotice,
    relayReleaseSource,
    reviewAlbum,
    reviewError,
    reviewInspection,
    reviewLoading,
    reviewOfficialTracks,
    reviewTracklistState,
    roomFocus,
    rooms,
    safeExitError,
    safeExitOpen,
    safeExitPreparing,
    safeExitPreview,
    search,
    searchMode,
    selectReviewEdition,
    selectedMessageUsername,
    selectedResult,
    selectedUsername,
    setActiveView,
    setAlbumContext,
    setAlbumResultView,
    setOnboardingDismissed,
    setOnboardingInProgress,
    setPreferencesAlbum,
    setQuery,
    setRelayNotice,
    keepRunning,
    setSearchMode,
    setSelectedMessageUsername,
    setSelectedResultId,
    setSharesUsername,
    setTransferShelfExpanded,
    shares,
    sharesUsername,
    sharing,
    transferFocus,
    transferGroups,
    transferShelfExpanded,
    transfers,
    updater,
    wanted,
    wantedDownloadStateByAlbumId,
  };
}
export type ShellModel = ReturnType<typeof useShellController>;
