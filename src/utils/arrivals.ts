import type { TransferGroup } from "./transfers";
import { isAudioTransfer, summarizeSoundcheck, type ReleaseSoundcheck } from "./soundcheck";

export type ArrivalState = "ready" | "filed" | "moved" | "attention";

export type Arrival = {
  group: TransferGroup;
  state: ArrivalState;
  archiveOwned: boolean;
  manuallyFiled: boolean;
  filedAtMs: number | null;
  audioCount: number;
  verifiedCount: number;
  missingCount: number;
  issueCount: number;
  soundcheck: ReleaseSoundcheck;
};

export function arrivalForGroup(
  group: TransferGroup,
  archiveOwned: boolean,
): Arrival | null {
  if (group.status !== "completed" || !group.releaseId) return null;
  const audio = group.transfers.filter(isAudioTransfer);
  if (audio.length === 0) return null;

  const manuallyFiled = group.transfers.some((transfer) => Boolean(transfer.filedAtMs));
  const filedAtMs = group.transfers.reduce<number | null>((latest, transfer) => {
    if (!transfer.filedAtMs) return latest;
    return latest === null ? transfer.filedAtMs : Math.max(latest, transfer.filedAtMs);
  }, null);
  const verifiedCount = group.transfers.filter(
    (transfer) => transfer.verificationStatus === "verified",
  ).length;
  const missingCount = group.transfers.filter(
    (transfer) => transfer.verificationStatus === "missing",
  ).length;
  const mismatchCount = group.transfers.filter(
    (transfer) => transfer.verificationStatus === "sizeMismatch",
  ).length;
  const failedCount = group.transfers.filter((transfer) => transfer.status === "failed").length;
  const allAudioMissing = audio.every(
    (transfer) => transfer.verificationStatus === "missing",
  );
  const soundcheck = summarizeSoundcheck(group.transfers);

  let state: ArrivalState = "ready";
  if (archiveOwned || manuallyFiled) state = "filed";
  else if (allAudioMissing && mismatchCount === 0 && failedCount === 0) state = "moved";
  else if (missingCount || mismatchCount || failedCount || soundcheck.state === "failed") state = "attention";

  return {
    group,
    state,
    archiveOwned,
    manuallyFiled,
    filedAtMs: filedAtMs ?? (archiveOwned ? group.updatedAtMs : null),
    audioCount: audio.length,
    verifiedCount,
    missingCount,
    issueCount: missingCount + mismatchCount + failedCount,
    soundcheck,
  };
}

export function buildArrivals(
  groups: TransferGroup[],
  archiveOwnedReleaseIds: ReadonlySet<string>,
) {
  const arrivals: Arrival[] = [];
  for (const group of groups) {
    const arrival = arrivalForGroup(
      group,
      Boolean(group.releaseId && archiveOwnedReleaseIds.has(group.releaseId)),
    );
    if (arrival) arrivals.push(arrival);
  }
  return arrivals.sort((left, right) => right.group.updatedAtMs - left.group.updatedAtMs);
}
