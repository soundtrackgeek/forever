import type { AlbumSource, Transfer } from "../types";
import { groupTransfers, type TransferGroupStatus } from "./transfers";

export type AlbumDownloadStatus =
  | "downloading"
  | "queued"
  | "paused"
  | "downloaded"
  | "failed";

export type AlbumDownloadState = {
  status: AlbumDownloadStatus;
  queuePosition: number | null;
  groupId: string;
  releaseId: string | null;
  title: string;
  progressPercent: number;
};

const downloadLabels: Record<AlbumDownloadStatus, string> = {
  downloading: "Downloading",
  queued: "Queued",
  paused: "Paused",
  downloaded: "Downloaded",
  failed: "Needs attention",
};

export const albumDownloadLabel = (state: AlbumDownloadState) =>
  state.status === "queued" && state.queuePosition
    ? `Queued #${state.queuePosition}`
    : state.status === "downloading"
      ? `Downloading · ${state.progressPercent}%`
      : downloadLabels[state.status];

const normalizeRemoteFilename = (value: string) =>
  value
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+/g, "\\")
    .replace(/^\\/, "")
    .toLocaleLowerCase();

const sourceKey = (username: string, remoteFolder: string) =>
  `${username.toLocaleLowerCase()}\u0000${normalizeRemoteFilename(remoteFolder)}`;

const remoteFolder = (remoteFilename: string) => {
  const normalized = normalizeRemoteFilename(remoteFilename);
  const separator = normalized.lastIndexOf("\\");
  return separator >= 0 ? normalized.slice(0, separator) : "";
};

const downloadStatus = (status: TransferGroupStatus): AlbumDownloadStatus => {
  if (status === "active") return "downloading";
  if (status === "completed") return "downloaded";
  return status;
};

const stateForGroup = (group: ReturnType<typeof groupTransfers>[number]): AlbumDownloadState => ({
  status: downloadStatus(group.status),
  queuePosition: group.queuePosition,
  groupId: group.id,
  releaseId: group.releaseId,
  title: group.title,
  progressPercent: group.sizeBytes
    ? Math.min(100, Math.round((group.transferredBytes / group.sizeBytes) * 100))
    : 0,
});

const latestStateByFolder = (transfers: Transfer[]) => {
  const groupByFolder = new Map<
    string,
    { createdAtMs: number; state: AlbumDownloadState }
  >();

  for (const group of groupTransfers(transfers)) {
    if (!group.releaseId) continue;
    for (const transfer of group.transfers) {
      const key = sourceKey(group.username, remoteFolder(transfer.remoteFilename));
      const current = groupByFolder.get(key);
      if (!current || group.createdAtMs >= current.createdAtMs) {
        groupByFolder.set(key, {
          createdAtMs: group.createdAtMs,
          state: stateForGroup(group),
        });
      }
    }
  }

  return groupByFolder;
};

export function albumDownloadStateForFolder(
  username: string,
  folder: string,
  transfers: Transfer[],
): AlbumDownloadState | undefined {
  return latestStateByFolder(transfers).get(sourceKey(username, folder))?.state;
}

export function albumDownloadStatesByTitle(
  transfers: Transfer[],
): Map<string, AlbumDownloadState> {
  const states = new Map<string, { createdAtMs: number; state: AlbumDownloadState }>();
  for (const group of groupTransfers(transfers)) {
    const key = group.title.trim().toLocaleLowerCase();
    const current = states.get(key);
    if (!current || group.createdAtMs >= current.createdAtMs) {
      states.set(key, { createdAtMs: group.createdAtMs, state: stateForGroup(group) });
    }
  }
  return new Map([...states].map(([key, value]) => [key, value.state]));
}

export function albumDownloadStates(
  sources: AlbumSource[],
  transfers: Transfer[],
): Map<string, AlbumDownloadState> {
  const groupByFolder = latestStateByFolder(transfers);

  const states = new Map<string, AlbumDownloadState>();
  for (const source of sources) {
    const group = groupByFolder.get(sourceKey(source.owner, source.folder));
    if (group) states.set(source.id, group.state);
  }

  return states;
}
