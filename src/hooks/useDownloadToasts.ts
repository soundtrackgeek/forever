import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
import { appIsInBackground } from "../utils/appFocus";
import { isAudioTransfer } from "../utils/soundcheck";
import type { TransferGroup } from "../utils/transfers";
import { releasePassedVerification } from "../utils/wantedFulfillment";

const MAX_INDIVIDUAL_TOASTS = 3;

const formatsOf = (group: TransferGroup) => {
  const formats = new Set(group.transfers.filter(isAudioTransfer).map((transfer) =>
    transfer.soundcheck?.codec?.trim().toLocaleUpperCase()
    || transfer.remoteFilename.split(".").pop()?.trim().toLocaleUpperCase()
    || "Audio"));
  return [...formats].sort().join(" + ");
};

export async function notifyDownloaded(groups: TransferGroup[]) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  if (groups.length > MAX_INDIVIDUAL_TOASTS) {
    sendNotification({
      title: `${groups.length} albums downloaded and verified`,
      body: groups.slice(0, 4).map((group) => group.title).join(", ") + (groups.length > 4 ? "…" : ""),
    });
    return;
  }
  for (const group of groups) {
    const tracks = group.transfers.filter(isAudioTransfer).length;
    sendNotification({
      title: `${group.title} is ready`,
      body: `Downloaded and verified · ${tracks} ${tracks === 1 ? "track" : "tracks"} · ${formatsOf(group)} · from ${group.username}`,
    });
  }
}

type Inputs = {
  /** Transfers have loaded, so what is already finished is not news. */
  ready: boolean;
  enabled: boolean;
  groups: TransferGroup[];
};

// Raises a system toast when an album finishes and passes verification while
// Forever is hidden, minimized or behind another window. Only releases seen
// still downloading in this session qualify: after a restart, albums that
// merely re-verify are history, not news.
export function useDownloadToasts({ ready, enabled, groups }: Inputs) {
  const watching = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    const finished: TransferGroup[] = [];
    for (const group of groups) {
      if (!group.releaseId) continue;
      if (group.status !== "completed") {
        watching.current.add(group.releaseId);
      } else if (watching.current.has(group.releaseId) && releasePassedVerification(group.transfers)) {
        watching.current.delete(group.releaseId);
        finished.push(group);
      }
    }
    if (!finished.length || !enabled || !isTauri()) return;
    void appIsInBackground()
      .then((background) => background ? notifyDownloaded(finished) : undefined)
      .catch(() => undefined);
  }, [ready, enabled, groups]);
}
