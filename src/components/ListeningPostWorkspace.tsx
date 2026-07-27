import {
  Archive,
  ArrowSquareOut,
  At,
  Broadcast,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  ClockCountdown,
  DownloadSimple,
  FolderOpen,
  MagnifyingGlass,
  Radio,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  ArchiveStatus,
  ConnectionSnapshot,
  DistributedSnapshot,
  MessagesSnapshot,
  RoomsSnapshot,
  Transfer,
  WantedAlbum,
  WantedSnapshot,
} from "../types";
import { releaseHealth } from "../utils/finishLine";
import { groupTransfers, type TransferGroup } from "../utils/transfers";

type ArchiveDestination = "missing" | "wanted";

type ListeningPostWorkspaceProps = {
  connection: ConnectionSnapshot;
  searchNetwork: DistributedSnapshot;
  transfers: Transfer[];
  wanted: WantedSnapshot;
  messages: MessagesSnapshot;
  rooms: RoomsSnapshot;
  archiveStatus: ArchiveStatus | null;
  missingCount: number | null;
  missingShelfName: string | null;
  onOpenTransfer: (groupId: string) => void;
  onOpenArchive: (destination: ArchiveDestination) => void;
  onOpenMessages: () => void;
  onOpenRoom: (roomName: string | null) => void;
  onSearchAlbums: () => void;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  label: string;
  tone: "active" | "queued" | "complete" | "moved" | "attention" | "archive";
  atMs: number;
  onOpen: () => void;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_000;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_000; index += 1) {
    value /= 1_000;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};

const formatEta = (seconds: number | null) => {
  if (seconds === null) return "Calculating ETA";
  if (seconds < 60) return `ETA ${seconds}s`;
  return `ETA ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const relativeTime = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const compactNumber = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat(undefined).format(value);

const activityForGroup = (
  group: TransferGroup,
  onOpenTransfer: (groupId: string) => void,
): ActivityItem => {
  const health = releaseHealth(group);
  if (health.state === "moved") {
    return {
      id: group.id,
      title: group.title,
      detail: `${group.transfers.length} ${group.transfers.length === 1 ? "file" : "files"} filed away`,
      label: "Moved to library",
      tone: "moved",
      atMs: group.updatedAtMs,
      onOpen: () => onOpenTransfer(group.id),
    };
  }
  if (health.state === "attention") {
    return {
      id: group.id,
      title: group.title,
      detail: `${health.missingCount + health.mismatchCount + health.failedCount} ${health.missingCount + health.mismatchCount + health.failedCount === 1 ? "file needs" : "files need"} a closer look`,
      label: "Needs attention",
      tone: "attention",
      atMs: group.updatedAtMs,
      onOpen: () => onOpenTransfer(group.id),
    };
  }
  if (group.status === "completed") {
    return {
      id: group.id,
      title: group.title,
      detail: `${group.transfers.length} ${group.transfers.length === 1 ? "track" : "tracks"} · ${formatBytes(group.sizeBytes)}`,
      label: "Completed",
      tone: "complete",
      atMs: group.updatedAtMs,
      onOpen: () => onOpenTransfer(group.id),
    };
  }
  if (group.status === "active") {
    return {
      id: group.id,
      title: group.title,
      detail: `${formatBytes(group.speedBytesPerSecond)}/s · ${formatEta(group.etaSeconds)}`,
      label: "Receiving",
      tone: "active",
      atMs: group.updatedAtMs,
      onOpen: () => onOpenTransfer(group.id),
    };
  }
  return {
    id: group.id,
    title: group.title,
    detail: group.status === "paused" ? "Progress saved" : `Queue #${group.queuePosition ?? 1}`,
    label: group.status === "paused" ? "Paused" : "Queued",
    tone: "queued",
    atMs: group.updatedAtMs,
    onOpen: () => onOpenTransfer(group.id),
  };
};

const ActivityIcon = ({ tone }: { tone: ActivityItem["tone"] }) => {
  if (tone === "complete") return <CheckCircle size={18} weight="fill" />;
  if (tone === "moved") return <FolderOpen size={18} />;
  if (tone === "attention") return <WarningCircle size={18} weight="fill" />;
  if (tone === "archive") return <Archive size={18} />;
  if (tone === "active") return <Broadcast size={18} />;
  return <ClockCountdown size={18} />;
};

const archiveActivity = (
  album: WantedAlbum,
  onOpenArchive: (destination: ArchiveDestination) => void,
): ActivityItem => ({
  id: `archive-${album.albumId}`,
  title: album.title,
  detail: `${album.artist} · ${album.ownedTrackCount ?? "—"} tracks`,
  label: "Found in Archive",
  tone: "archive",
  atMs: album.fulfilledAtMs ?? album.lastCheckedAtMs ?? album.addedAtMs,
  onOpen: () => onOpenArchive("wanted"),
});

export function ListeningPostWorkspace({
  connection,
  searchNetwork,
  transfers,
  wanted,
  messages,
  rooms,
  archiveStatus,
  missingCount,
  missingShelfName,
  onOpenTransfer,
  onOpenArchive,
  onOpenMessages,
  onOpenRoom,
  onSearchAlbums,
}: ListeningPostWorkspaceProps) {
  const groups = groupTransfers(transfers);
  const active = groups.find((group) => group.status === "active") ?? null;
  const queued = groups.filter((group) => group.status === "queued").slice(0, 2);
  const activeProgress = active?.sizeBytes
    ? Math.min(100, (active.transferredBytes / active.sizeBytes) * 100)
    : 0;
  const newWantedMatches = wanted.albums.reduce(
    (total, album) => total + (album.fulfilled ? 0 : album.newSourceCount),
    0,
  );
  const roomWithMention = rooms.rooms.find((room) => room.mentionCount > 0) ?? null;
  const activity = [
    ...groups.map((group) => activityForGroup(group, onOpenTransfer)),
    ...wanted.albums
      .filter((album) => album.fulfilled)
      .map((album) => archiveActivity(album, onOpenArchive)),
  ]
    .sort((left, right) => right.atMs - left.atMs)
    .slice(0, 4);
  const unfulfilledWanted = wanted.albums.filter((album) => !album.fulfilled).length;
  const networkOnline = connection.state === "online";
  const searchConnected = searchNetwork.state === "connected" || searchNetwork.state === "branchRoot";

  return (
    <section className="listening-post" aria-label="The Listening Post">
      <header className="listening-post-heading">
        <div>
          <h1>The Listening Post</h1>
          <p>Everything worth hearing, waiting in one place.</p>
        </div>
        <div className="listening-post-network" aria-label="Network status">
          <span className={networkOnline ? "is-online" : ""}><i /> {networkOnline ? "Network online" : "Network offline"}</span>
          <span className={searchConnected ? "is-online" : ""}><i /> {searchConnected ? "Global search connected" : "Global search quiet"}</span>
        </div>
      </header>

      <div className="listening-post-signal-grid">
        <section className="listening-post-now" aria-label="Now receiving">
          <h2>Now receiving</h2>
          {active ? (
            <>
              <article className="listening-post-active">
                <img src="/assets/night-geometry-cover.png" alt="" />
                <div className="listening-post-active-copy">
                  <span className="listening-post-signal-lines" aria-hidden="true" />
                  <strong>{active.title}</strong>
                  <p>{active.transfers[0]?.remoteFilename.split(/[\\/]/).slice(-3, -2)[0] ?? "Soulseek release"}</p>
                  <small><Radio size={14} /> {active.username}<i aria-hidden="true" /></small>
                  <div className="listening-post-active-progress">
                    <span><b>{formatBytes(active.transferredBytes)} / {formatBytes(active.sizeBytes)} ({Math.round(activeProgress)}%)</b><em>{formatBytes(active.speedBytesPerSecond)}/s</em><em>{formatEta(active.etaSeconds)}</em></span>
                    <i><b style={{ width: `${activeProgress}%` }} /></i>
                  </div>
                </div>
                <button type="button" onClick={() => onOpenTransfer(active.id)}>
                  Open transfer <ArrowSquareOut size={17} />
                </button>
              </article>
              <div className="listening-post-up-next">
                <h3>Up next</h3>
                <div>
                  {queued.length ? queued.map((group) => (
                    <button type="button" onClick={() => onOpenTransfer(group.id)} key={group.id}>
                      <span><DownloadSimple size={17} /></span>
                      <span><strong>{group.title}</strong><small>{group.username}</small></span>
                      <span><strong>{formatBytes(group.sizeBytes)}</strong><small>Queue #{group.queuePosition}</small></span>
                      <CaretRight size={15} />
                    </button>
                  )) : <p className="listening-post-quiet">The release queue is clear.</p>}
                </div>
              </div>
            </>
          ) : (
            <div className="listening-post-empty-signal">
              <span><Radio size={30} weight="thin" /></span>
              <div><strong>The receiver is quiet.</strong><p>Start an album or file search when you are ready to bring something in.</p></div>
              <button type="button" onClick={onSearchAlbums}><MagnifyingGlass size={16} /> Search albums</button>
            </div>
          )}
        </section>

        <aside className="listening-post-incoming" aria-label="Incoming signals">
          <h2>Incoming signals</h2>
          <div>
            <button type="button" onClick={() => onOpenArchive("wanted")}>
              <span className="is-wanted"><Broadcast size={20} /></span>
              <span><strong>{newWantedMatches} new Wanted {newWantedMatches === 1 ? "match" : "matches"}</strong><small>{newWantedMatches ? "Fresh sources for albums you want" : "No new sources since the last check"}</small></span>
              <CaretRight size={16} />
            </button>
            <button type="button" onClick={onOpenMessages}>
              <span className="is-message"><ChatCircleDots size={20} /></span>
              <span><strong>{messages.unreadCount} unread {messages.unreadCount === 1 ? "message" : "messages"}</strong><small>{messages.unreadCount ? "From your network" : "Your inbox is caught up"}</small></span>
              <CaretRight size={16} />
            </button>
            <button type="button" onClick={() => onOpenRoom(roomWithMention?.name ?? null)}>
              <span className="is-mention"><At size={20} /></span>
              <span><strong>{rooms.mentionCount} room {rooms.mentionCount === 1 ? "mention" : "mentions"}</strong><small>{roomWithMention ? `Waiting in ${roomWithMention.name}` : "No one is calling your name"}</small></span>
              <CaretRight size={16} />
            </button>
          </div>
        </aside>
      </div>

      <section className="listening-post-activity" aria-label="Recent activity">
        <h2>Recent activity</h2>
        <div>
          {activity.length ? activity.map((item) => (
            <button type="button" className={`is-${item.tone}`} onClick={item.onOpen} key={item.id}>
              <span className="listening-post-activity-icon"><ActivityIcon tone={item.tone} /></span>
              <time>{relativeTime(item.atMs)}</time>
              <strong>{item.label}</strong>
              <span><b>{item.title}</b><small>{item.detail}</small></span>
              <CaretRight size={16} />
            </button>
          )) : (
            <div className="listening-post-empty-activity"><ClockCountdown size={22} /><span><strong>No recent activity yet</strong><small>Transfers and Archive confirmations will settle here.</small></span></div>
          )}
        </div>
      </section>

      <section className="listening-post-archive" aria-label="Archive pulse">
        <h2>Archive pulse</h2>
        <div>
          <dl>
            <div><dt>Owned</dt><dd>{compactNumber(archiveStatus?.albumCount ?? null)}</dd><small>albums in Music Library</small></div>
            <div><dt>Wanted</dt><dd>{unfulfilledWanted}</dd><small>signals still listening</small></div>
            <div><dt>Missing</dt><dd>{compactNumber(missingCount)}</dd><small>{missingShelfName ? `${missingShelfName} studio shelf` : "choose a shelf to compare"}</small></div>
          </dl>
          <div className="listening-post-archive-actions">
            <button type="button" onClick={() => onOpenArchive("missing")}><Archive size={16} /> Open Missing Shelf</button>
            <button type="button" onClick={onSearchAlbums}><MagnifyingGlass size={16} /> Search albums</button>
          </div>
        </div>
      </section>
    </section>
  );
}
