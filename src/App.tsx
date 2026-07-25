import { DownloadSimple, MagnifyingGlass, Radio, Sliders } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import "./App.css";
import { AppSidebar } from "./components/AppSidebar";
import { ConnectionOnboarding } from "./components/ConnectionOnboarding";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { ReleaseInspector } from "./components/ReleaseInspector";
import { SearchWorkspace } from "./components/SearchWorkspace";
import { TransferShelf } from "./components/TransferShelf";
import { UpdateExperience } from "./components/UpdateExperience";
import { WindowControls } from "./components/WindowControls";
import { initialTransfers, searchResults } from "./data/mockData";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { useSoulseekConnection } from "./hooks/useSoulseekConnection";
import type { SearchResult, Transfer } from "./types";

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
    title: "Transfers stay close",
    copy: "The live transfer shelf below is the first version of this workspace.",
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
  const [submittedQuery, setSubmittedQuery] = useState("night geometry");
  const [selectedResult, setSelectedResult] = useState(searchResults[0]);
  const [transfers, setTransfers] = useState<Transfer[]>(initialTransfers);
  const updater = useAppUpdater();
  const connection = useSoulseekConnection();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const onboardingOpen =
    connection.ready &&
    (!connection.profile || !connection.hasPassword) &&
    !onboardingDismissed;

  const filteredResults = useMemo(() => {
    const terms = submittedQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return searchResults;

    return searchResults.filter((result) => {
      const haystack =
        `${result.title} ${result.subtitle} ${result.owner} ${result.format}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [submittedQuery]);

  const queueDownload = (result: SearchResult) => {
    const id = `queued-${result.id}`;

    setTransfers((current) => {
      if (current.some((transfer) => transfer.id === id)) return current;

      return [
        {
          id,
          release: result.title,
          track: `${result.tracks} selected files`,
          progress: 0,
          transferred: "0 MB",
          total: result.size,
          speed: "Queued",
          eta: "Waiting",
          status: "queued",
        },
        ...current,
      ];
    });
  };

  const toggleTransfer = (id: string) => {
    setTransfers((current) =>
      current.map((transfer) =>
        transfer.id === id
          ? {
              ...transfer,
              status:
                transfer.status === "paused" ? "downloading" : "paused",
            }
          : transfer,
      ),
    );
  };

  const cancelTransfer = (id: string) => {
    setTransfers((current) => current.filter((transfer) => transfer.id !== id));
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
              submittedQuery={submittedQuery}
              results={filteredResults}
              selectedResult={selectedResult}
              connection={connection.snapshot}
              onOpenConnection={() => setActiveView("settings")}
              onQueryChange={setQuery}
              onSearch={(nextQuery) => {
                const normalizedQuery = nextQuery.trim();
                setQuery(normalizedQuery);
                setSubmittedQuery(normalizedQuery);
              }}
              onSelectResult={setSelectedResult}
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
        transfers={transfers}
        onToggleTransfer={toggleTransfer}
        onCancelTransfer={cancelTransfer}
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
