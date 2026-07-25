import { DownloadSimple, MagnifyingGlass, Radio, Sliders } from "@phosphor-icons/react";
import { useState } from "react";
import "./App.css";
import { AppSidebar } from "./components/AppSidebar";
import { ConnectionOnboarding } from "./components/ConnectionOnboarding";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { ReleaseInspector } from "./components/ReleaseInspector";
import { SearchWorkspace } from "./components/SearchWorkspace";
import { TransferShelf } from "./components/TransferShelf";
import { UpdateExperience } from "./components/UpdateExperience";
import { WindowControls } from "./components/WindowControls";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { useSoulseekConnection } from "./hooks/useSoulseekConnection";
import { useSoulseekSearch } from "./hooks/useSoulseekSearch";
import { useSoulseekTransfers } from "./hooks/useSoulseekTransfers";
import type { SearchResult } from "./types";

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
  library: {
    icon: Radio,
    title: "Your library comes next",
    copy: "Playback, history, and playlists will follow the core download journey.",
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
  const [query, setQuery] = useState("night geometry");
  const [selectedResultId, setSelectedResultId] = useState<string | null>(
    "night-geometry",
  );
  const updater = useAppUpdater();
  const connection = useSoulseekConnection();
  const search = useSoulseekSearch();
  const transfers = useSoulseekTransfers();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const onboardingOpen =
    connection.ready &&
    (!connection.profile || !connection.hasPassword) &&
    !onboardingDismissed;

  const selectedResult =
    search.results.find((result) => result.id === selectedResultId) ??
    search.results[0] ??
    null;

  const queueDownload = (result: SearchResult) => {
    void transfers.enqueue(result).catch(() => undefined);
  };

  const navigate = (view: string) => {
    setActiveView(view);
  };

  const isSearchView = activeView === "search";

  return (
    <div className="app-frame">
      <header className="titlebar" data-tauri-drag-region>
        <span data-tauri-drag-region>Forever pre-alpha</span>
        <WindowControls />
      </header>

      <div className={`app-shell ${isSearchView ? "" : "is-single-view"}`}>
        <AppSidebar
          activeView={activeView}
          updateStatus={updater.status}
          username={connection.snapshot.username}
          connectionState={connection.snapshot.state}
          onNavigate={navigate}
          onCheckForUpdates={() => void updater.checkForUpdates(true)}
        />

        {isSearchView ? (
          <>
            <SearchWorkspace
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
                void search.startSearch(normalizedQuery).catch(() => undefined);
              }}
              onStopSearch={() => void search.stopSearch()}
              onSelectResult={(result) => setSelectedResultId(result.id)}
              onQueueDownload={queueDownload}
            />
            <ReleaseInspector
              result={selectedResult}
              onQueueDownload={queueDownload}
            />
          </>
        ) : activeView === "settings" && connection.profile ? (
          <ConnectionSettings
            profile={connection.profile}
            hasPassword={connection.hasPassword}
            snapshot={connection.snapshot}
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
        transfers={transfers.snapshot.transfers}
        activeCount={transfers.snapshot.activeCount}
        error={transfers.error}
        onPause={(id) => void transfers.pause(id).catch(() => undefined)}
        onResume={(id) => void transfers.resume(id).catch(() => undefined)}
        onCancel={(id) => void transfers.cancel(id).catch(() => undefined)}
        onReveal={(id) => void transfers.reveal(id).catch(() => undefined)}
        onViewAll={() => setActiveView("transfers")}
        onDismissError={transfers.clearError}
      />

      <UpdateExperience {...updater} />

      {onboardingOpen && connection.ready && (
        <ConnectionOnboarding
          profile={connection.profile ?? connection.suggestedProfile}
          hasPassword={connection.hasPassword}
          snapshot={connection.snapshot}
          error={connection.error}
          onSave={connection.saveProfile}
          onConnect={connection.connect}
          onComplete={() => setOnboardingDismissed(true)}
          onExploreOffline={() => setOnboardingDismissed(true)}
        />
      )}
    </div>
  );
}

export default App;
