import type { AlbumSource, Transfer } from "../types";
import { groupTransfers, type TransferGroupStatus } from "./transfers";

export type AlbumDownloadState =
  | "downloading"
  | "queued"
  | "paused"
  | "downloaded"
  | "failed";

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

const downloadState = (status: TransferGroupStatus): AlbumDownloadState => {
  if (status === "active") return "downloading";
  if (status === "completed") return "downloaded";
  return status;
};

export function albumDownloadStates(
  sources: AlbumSource[],
  transfers: Transfer[],
): Map<string, AlbumDownloadState> {
  const groupByFolder = new Map<
    string,
    { createdAtMs: number; status: TransferGroupStatus }
  >();

  for (const group of groupTransfers(transfers)) {
    if (!group.releaseId) continue;
    for (const transfer of group.transfers) {
      const key = sourceKey(group.username, remoteFolder(transfer.remoteFilename));
      const current = groupByFolder.get(key);
      if (!current || group.createdAtMs >= current.createdAtMs) {
        groupByFolder.set(key, {
          createdAtMs: group.createdAtMs,
          status: group.status,
        });
      }
    }
  }

  const states = new Map<string, AlbumDownloadState>();
  for (const source of sources) {
    const group = groupByFolder.get(sourceKey(source.owner, source.folder));
    if (group) states.set(source.id, downloadState(group.status));
  }

  return states;
}
