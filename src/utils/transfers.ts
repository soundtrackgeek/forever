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
  createdAtMs: number;
  updatedAtMs: number;
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
  const grouped = new Map<string, Transfer[]>();
  for (const transfer of transfers) {
    const key = transfer.releaseId ?? `single:${transfer.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), transfer]);
  }

  return [...grouped.entries()]
    .map(([id, group]) => {
      const ordered = [...group].sort(
        (left, right) =>
          (left.fileIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.fileIndex ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAtMs - right.createdAtMs,
      );
      const active = ordered.find((transfer) =>
        activeStatuses.includes(transfer.status as (typeof activeStatuses)[number]),
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
        speedBytesPerSecond: ordered.reduce(
          (total, transfer) => total + transfer.speedBytesPerSecond,
          0,
        ),
        etaSeconds: active?.etaSeconds ?? null,
        status: statusFor(ordered),
        createdAtMs: Math.min(...ordered.map((transfer) => transfer.createdAtMs)),
        updatedAtMs: Math.max(...ordered.map((transfer) => transfer.updatedAtMs)),
      } satisfies TransferGroup;
    })
    .sort((left, right) => {
      const priority = { active: 0, queued: 1, failed: 2, paused: 3, completed: 4 };
      const difference = priority[left.status] - priority[right.status];
      return difference || (left.status === "completed"
        ? right.updatedAtMs - left.updatedAtMs
        : left.createdAtMs - right.createdAtMs);
    });
};
