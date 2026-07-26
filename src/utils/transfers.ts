import type { Transfer } from "../types";

export type TransferGroupStatus =
  | "active"
  | "queued"
  | "paused"
  | "completed"
  | "failed";

export type TransferGroup = {
  id: string;
  releaseId: string | null;
  title: string;
  username: string;
  folder: string | null;
  transfers: Transfer[];
  sizeBytes: number;
  transferredBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  status: TransferGroupStatus;
  queueIndex: number;
  queuePosition: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type TransferQueueSummary = {
  releaseCount: number;
  fileCount: number;
  remainingBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
};

const activeStatuses = [
  "requesting",
  "remotelyQueued",
  "connecting",
  "downloading",
] as const;

const statusFor = (transfers: Transfer[]): TransferGroupStatus => {
  if (transfers.every((transfer) => transfer.status === "completed")) {
    return "completed";
  }
  if (transfers.some((transfer) => activeStatuses.includes(transfer.status as (typeof activeStatuses)[number]))) {
    return "active";
  }
  if (transfers.some((transfer) => transfer.status === "failed")) {
    return "failed";
  }
  if (
    transfers
      .filter((transfer) => transfer.status !== "completed")
      .every((transfer) => transfer.status === "paused")
  ) {
    return "paused";
  }
  return "queued";
};

export const groupTransfers = (transfers: Transfer[]): TransferGroup[] => {
  const grouped = new Map<
    string,
    { transfers: Transfer[]; queueIndex: number }
  >();
  for (const [index, transfer] of transfers.entries()) {
    const key = transfer.releaseId ?? `single:${transfer.id}`;
    const existing = grouped.get(key);
    if (existing) existing.transfers.push(transfer);
    else grouped.set(key, { transfers: [transfer], queueIndex: index });
  }

  const groups = [...grouped.entries()]
    .map(([id, group]) => {
      const ordered = [...group.transfers].sort(
        (left, right) =>
          (left.fileIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.fileIndex ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAtMs - right.createdAtMs,
      );
      const active = ordered.find((transfer) =>
        activeStatuses.includes(transfer.status as (typeof activeStatuses)[number]),
      );
      const speedBytesPerSecond = ordered.reduce(
        (total, transfer) => total + transfer.speedBytesPerSecond,
        0,
      );
      const remainingBytes = ordered.reduce(
        (total, transfer) =>
          total + Math.max(0, transfer.sizeBytes - transfer.transferredBytes),
        0,
      );
      return {
        id,
        releaseId: ordered[0].releaseId ?? null,
        title: ordered[0].releaseTitle ?? ordered[0].title,
        username: ordered[0].username,
        folder: ordered[0].releaseFolder ?? null,
        transfers: ordered,
        sizeBytes: ordered.reduce((total, transfer) => total + transfer.sizeBytes, 0),
        transferredBytes: ordered.reduce(
          (total, transfer) => total + transfer.transferredBytes,
          0,
        ),
        speedBytesPerSecond,
        etaSeconds:
          active && speedBytesPerSecond > 0
            ? Math.ceil(remainingBytes / speedBytesPerSecond)
            : null,
        status: statusFor(ordered),
        queueIndex: group.queueIndex,
        queuePosition: null,
        createdAtMs: Math.min(...ordered.map((transfer) => transfer.createdAtMs)),
        updatedAtMs: Math.max(...ordered.map((transfer) => transfer.updatedAtMs)),
      } satisfies TransferGroup;
    })
    .sort((left, right) => {
      const priority = { active: 0, queued: 1, failed: 2, paused: 3, completed: 4 };
      const difference = priority[left.status] - priority[right.status];
      return difference || (left.status === "completed"
        ? right.updatedAtMs - left.updatedAtMs
        : left.queueIndex - right.queueIndex);
    });

  let queuedPosition = 0;
  return groups.map((group) => ({
    ...group,
    queuePosition:
      group.status === "queued" ? (queuedPosition += 1) : null,
  }));
};

export const summarizeTransferGroups = (
  groups: TransferGroup[],
): TransferQueueSummary => {
  const pending = groups.filter(
    (group) => group.status === "active" || group.status === "queued",
  );
  let fileCount = 0;
  let remainingBytes = 0;
  let speedBytesPerSecond = 0;
  for (const group of pending) {
    speedBytesPerSecond += group.speedBytesPerSecond;
    for (const transfer of group.transfers) {
      if (transfer.status === "completed") continue;
      fileCount += 1;
      remainingBytes += Math.max(
        0,
        transfer.sizeBytes - transfer.transferredBytes,
      );
    }
  }
  return {
    releaseCount: pending.length,
    fileCount,
    remainingBytes,
    speedBytesPerSecond,
    etaSeconds:
      speedBytesPerSecond > 0
        ? Math.ceil(remainingBytes / speedBytesPerSecond)
        : null,
  };
};
