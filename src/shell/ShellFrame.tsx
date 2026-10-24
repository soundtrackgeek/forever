import { MusicBrainzNotice } from "../components/MusicBrainzNotice";
import { StorageNotices } from "../components/StorageNotices";
import { WindowControls } from "../components/WindowControls";
import Overlays from "./parts/Overlays";
import Shelf from "./parts/Shelf";
import Sidebar from "./parts/Sidebar";
import { useShell } from "./shellStore";
import { AlbumsRoute, views } from "./views";
import { WorkspaceBoundary } from "./WorkspaceBoundary";

function WorkspaceRouter() {
  const { activeView, searchMode } = useShell((s) => ({
    activeView: s.activeView,
    searchMode: s.searchMode,
  }));
  const view = views[activeView];
  const albums = activeView === "search" && searchMode === "albums";
  const Workspace = albums ? AlbumsRoute : view.component;
  return (
    <WorkspaceBoundary key={albums ? "albums" : activeView} label={view.label}>
      <Workspace />
    </WorkspaceBoundary>
  );
}

export function ShellFrame() {
  const { expanded, fileSearch, settingsError, storageNotices } = useShell(
    (s) => ({
      expanded: s.transferShelfExpanded,
      fileSearch: s.isFileSearchView,
      settingsError: s.appSettings.error,
      storageNotices: s.connection.storageNotices,
    }),
  );
  return (
    <div
      className={
        expanded ? "app-frame is-transfer-shelf-expanded" : "app-frame"
      }
    >
      <header className="titlebar" data-tauri-drag-region>
        <span data-tauri-drag-region>Forever pre-alpha</span>
        <WindowControls />
      </header>
      {settingsError && (
        <div className="settings-save-error" role="alert">
          Settings could not be saved: {settingsError}
        </div>
      )}
      <StorageNotices notices={storageNotices} />
      <MusicBrainzNotice />
      <div className={`app-shell ${fileSearch ? "" : "is-single-view"}`}>
        <Sidebar />
        <WorkspaceRouter />
      </div>
      <Shelf />
      <Overlays />
    </div>
  );
}
