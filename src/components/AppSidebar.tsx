import {
  ArrowsClockwise,
  Archive,
  AddressBook,
  ChatCircleDots,
  CaretDown,
  DownloadSimple,
  GearSix,
  FolderOpen,
  House,
  MagnifyingGlass,
  UsersThree,
} from "@phosphor-icons/react";
import type { UpdateStatus } from "../hooks/useAppUpdater";
import type { ConnectionState } from "../types";

type AppSidebarProps = {
  activeView: string;
  updateStatus: UpdateStatus;
  username: string | null;
  connectionState: ConnectionState;
  unreadMessages: number;
  onNavigate: (view: string) => void;
  onCheckForUpdates: () => void;
};

const navItems = [
  { id: "home", label: "Home", icon: House },
  { id: "search", label: "Search", icon: MagnifyingGlass },
  { id: "browse", label: "Browse", icon: FolderOpen },
  { id: "messages", label: "Messages", icon: ChatCircleDots },
  { id: "people", label: "People", icon: AddressBook },
  { id: "rooms", label: "Rooms", icon: UsersThree },
  { id: "transfers", label: "Transfers", icon: DownloadSimple },
  { id: "archive", label: "Archive", icon: Archive },
];

export function AppSidebar({
  activeView,
  updateStatus,
  username,
  connectionState,
  unreadMessages,
  onNavigate,
  onCheckForUpdates,
}: AppSidebarProps) {
  const statusLabel =
    updateStatus === "checking"
      ? "Checking for updates"
      : updateStatus === "current"
        ? "Forever is up to date"
        : "Check for updates";
  const connectionLabel =
    connectionState === "online"
      ? "Online"
      : connectionState === "connecting" ||
          connectionState === "authenticating" ||
          connectionState === "reconnecting"
        ? "Connecting"
        : connectionState === "error"
          ? "Needs attention"
          : "Offline";

  return (
    <aside className="sidebar">
      <div className="wordmark" aria-label="Forever">
        FOREVER
      </div>

      <nav className="primary-nav" aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              type="button"
              className={`nav-item ${isActive ? "is-active" : ""}`}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
              key={item.id}
            >
              <Icon size={21} weight={isActive ? "regular" : "light"} />
              <span>{item.label}</span>
              {item.id === "messages" && unreadMessages > 0 ? (
                <b className="nav-unread" aria-label={`${unreadMessages} unread messages`}>
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </b>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-actions">
        <button
          type="button"
          className="sidebar-icon-button"
          aria-label="Settings"
          title="Settings"
          onClick={() => onNavigate("settings")}
        >
          <GearSix size={18} weight="light" />
        </button>
        <button
          type="button"
          className="sidebar-icon-button"
          aria-label={statusLabel}
          title={statusLabel}
          onClick={onCheckForUpdates}
        >
          <ArrowsClockwise
            className={updateStatus === "checking" ? "is-spinning" : ""}
            size={18}
            weight="light"
          />
        </button>
      </div>

      <button
        type="button"
        className={`profile-row is-${connectionState}`}
        onClick={() => onNavigate("settings")}
        aria-label={`${username || "Soulseek"} profile. ${connectionLabel}. Open connection settings.`}
      >
        <img src="/assets/listener-avatar.png" alt="" />
        <span className="profile-copy">
          <strong>{username || "Connect Soulseek"}</strong>
          <span>
            <i aria-hidden="true" /> {connectionLabel}
          </span>
        </span>
        <CaretDown className="profile-caret" size={12} weight="bold" />
      </button>
    </aside>
  );
}
