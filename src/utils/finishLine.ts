import type { ReleaseAlternativeSource, Transfer } from "../types";
import type { TransferGroup } from "./transfers";

export type ReleaseHealthState =
  | "downloading"
  | "waiting"
  | "recovering"
  | "paused"
  | "attention"
  | "moved"
  | "verified";

export type ReleaseHealth = {
  state: ReleaseHealthState;
  completedCount: number;
  verifiedCount: number;
  pendingCount: number;
  missingCount: number;
  mismatchCount: number;
  failedCount: number;
  recoveringCount: number;
  nextRetryAtMs: number | null;
  alternatives: ReleaseAlternativeSource[];
};

const sourceKey = (source: ReleaseAlternativeSource) =>
  `${source.username.toLocaleLowerCase()}\u0000${source.remoteFolder
    .replace(/\//g, "\\")
    .replace(/\\+/g, "\\")
    .toLocaleLowerCase()}`;

export function releaseAlternatives(transfers: Transfer[]) {
  const sources = new Map<string, ReleaseAlternativeSource>();
  for (const transfer of transfers) {
    for (const source of transfer.alternativeSources ?? []) {
      sources.set(sourceKey(source), source);
    }
  }
  return [...sources.values()];
}

export function releaseHealth(group: TransferGroup): ReleaseHealth {
  const completedCount = group.transfers.filter(
    (transfer) => transfer.status === "completed",
  ).length;
  const verifiedCount = group.transfers.filter(
    (transfer) => transfer.verificationStatus === "verified",
  ).length;
  const missingCount = group.transfers.filter(
    (transfer) => transfer.verificationStatus === "missing",
  ).length;
  const mismatchCount = group.transfers.filter(
    (transfer) => transfer.verificationStatus === "sizeMismatch",
  ).length;
  const failedCount = group.transfers.filter(
    (transfer) => transfer.status === "failed",
  ).length;
  const recovering = group.transfers.filter(
    (transfer) => transfer.status === "retrying",
  );
  const nextRetryAtMs = recovering.reduce<number | null>((next, transfer) => {
    if (transfer.retryAtMs === null || transfer.retryAtMs === undefined) return next;
    return next === null ? transfer.retryAtMs : Math.min(next, transfer.retryAtMs);
  }, null);
  const pendingCount = group.transfers.length - verifiedCount - missingCount - mismatchCount;
  const fullyMoved =
    group.status === "completed" &&
    group.transfers.length > 0 &&
    missingCount === group.transfers.length;

  let state: ReleaseHealthState = "waiting";
  if (fullyMoved) state = "moved";
  else if (missingCount || mismatchCount || failedCount) state = "attention";
  else if (recovering.length) state = "recovering";
  else if (group.status === "active") state = "downloading";
  else if (group.status === "paused") state = "paused";
  else if (group.status === "completed" && verifiedCount === group.transfers.length) {
    state = "verified";
  }

  return {
    state,
    completedCount,
    verifiedCount,
    pendingCount,
    missingCount,
    mismatchCount,
    failedCount,
    recoveringCount: recovering.length,
    nextRetryAtMs,
    alternatives: releaseAlternatives(group.transfers),
  };
}
