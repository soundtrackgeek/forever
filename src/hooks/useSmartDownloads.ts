import { useCallback, useEffect, useRef } from "react";
import type { SmartDownloadSettings } from "../settings";
import type { WantedAlbum } from "../types";
import { type ProgressMemo } from "../utils/smartDownload";
import { runSmartPass, type SmartDeps } from "../utils/smartDownloadRunner";
import type { TransferGroup } from "../utils/transfers";

type Inputs = {
  /** Native app, signed in, transfers running and Wanted loaded. */
  enabled: boolean;
  settings: SmartDownloadSettings;
  albums: WantedAlbum[];
  groups: TransferGroup[];
  /** A Wanted search is in flight, so another cannot be requested. */
  checking: boolean;
  /** Changes whenever a Wanted album's sources or Smart state change. */
  signature: string;
  excluded: (username: string) => boolean;
  deps: Omit<SmartDeps, "now">;
};

const PASS_INTERVAL_MS = 15_000;
const SETTLE_MS = 1_500;

// Lives above the workspace routes like useAutomaticRelay, so downloads keep
// being managed while the window sits in the tray. Progress is remembered in
// memory only; after a restart the stall clock simply starts again.
export function useSmartDownloads(inputs: Inputs) {
  const latest = useRef(inputs);
  const progress = useRef(new Map<string, ProgressMemo>());
  const busy = useRef(false);
  useEffect(() => { latest.current = inputs; });

  const pass = useCallback(async () => {
    const current = latest.current;
    if (busy.current || !current.enabled || !current.settings.enabled) return;
    busy.current = true;
    try {
      await runSmartPass({
        albums: current.albums,
        groups: current.groups,
        settings: current.settings,
        progress: progress.current,
        checking: current.checking,
        excluded: current.excluded,
        deps: { now: Date.now, ...current.deps },
        cancelled: () => !latest.current.enabled || !latest.current.settings.enabled,
      });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void pass(), PASS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pass]);

  // React quickly to a new Smart Match or a settings change without waiting a full interval.
  useEffect(() => {
    if (!inputs.enabled || !inputs.settings.enabled) return;
    const timer = window.setTimeout(() => void pass(), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [pass, inputs.enabled, inputs.settings.enabled, inputs.signature]);
}
