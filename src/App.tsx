import { DownloadSimple, MagnifyingGlass, Radio, Sliders } from "@phosphor-icons/react";
import { useState } from "react";
import "./App.css";
import { AppSidebar } from "./components/AppSidebar";
import { AlbumSearchWorkspace } from "./components/AlbumSearchWorkspace";
import { ArchiveWorkspace } from "./components/ArchiveWorkspace";
import { BrowseSharesHome } from "./components/BrowseSharesHome";
import { ConnectionOnboarding } from "./components/ConnectionOnboarding";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { MessagesWorkspace } from "./components/MessagesWorkspace";
import { ReleaseInspector } from "./components/ReleaseInspector";
import { PeopleWorkspace } from "./components/PeopleWorkspace";
import { SearchWorkspace, type AlbumResultView } from "./components/SearchWorkspace";
import type { SearchMode } from "./components/SearchModeSwitch";
import { TransferShelf } from "./components/TransferShelf";
import { TransfersWorkspace } from "./components/TransfersWorkspace";
import { UserSharesWorkspace } from "./components/UserSharesWorkspace";
import { UpdateExperience } from "./components/UpdateExperience";
import { WindowControls } from "./components/WindowControls";
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
import { usePrivateMessages } from "./hooks/usePrivateMessages";
import type {
  AlbumReleaseGroup,
  AlbumSearchContext,
  AlbumSource,
  SearchResult,
} from "./types";

const emptyAlbumCatalog: AlbumReleaseGroup[] = [];

const viewDetails = {
  home: {
    icon: Radio,
    title: "The signal starts here",
    copy: "Home discovery will arrive after the first search-and-download release.",
  },
  rooms: {
    icon: Radio,
    title: "Rooms are tuned for later",
    copy: "Community rooms and chat are deliberately outside the v0.1.0 scope.",
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
  const archive = useArchiveInventory(albums.selectedArtist?.name ?? null, archiveAlbums);
  const connection = useSoulseekConnection();
  const search = useSoulseekSearch();
  const transfers = useSoulseekTransfers();
  const sharing = useLocalSharing();
  const folders = useSoulseekFolders();
  const shares = useSoulseekShares();
  const people = useSoulseekPeople();
  const messages = usePrivateMessages();
  const [sharesUsername, setSharesUsername] = useState<string | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>("audiophile92");
  const [selectedMessageUsername, setSelectedMessageUsername] = useState<string | null>(
    "audiophile92",
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingInProgress, setOnboardingInProgress] = useState(false);
  const needsOnboarding = !connection.profile || !connection.hasPassword;
  const onboardingOpen =
    connection.ready &&
    (needsOnboarding || onboardingInProgress) &&
    !onboardingDismissed;

  const selectedResult =
    search.results.find((result) => result.id === selectedResultId) ??
    search.results[0] ??
    null;

  const queueDownload = (result: SearchResult) => {
    void transfers.enqueue(result).catch(() => undefined);
  };

  const queueAlbumSource = async (source: AlbumSource) => {
    const inspection = await folders.inspect(source.representative);
    await transfers.enqueueRelease({
      title: albumContext?.title ?? source.folderName,
      username: source.owner,
      remoteFolder: inspection.requestedFolder,
      files: inspection.files,
    });
    navigate("transfers");
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
              query={query}
              results={search.results}
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
            onQueryChange={albums.setQuery}
            onSearch={(artistQuery) => {
              void albums.searchArtists(artistQuery).catch(() => undefined);
            }}
            onSelectArtist={(artist) => {
              void albums.selectArtist(artist).catch(() => undefined);
            }}
            onSearchModeChange={setSearchMode}
            onSearchSoulseek={(artist, album) => {
              const nextQuery = `${artist} ${album.title}`;
              setQuery(nextQuery);
              setSelectedResultId(null);
              setAlbumContext({
                albumId: album.id,
                artist,
                title: album.title,
                coverArtUrl: album.coverArtUrl,
                firstReleaseDate: album.firstReleaseDate,
              });
              setAlbumResultView("sources");
              setSearchMode("files");
              void search.startSearch(nextQuery).catch(() => undefined);
            }}
            onOpenConnection={() => setActiveView("settings")}
            onDismissError={albums.clearError}
          />
        ) : activeView === "archive" ? (
          <ArchiveWorkspace
            status={archive.status}
            loading={archive.loading}
            error={archive.error}
            onRefresh={archive.refresh}
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
            onClearCompleted={() => void transfers.clearCompleted().catch(() => undefined)}
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

      <UpdateExperience {...updater} />

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
