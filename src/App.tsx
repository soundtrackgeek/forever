import { CheckCircle, DownloadSimple, MagnifyingGlass, Radio, Sliders, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AppSidebar } from "./components/AppSidebar";
import { AlbumSearchWorkspace } from "./components/AlbumSearchWorkspace";
import { ArchiveWorkspace } from "./components/ArchiveWorkspace";
import { BrowseSharesHome } from "./components/BrowseSharesHome";
import { ConnectionOnboarding } from "./components/ConnectionOnboarding";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { MessagesWorkspace } from "./components/MessagesWorkspace";
import { MissingShelfWorkspace } from "./components/MissingShelfWorkspace";
import { ReleaseInspector } from "./components/ReleaseInspector";
import { PeopleWorkspace } from "./components/PeopleWorkspace";
import { RoomsWorkspace } from "./components/RoomsWorkspace";
import { SearchWorkspace, type AlbumResultView } from "./components/SearchWorkspace";
import { SmartMatchPreferencesDialog } from "./components/SmartMatchPreferencesDialog";
import { SmartMatchReviewDialog } from "./components/SmartMatchReviewDialog";
import type { SearchMode } from "./components/SearchModeSwitch";
import { TransferShelf } from "./components/TransferShelf";
import { TransfersWorkspace } from "./components/TransfersWorkspace";
import { UserSharesWorkspace } from "./components/UserSharesWorkspace";
import { UpdateExperience } from "./components/UpdateExperience";
import { WindowControls } from "./components/WindowControls";
import { WantedAlert } from "./components/WantedAlert";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { useArchiveInventory } from "./hooks/useArchiveInventory";
import { useAlbumDiscovery } from "./hooks/useAlbumDiscovery";
import { useSoulseekConnection } from "./hooks/useSoulseekConnection";
import { useSoulseekFolders } from "./hooks/useSoulseekFolders";
import { useSoulseekPeople } from "./hooks/useSoulseekPeople";
import { useSoulseekSearch } from "./hooks/useSoulseekSearch";
import { useSoulseekShares } from "./hooks/useSoulseekShares";
import { useSoulseekTransfers } from "./hooks/useSoulseekTransfers";
import { useLocalSharing } from "./hooks/useLocalSharing";
import { useMissingShelf } from "./hooks/useMissingShelf";
import { usePrivateMessages } from "./hooks/usePrivateMessages";
import { useSoulseekRooms } from "./hooks/useSoulseekRooms";
import { useShelfRadar } from "./hooks/useShelfRadar";
import { useWantedAlbums } from "./hooks/useWantedAlbums";
import type {
  AlbumReleaseGroup,
  AlbumSearchContext,
  AlbumSource,
  FolderInspection,
  SearchResult,
  WantedAlbum,
} from "./types";
import { groupAlbumSources } from "./utils/albumSources";

const emptyAlbumCatalog: AlbumReleaseGroup[] = [];

const albumDownloadTitle = (
  context: AlbumSearchContext | null,
  fallback: string,
) => {
  if (!context) return fallback;
  const year = context.firstReleaseDate?.match(/^\d{4}/)?.[0];
  return `${context.artist} - ${context.title}${year ? ` (${year})` : ""}`;
};

const viewDetails = {
  home: {
    icon: Radio,
    title: "The signal starts here",
    copy: "Home discovery will arrive after the first search-and-download release.",
  },
  transfers: {
    icon: DownloadSimple,
    title: "Every file, still in sight",
    copy: "Pause, resume, retry, or reveal a download from the live shelf below.",
  },
  settings: {
    icon: Sliders,
    title: "Essential settings",
    copy: "Connection, download location, and update preferences will live here.",
  },
};

function PlaceholderView({
  view,
  onReturnToSearch,
  onCheckForUpdates,
}: {
  view: keyof typeof viewDetails;
  onReturnToSearch: () => void;
  onCheckForUpdates: () => void;
}) {
  const detail = viewDetails[view];
  const Icon = detail.icon;

  return (
    <section className="placeholder-view">
      <span className="placeholder-icon">
        <Icon size={26} weight="light" />
      </span>
      <h1>{detail.title}</h1>
      <p>{detail.copy}</p>
      <div>
        <button type="button" className="primary-action" onClick={onReturnToSearch}>
          <MagnifyingGlass size={17} /> Return to search
        </button>
        {view === "settings" && (
          <button type="button" className="secondary-text-button" onClick={onCheckForUpdates}>
            Check for updates
          </button>
        )}
      </div>
    </section>
  );
}

function App() {
  const [activeView, setActiveView] = useState("search");
  const [transferShelfExpanded, setTransferShelfExpanded] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("files");
  const [albumContext, setAlbumContext] = useState<AlbumSearchContext | null>(null);
  const [albumResultView, setAlbumResultView] = useState<AlbumResultView>("files");
  const [query, setQuery] = useState("night geometry");
  const [selectedResultId, setSelectedResultId] = useState<string | null>(
    "night-geometry",
  );
  const updater = useAppUpdater();
  const albums = useAlbumDiscovery();
  const archiveAlbums = albums.catalog?.albums ?? emptyAlbumCatalog;
  const wanted = useWantedAlbums();
  const missingShelf = useMissingShelf();
  const radar = useShelfRadar();
  const archive = useArchiveInventory(
    albums.selectedArtist?.name ?? null,
    archiveAlbums,
    wanted.snapshot.albums,
  );
  const connection = useSoulseekConnection();
  const search = useSoulseekSearch();
  const transfers = useSoulseekTransfers();
  const sharing = useLocalSharing();
  const folders = useSoulseekFolders();
  const shares = useSoulseekShares();
  const people = useSoulseekPeople();
  const messages = usePrivateMessages();
  const rooms = useSoulseekRooms();
  const [sharesUsername, setSharesUsername] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>("audiophile92");
  const [selectedMessageUsername, setSelectedMessageUsername] = useState<string | null>(
    "audiophile92",
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingInProgress, setOnboardingInProgress] = useState(false);
  const [preferencesAlbum, setPreferencesAlbum] = useState<WantedAlbum | null>(null);
  const [reviewAlbum, setReviewAlbum] = useState<WantedAlbum | null>(null);
  const [reviewInspection, setReviewInspection] = useState<FolderInspection | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const lastFulfillmentSync = useRef("");
  const needsOnboarding = !connection.profile || !connection.hasPassword;
  const onboardingOpen =
    connection.ready &&
    (needsOnboarding || onboardingInProgress) &&
    !onboardingDismissed;

  const selectedResult =
    search.results.find((result) => result.id === selectedResultId) ??
    search.results[0] ??
    null;

  const fulfillmentRequests = useMemo(() => wanted.snapshot.albums.flatMap((album) => {
    const match = archive.wantedMatchByAlbumId.get(album.albumId);
    if (!match || match.ownership === "unknown") return [];
    return [{
      albumId: album.albumId,
      owned: match.ownership === "owned",
      trackCount: match.trackCount,
    }];
  }), [archive.wantedMatchByAlbumId, wanted.snapshot.albums]);
  const fulfillmentSignature = useMemo(
    () => fulfillmentRequests
      .map((item) => `${item.albumId}:${item.owned ? 1 : 0}:${item.trackCount ?? ""}`)
      .sort()
      .join("|"),
    [fulfillmentRequests],
  );

  useEffect(() => {
    if (!fulfillmentSignature || lastFulfillmentSync.current === fulfillmentSignature) return;
    lastFulfillmentSync.current = fulfillmentSignature;
    void wanted.syncFulfilled(fulfillmentRequests).catch(() => {
      lastFulfillmentSync.current = "";
    });
  }, [fulfillmentRequests, fulfillmentSignature, wanted]);

  const queuedWantedAlbumIds = useMemo(() => {
    const releaseTitles = new Set(
      transfers.snapshot.transfers
        .map((transfer) => transfer.releaseTitle)
        .filter((title): title is string => Boolean(title)),
    );
    return new Set(wanted.snapshot.albums
      .filter((album) => releaseTitles.has(albumDownloadTitle({
        albumId: album.albumId,
        artist: album.artist,
        title: album.title,
        coverArtUrl: album.coverArtUrl ?? "",
        firstReleaseDate: album.firstReleaseDate,
      }, album.title)))
      .map((album) => album.albumId));
  }, [transfers.snapshot.transfers, wanted.snapshot.albums]);

  const queueDownload = (result: SearchResult) => {
    void transfers.enqueue(result).catch(() => undefined);
  };

  const queueAlbumSourceFor = async (
    context: AlbumSearchContext | null,
    source: AlbumSource,
    availableSources: AlbumSource[] = [],
  ) => {
    const inspection = await folders.inspect(source.representative);
    await transfers.enqueueRelease({
      title: albumDownloadTitle(context, source.folderName),
      username: source.owner,
      remoteFolder: inspection.requestedFolder,
      files: inspection.files,
      alternatives: availableSources
        .filter((candidate) => candidate.id !== source.id)
        .slice(0, 12)
        .map((candidate) => ({
          username: candidate.owner,
          remoteFolder: candidate.folder,
          files: candidate.files.flatMap((file) =>
            file.filename && file.sizeBytes
              ? [{ title: file.filename.split(/[\\/]/).pop() ?? file.title, remoteFilename: file.filename, sizeBytes: file.sizeBytes }]
              : [],
          ),
        }))
        .filter((candidate) => candidate.files.length > 0),
    });
  };

  const queueAlbumSource = async (source: AlbumSource) => {
    await queueAlbumSourceFor(albumContext, source, groupAlbumSources(search.results));
  };

  const inspectSmartMatch = async (album: WantedAlbum) => {
    const source = album.bestSource;
    if (!source) return;
    setReviewAlbum(album);
    setReviewInspection(null);
    setReviewError(null);
    setReviewLoading(true);
    const result: SearchResult = {
      id: `wanted-${album.albumId}`,
      title: album.title,
      subtitle: source.folder,
      owner: source.username,
      trust: 100,
      format: source.format,
      quality: source.minimumBitrateKbps ? `${source.minimumBitrateKbps} kbps` : "Lossless",
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
    try {
      setReviewInspection(await folders.inspect(result));
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReviewLoading(false);
    }
  };

  const queueReviewedSmartMatch = async () => {
    if (!reviewAlbum || !reviewInspection) return;
    await transfers.enqueueRelease({
      title: albumDownloadTitle({
        albumId: reviewAlbum.albumId,
        artist: reviewAlbum.artist,
        title: reviewAlbum.title,
        coverArtUrl: reviewAlbum.coverArtUrl ?? "",
        firstReleaseDate: reviewAlbum.firstReleaseDate,
      }, reviewAlbum.title),
      username: reviewInspection.username,
      remoteFolder: reviewInspection.requestedFolder,
      files: reviewInspection.files,
    });
  };

  const openAlbumSources = (context: AlbumSearchContext) => {
    const nextQuery = `${context.artist} ${context.title}`;
    setQuery(nextQuery);
    setSelectedResultId(null);
    setAlbumContext(context);
    setAlbumResultView("sources");
    setSearchMode("files");
    setActiveView("search");
    void search.startSearch(nextQuery).catch(() => undefined);
  };

  const navigate = (view: string) => {
    if (view === "transfers") {
      setTransferShelfExpanded(false);
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
    setActiveView(view);
  };

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

  return (
    <div
      className={
        transferShelfExpanded ? "app-frame is-transfer-shelf-expanded" : "app-frame"
      }
    >
      <header className="titlebar" data-tauri-drag-region>
        <span data-tauri-drag-region>Forever pre-alpha</span>
        <WindowControls />
      </header>

      <div className={`app-shell ${isFileSearchView ? "" : "is-single-view"}`}>
        <AppSidebar
          activeView={activeView}
          updateStatus={updater.status}
          username={connection.snapshot.username}
          connectionState={connection.snapshot.state}
          unreadMessages={messages.snapshot.unreadCount}
          unreadRooms={rooms.snapshot.unreadCount}
          onNavigate={navigate}
          onCheckForUpdates={() => void updater.checkForUpdates(true)}
        />

        {activeView === "search" && searchMode === "files" ? (
          <>
            <SearchWorkspace
              searchMode={searchMode}
              albumContext={albumContext}
              albumResultView={albumResultView}
              archiveConnected={Boolean(archive.status?.connected)}
              archiveLoading={archive.loading || archive.matching}
              archiveMatch={
                albumContext
                  ? archive.matchByAlbumId.get(albumContext.albumId)
                  : undefined
              }
              wantedAlbum={albumContext ? wanted.byAlbumId.get(albumContext.albumId) ?? null : null}
              query={query}
              results={search.results}
              transfers={transfers.snapshot.transfers}
              selectedResult={selectedResult}
              search={search.snapshot}
              searchError={search.error}
              connection={connection.snapshot}
              onOpenConnection={() => setActiveView("settings")}
              onQueryChange={setQuery}
              onSearch={(nextQuery) => {
                const normalizedQuery = nextQuery.trim();
                setQuery(normalizedQuery);
                setSelectedResultId(null);
                setAlbumContext(null);
                setAlbumResultView("files");
                void search.startSearch(normalizedQuery).catch(() => undefined);
              }}
              onStopSearch={() => void search.stopSearch()}
              onSelectResult={(result) => {
                setSelectedResultId(result.id);
                folders.clear();
              }}
              onQueueDownload={queueDownload}
              onQueueAlbumSource={queueAlbumSource}
              onBrowseUser={browseUser}
              personByUsername={people.personByUsername}
              onOpenPerson={openPerson}
              onSearchModeChange={setSearchMode}
              onAlbumResultViewChange={setAlbumResultView}
              onToggleWanted={() => {
                if (!albumContext) return Promise.resolve();
                if (wanted.byAlbumId.has(albumContext.albumId)) {
                  return wanted.remove(albumContext.albumId);
                }
                return wanted.add(albumContext.artist, {
                  id: albumContext.albumId,
                  title: albumContext.title,
                  firstReleaseDate: albumContext.firstReleaseDate,
                  primaryType: "Album",
                  secondaryTypes: [],
                  coverArtUrl: albumContext.coverArtUrl,
                });
              }}
            />
            {isFileSearchView ? <ReleaseInspector
              result={selectedResult}
              inspection={folders.inspection}
              folderLoading={folders.loading}
              folderError={folders.error}
              onInspectFolder={(result) => {
                void folders.inspect(result).catch(() => undefined);
              }}
              onQueueDownload={queueDownload}
              onBrowseUser={browseUser}
              person={selectedResult ? people.personByUsername(selectedResult.owner) : null}
              onOpenPerson={openPerson}
              onQueueRelease={(result, title, inspection, files) => {
                void transfers
                  .enqueueRelease({
                    title,
                    username: result.owner,
                    remoteFolder: inspection.requestedFolder,
                    files,
                  })
                  .then(() => navigate("transfers"))
                  .catch(() => undefined);
              }}
            /> : null}
          </>
        ) : activeView === "search" ? (
          <AlbumSearchWorkspace
            query={albums.query}
            artists={albums.artists}
            selectedArtist={albums.selectedArtist}
            catalog={albums.catalog}
            loading={albums.loading}
            error={albums.error}
            connection={connection.snapshot}
            searchMode={searchMode}
            archiveConnected={Boolean(archive.status?.connected)}
            archiveLoading={archive.loading || archive.matching}
            archiveMatches={archive.matchByAlbumId}
            wantedAlbums={wanted.byAlbumId}
            onQueryChange={albums.setQuery}
            onSearch={(artistQuery) => {
              void albums.searchArtists(artistQuery).catch(() => undefined);
            }}
            onSelectArtist={(artist) => {
              void albums.selectArtist(artist).catch(() => undefined);
            }}
            onSearchModeChange={setSearchMode}
            onAddWanted={wanted.add}
            onRemoveWanted={wanted.remove}
            onSearchSoulseek={(artist, album) => {
              openAlbumSources({
                albumId: album.id,
                artist,
                title: album.title,
                coverArtUrl: album.coverArtUrl,
                firstReleaseDate: album.firstReleaseDate,
              });
            }}
            onOpenConnection={() => setActiveView("settings")}
            onDismissError={albums.clearError}
          />
        ) : activeView === "archive" ? (
          <ArchiveWorkspace
            status={archive.status}
            loading={archive.loading}
            error={archive.error}
            wanted={wanted.snapshot}
            wantedReady={wanted.ready}
            wantedError={wanted.error}
            online={connection.snapshot.state === "online"}
            onRefresh={async () => {
              missingShelf.clearCache();
              return await archive.refresh();
            }}
            onSetWantedInterval={wanted.setIntervalMinutes}
            onCheckWanted={wanted.check}
            onSetWantedPaused={wanted.setPaused}
            onRemoveWanted={wanted.remove}
            queuedAlbumIds={queuedWantedAlbumIds}
            onReviewBest={(album) => void inspectSmartMatch(album)}
            onEditPreferences={setPreferencesAlbum}
            onOpenWanted={(album) => openAlbumSources({
              albumId: album.albumId,
              artist: album.artist,
              title: album.title,
              coverArtUrl: album.coverArtUrl ?? "",
              firstReleaseDate: album.firstReleaseDate,
            })}
            onDismissWantedError={wanted.clearError}
            onOpenMissing={() => void missingShelf.activate().catch(() => undefined)}
            missingShelf={(
              <MissingShelfWorkspace
                query={missingShelf.query}
                artists={missingShelf.artists}
                artistsTruncated={missingShelf.artistsTruncated}
                selectedArtist={missingShelf.selectedArtist}
                identityOptions={missingShelf.identityOptions}
                catalog={missingShelf.catalog}
                catalogSource={missingShelf.catalogSource}
                catalogFetchedAt={missingShelf.catalogFetchedAt}
                loading={missingShelf.loading}
                error={missingShelf.error ?? radar.error ?? wanted.error}
                matchByAlbumId={missingShelf.matchByAlbumId}
                wantedAlbums={wanted.snapshot.albums}
                online={connection.snapshot.state === "online"}
                radarReady={radar.ready}
                radarSnapshot={radar.snapshot}
                radarScans={radar.scansByAlbumId}
                radarResults={radar.resultsByAlbumId}
                onSearchArtists={missingShelf.loadArtists}
                onSelectArtist={missingShelf.loadCatalog}
                onSelectIdentity={missingShelf.selectIdentity}
                onAddMany={wanted.addMany}
                onScan={radar.start}
                onStopScan={radar.stop}
                onQueueSource={(album, source, sources) => queueAlbumSourceFor({
                  albumId: album.id,
                  artist: missingShelf.selectedArtist?.canonicalName ?? missingShelf.selectedArtist?.name ?? "Unknown artist",
                  title: album.title,
                  coverArtUrl: album.coverArtUrl,
                  firstReleaseDate: album.firstReleaseDate,
                }, source, sources)}
                onDismissError={() => {
                  missingShelf.clearError();
                  radar.clearError();
                  wanted.clearError();
                }}
              />
            )}
          />
        ) : activeView === "rooms" ? (
          <RoomsWorkspace
            snapshot={rooms.snapshot}
            ready={rooms.ready}
            error={rooms.error ?? people.error}
            people={people.snapshot}
            onRefresh={rooms.refresh}
            onJoin={rooms.join}
            onLeave={rooms.leave}
            onSend={rooms.send}
            onMarkRead={rooms.markRead}
            onSetRoomFavorite={rooms.setFavorite}
            onOpenPerson={openPerson}
            onMessageUser={openMessages}
            onBrowseUser={browseUser}
            onSetPersonFavorite={(username, favorite) =>
              void people.setFavorite(username, favorite).catch(() => undefined)
            }
            onSetIgnored={(username, ignored) =>
              void people.setIgnored(username, ignored).catch(() => undefined)
            }
            onSetBlocked={(username, blocked) =>
              void people.setBlocked(username, blocked).catch(() => undefined)
            }
            onDismissError={() => {
              rooms.clearError();
              people.clearError();
            }}
          />
        ) : activeView === "messages" ? (
          <MessagesWorkspace
            snapshot={messages.snapshot}
            ready={messages.ready}
            error={messages.error ?? people.error}
            connectionOnline={connection.snapshot.state === "online"}
            selectedUsername={selectedMessageUsername}
            personByUsername={people.personByUsername}
            onSelectUsername={setSelectedMessageUsername}
            onOpenConversation={async (username) => {
              await messages.openConversation(username);
              if (connection.snapshot.state === "online") {
                void people.openProfile(username).catch(() => undefined);
              }
            }}
            onSendMessage={messages.send}
            onRetryMessage={messages.retry}
            onMarkRead={messages.markRead}
            onMarkUnread={messages.markUnread}
            onClearConversation={messages.clearConversation}
            onRemoveConversation={messages.removeConversation}
            onSetIgnored={(username, ignored) =>
              void people.setIgnored(username, ignored).catch(() => undefined)
            }
            onSetBlocked={(username, blocked) =>
              void people.setBlocked(username, blocked).catch(() => undefined)
            }
            onOpenPerson={openPerson}
            onDismissError={() => {
              messages.clearError();
              people.clearError();
            }}
          />
        ) : activeView === "people" ? (
          <PeopleWorkspace
            snapshot={people.snapshot}
            ready={people.ready}
            error={people.error ?? messages.error}
            selectedUsername={selectedUsername}
            onSelect={openPerson}
            onBrowseUser={browseUser}
            onSetFavorite={(username, favorite) =>
              void people.setFavorite(username, favorite).catch(() => undefined)
            }
            onSetBlocked={(username, blocked) =>
              void people.setBlocked(username, blocked).catch(() => undefined)
            }
            onSetIgnored={(username, ignored) =>
              void people.setIgnored(username, ignored).catch(() => undefined)
            }
            conversationUnreadCount={
              selectedUsername
                ? messages.conversationByUsername(selectedUsername)?.unreadCount ?? 0
                : 0
            }
            onMessageUser={openMessages}
            onDismissError={() => {
              people.clearError();
              messages.clearError();
            }}
          />
        ) : activeView === "browse" ? (
          sharesUsername ? (
            <UserSharesWorkspace
              key={sharesUsername}
              username={sharesUsername}
              overview={shares.overview}
              folder={shares.folder}
              results={shares.results}
              loading={shares.loading}
              error={shares.error}
              person={people.personByUsername(sharesUsername)}
              onBrowseAnother={() => {
                setSharesUsername(null);
                shares.clear();
              }}
              onOpenPerson={() => openPerson(sharesUsername)}
              onRefresh={() => void shares.browse(sharesUsername, true).catch(() => undefined)}
              onOpenFolder={(directory) =>
                void shares.openFolder(sharesUsername, directory).catch(() => undefined)
              }
              onSearch={(shareQuery, extension) =>
                void shares.search(sharesUsername, shareQuery, extension).catch(() => undefined)
              }
              onDownload={(title, remoteFolder, files) => {
                void transfers
                  .enqueueRelease({
                    title,
                    username: sharesUsername,
                    remoteFolder,
                    files,
                  })
                  .then(() => navigate("transfers"))
                  .catch(() => undefined);
              }}
            />
          ) : (
            <BrowseSharesHome
              people={people.snapshot}
              connection={connection.snapshot}
              onBrowse={browseUser}
              onOpenConnection={() => setActiveView("settings")}
            />
          )
        ) : activeView === "transfers" ? (
          <TransfersWorkspace
            transfers={transfers.snapshot.transfers}
            uploads={sharing.uploads.uploads}
            uploadError={sharing.error}
            error={transfers.error}
            onPause={(id) => void transfers.pause(id).catch(() => undefined)}
            onResume={(id) => void transfers.resume(id).catch(() => undefined)}
            onCancel={(id) => void transfers.cancel(id).catch(() => undefined)}
            onReveal={(id) => void transfers.reveal(id).catch(() => undefined)}
            onPauseRelease={(id) => void transfers.pauseRelease(id).catch(() => undefined)}
            onResumeRelease={(id) => void transfers.resumeRelease(id).catch(() => undefined)}
            onCancelRelease={(id) => void transfers.cancelRelease(id).catch(() => undefined)}
            onRevealRelease={(id) => void transfers.revealRelease(id).catch(() => undefined)}
            onReorderRelease={(id, beforeTransferId) => void transfers.reorderRelease(id, beforeTransferId).catch(() => undefined)}
            onClearCompleted={() => void transfers.clearCompleted().catch(() => undefined)}
            onVerifyRelease={(id) => void transfers.verifyRelease(id).catch(() => undefined)}
            onRetryReleaseIssues={(id) => void transfers.retryReleaseIssues(id).catch(() => undefined)}
            onSwitchReleaseSource={(id, source) => void transfers.switchReleaseSource(id, source).catch(() => undefined)}
            onDismissError={transfers.clearError}
            personByUsername={people.personByUsername}
            onOpenPerson={openPerson}
            onCancelUpload={(id) => void sharing.cancelUpload(id).catch(() => undefined)}
            onClearFinishedUploads={() => void sharing.clearFinishedUploads().catch(() => undefined)}
            onDismissUploadError={sharing.clearError}
          />
        ) : activeView === "settings" && connection.profile ? (
          <ConnectionSettings
            profile={connection.profile}
            hasPassword={connection.hasPassword}
            snapshot={connection.snapshot}
            searchNetwork={connection.searchNetwork}
            diagnostics={connection.diagnostics}
            diagnosticsPath={connection.diagnosticsPath}
            error={connection.error}
            onSave={connection.saveProfile}
            onConnect={connection.connect}
            onDisconnect={connection.disconnect}
            onReset={async () => {
              await connection.reset();
              setOnboardingDismissed(false);
            }}
            onLoadDiagnostics={connection.loadDiagnostics}
            onCheckForUpdates={() => void updater.checkForUpdates(true)}
            updateCheckIntervalMinutes={updater.updateCheckIntervalMinutes}
            onUpdateCheckIntervalChange={
              updater.setUpdateCheckIntervalMinutes
            }
            localShares={sharing.shares}
            sharingError={sharing.error}
            onAddShare={sharing.addRoot}
            onRemoveShare={sharing.removeRoot}
            onSetShareEnabled={sharing.setRootEnabled}
            onRescanShares={sharing.rescan}
            onSetUploadSlots={sharing.setUploadSlots}
            messageNotificationsEnabled={messages.notificationsEnabled}
            onMessageNotificationsChange={messages.setNotificationsEnabled}
            roomNotificationsEnabled={rooms.notificationsEnabled}
            onRoomNotificationsChange={rooms.setNotificationsEnabled}
          />
        ) : (
          <PlaceholderView
            view={activeView as keyof typeof viewDetails}
            onReturnToSearch={() => setActiveView("search")}
            onCheckForUpdates={() => void updater.checkForUpdates(true)}
          />
        )}
      </div>

      <TransferShelf
        expanded={transferShelfExpanded}
        transfers={transfers.snapshot.transfers}
        activeCount={transfers.snapshot.activeCount}
        error={transfers.error}
        onPause={(id) => void transfers.pause(id).catch(() => undefined)}
        onResume={(id) => void transfers.resume(id).catch(() => undefined)}
        onCancel={(id) => void transfers.cancel(id).catch(() => undefined)}
        onReveal={(id) => void transfers.reveal(id).catch(() => undefined)}
        onPauseRelease={(id) => void transfers.pauseRelease(id).catch(() => undefined)}
        onResumeRelease={(id) => void transfers.resumeRelease(id).catch(() => undefined)}
        onCancelRelease={(id) => void transfers.cancelRelease(id).catch(() => undefined)}
        onRevealRelease={(id) => void transfers.revealRelease(id).catch(() => undefined)}
        onViewAll={() => navigate("transfers")}
        onDismissError={transfers.clearError}
        personByUsername={people.personByUsername}
        onOpenPerson={openPerson}
        onToggle={() => setTransferShelfExpanded((expanded) => !expanded)}
      />

      {transfers.completionNotice ? (
        <aside className={`finish-line-toast is-${transfers.completionNotice.kind}`} role="status" aria-live="polite">
          <button type="button" className="finish-line-toast-open" onClick={() => navigate("transfers")}>
            <span>{transfers.completionNotice.kind === "verified" ? <CheckCircle size={19} weight="fill" /> : <WarningCircle size={19} weight="fill" />}</span>
            <span><small>{transfers.completionNotice.kind === "verified" ? "Download verified" : "Completed with issues"}</small><strong>{transfers.completionNotice.title}</strong><p>{transfers.completionNotice.message}</p></span>
          </button>
          <button type="button" className="finish-line-toast-dismiss" aria-label="Dismiss download notification" onClick={transfers.clearCompletionNotice}><X size={14} /></button>
        </aside>
      ) : null}

      <UpdateExperience {...updater} />

      {preferencesAlbum ? (
        <SmartMatchPreferencesDialog
          key={preferencesAlbum.albumId}
          album={wanted.byAlbumId.get(preferencesAlbum.albumId) ?? preferencesAlbum}
          onSave={(preferences) => wanted.setPreferences(preferencesAlbum.albumId, preferences)}
          onClose={() => setPreferencesAlbum(null)}
        />
      ) : null}

      {reviewAlbum ? (
        <SmartMatchReviewDialog
          album={wanted.byAlbumId.get(reviewAlbum.albumId) ?? reviewAlbum}
          inspection={reviewInspection}
          loading={reviewLoading}
          error={reviewError}
          queued={queuedWantedAlbumIds.has(reviewAlbum.albumId)}
          onConfirm={queueReviewedSmartMatch}
          onRetry={() => void inspectSmartMatch(reviewAlbum)}
          onCompare={() => {
            setReviewAlbum(null);
            openAlbumSources({
              albumId: reviewAlbum.albumId,
              artist: reviewAlbum.artist,
              title: reviewAlbum.title,
              coverArtUrl: reviewAlbum.coverArtUrl ?? "",
              firstReleaseDate: reviewAlbum.firstReleaseDate,
            });
          }}
          onClose={() => setReviewAlbum(null)}
        />
      ) : null}

      {wanted.alert ? (
        <WantedAlert
          album={wanted.alert}
          onReview={() => {
            const album = wanted.alert;
            if (!album) return;
            wanted.dismissAlert();
            void inspectSmartMatch(album);
          }}
          onCompare={() => {
            const album = wanted.alert;
            if (!album) return;
            wanted.dismissAlert();
            openAlbumSources({
              albumId: album.albumId,
              artist: album.artist,
              title: album.title,
              coverArtUrl: album.coverArtUrl ?? "",
              firstReleaseDate: album.firstReleaseDate,
            });
          }}
          onDismiss={wanted.dismissAlert}
        />
      ) : null}

      {onboardingOpen && connection.ready && (
        <ConnectionOnboarding
          profile={connection.profile ?? connection.suggestedProfile}
          hasPassword={connection.hasPassword}
          snapshot={connection.snapshot}
          error={connection.error}
          onSave={(profile, password) => {
            setOnboardingInProgress(true);
            return connection.saveProfile(profile, password);
          }}
          onConnect={connection.connect}
          onComplete={() => {
            setOnboardingInProgress(false);
            setOnboardingDismissed(true);
          }}
          onExploreOffline={() => {
            setOnboardingInProgress(false);
            setOnboardingDismissed(true);
          }}
        />
      )}
    </div>
  );
}

export default App;
