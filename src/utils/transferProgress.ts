import type { TransferProgressBatch, TransferQueueSnapshot } from "../types";

export function acceptTransferSnapshot(current: TransferQueueSnapshot, next: TransferQueueSnapshot) {
  return next.revision !== undefined && next.revision <= (current.revision ?? -1)
    ? current
    : next;
}

export function applyTransferProgress(current: TransferQueueSnapshot, batch: TransferProgressBatch): TransferQueueSnapshot {
  if (batch.revision <= (current.revision ?? -1) || batch.updates.length === 0) return current;
  const updates = new Map(batch.updates.map((update) => [update.id, update]));
  let changed = false;
  const transfers = current.transfers.map((transfer) => {
    const update = updates.get(transfer.id);
    // Telemetry cannot create a transfer or change its durable lifecycle state.
    if (!update || transfer.status !== "downloading") return transfer;
    changed = true;
    return { ...transfer, ...update };
  });
  return { ...current, revision: batch.revision, transfers: changed ? transfers : current.transfers };
}
