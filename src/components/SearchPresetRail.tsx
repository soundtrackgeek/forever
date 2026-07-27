import {
  ClockCounterClockwise,
  Copy,
  Disc,
  File,
  MagnifyingGlass,
  PushPinSimple,
  Plus,
  Stop,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { AlbumDiscoveryState } from "../hooks/useAlbumDiscovery";
import type { ClosedDialSession, DialSession } from "../hooks/useDialMemory";
import type { SearchSessionRecord } from "../hooks/useSoulseekSearch";

type SearchPresetRailProps = {
  sessions: DialSession[];
  activeId: string;
  records: Record<string, SearchSessionRecord>;
  albumStates: Record<string, AlbumDiscoveryState>;
  recent: ClosedDialSession[];
  atLimit: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDuplicate: (id: string) => void;
  onStopAll: () => void;
  onReopen: (session: ClosedDialSession) => void;
};

const sessionStatus = (
  session: DialSession,
  record?: SearchSessionRecord,
  album?: AlbumDiscoveryState,
  active = false,
) => {
  if (session.mode === "albums") {
    if (album?.loading === "artists") return { label: "Finding artist", tone: "listening" };
    if (album?.loading === "catalog") return { label: "Loading albums", tone: "listening" };
    const count = album?.catalog?.albums.length ?? 0;
    return { label: count ? `${count} albums` : session.query ? "Ready" : "New", tone: "quiet" };
  }
  if (record?.unseenCount && !active) return { label: `${record.unseenCount} new`, tone: "new" };
  if (record?.snapshot.state === "searching") return { label: "Listening", tone: "listening" };
  const count = record?.snapshot.resultCount ?? 0;
  return { label: count ? `${count} results` : session.query ? "Ready" : "New", tone: "quiet" };
};

export function SearchPresetRail({
  sessions,
  activeId,
  records,
  albumStates,
  recent,
  atLimit,
  onSelect,
  onCreate,
  onClose,
  onTogglePin,
  onDuplicate,
  onStopAll,
  onReopen,
}: SearchPresetRailProps) {
  const [recentOpen, setRecentOpen] = useState(false);
  const searching = sessions.some((session) => records[session.id]?.snapshot.state === "searching");

  return (
    <nav className="dial-memory" aria-label="Search presets">
      <div className="dial-memory-scroll" role="tablist" aria-label="Open searches">
        {sessions.map((session) => {
          const active = session.id === activeId;
          const status = sessionStatus(session, records[session.id], albumStates[session.id], active);
          const Icon = session.mode === "albums" ? Disc : File;
          return (
            <div className={`dial-preset${active ? " is-active" : ""}${status.tone === "listening" ? " is-listening" : ""}`} key={session.id} role="presentation">
              <button
                type="button"
                className="dial-preset-select"
                role="tab"
                aria-selected={active}
                aria-controls="dial-search-surface"
                onClick={() => onSelect(session.id)}
              >
                <Icon size={16} weight="light" aria-hidden="true" />
                <span>
                  <strong>{session.query || "New search"}</strong>
                  <small>{session.mode === "albums" ? "Albums" : "Files"}</small>
                </span>
                <em className={`is-${status.tone}`}>{status.label}</em>
                {status.tone === "listening" ? <i className="dial-wave" aria-hidden="true"><b /><b /><b /></i> : null}
              </button>
              <button
                type="button"
                className={`dial-pin${session.pinned ? " is-pinned" : ""}`}
                aria-label={`${session.pinned ? "Unpin" : "Pin"} ${session.query || "new search"}`}
                title={session.pinned ? "Unpin search" : "Pin search"}
                onClick={() => onTogglePin(session.id, !session.pinned)}
              >
                <PushPinSimple size={12} weight={session.pinned ? "fill" : "regular"} />
              </button>
              <button
                type="button"
                className="dial-close"
                aria-label={`Close ${session.query || "new search"}`}
                title="Close search (Ctrl+W)"
                onClick={() => onClose(session.id)}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="dial-memory-actions">
        <button type="button" className="dial-new" onClick={onCreate} disabled={atLimit} title={atLimit ? "Close a search before opening another" : "New search (Ctrl+T)"}>
          <Plus size={16} /> <span>New search</span>
        </button>
        <button type="button" className="dial-utility" onClick={() => onDuplicate(activeId)} disabled={atLimit} title="Duplicate this search">
          <Copy size={14} /><span>Duplicate</span>
        </button>
        <button type="button" className="dial-utility" onClick={onStopAll} disabled={!searching} aria-label="Stop all searches" title="Stop all searches">
          <Stop size={13} weight="fill" /><span>Stop all</span>
        </button>
        <div className="dial-recent-wrap">
          <button type="button" className={`dial-utility${recentOpen ? " is-open" : ""}`} onClick={() => setRecentOpen((open) => !open)} aria-label="Recently closed searches" title="Recently closed searches" aria-expanded={recentOpen}>
            <ClockCounterClockwise size={14} /><span>Recently closed</span>
          </button>
          {recentOpen ? (
            <div className="dial-recent-menu" role="menu">
              {recent.length ? recent.map((item) => (
                <button type="button" role="menuitem" key={`${item.mode}-${item.query}-${item.closedAtMs}`} onClick={() => { onReopen(item); setRecentOpen(false); }}>
                  {item.mode === "albums" ? <Disc size={14} /> : <MagnifyingGlass size={14} />}
                  <span><strong>{item.query}</strong><small>{item.mode === "albums" ? "Albums" : "Files"}</small></span>
                </button>
              )) : <p>No recently closed searches.</p>}
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
