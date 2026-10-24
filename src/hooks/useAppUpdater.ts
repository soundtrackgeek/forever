import { useSettings, savePreference, getSettingsState, type UpdateChannel, type UpdateCheckIntervalMinutes } from "../settings";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyUpdateTaskbarBadge,
  type TaskbarBadgeImage,
} from "../utils/updateTaskbarBadge";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "preparing"
  | "downloading"
  | "ready"
  | "error";

export type UpdateDetails = {
  version: string;
  currentVersion: string;
  body: string;
  date?: string;
};

export type { UpdateChannel, UpdateCheckIntervalMinutes } from "../settings";

export const DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES: UpdateCheckIntervalMinutes = 360;
export const UPDATE_CHECK_INTERVAL_STORAGE_KEY =
  "forever.updateCheckIntervalMinutes";

const SUPPORTED_UPDATE_CHECK_INTERVALS: UpdateCheckIntervalMinutes[] = [
  0, 1, 5, 15, 30, 60, 360,
];

const PREVIEW_UPDATE: UpdateDetails = {
  currentVersion: "0.0.72",
  version: "0.0.73",
  body: `## What's new in Forever 0.0.73

### Changed

- Inspect sonic evidence and spectrograms with Deep Soundcheck.
- Review suspect transcodes and replace individual tracks in Patch Bay.
- Keep advisory sonic observations in local source history.`,
  date: "2026-10-24",
};

const wait = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isToastDismissed, setIsToastDismissed] = useState(false);
  const { settings, ready } = useSettings();
  const updateCheckIntervalMinutes = settings.preferences.updateCheckIntervalMinutes;
  const updateChannel = settings.preferences.updateChannel;
  const updateRef = useRef<{ update: Update; channel: UpdateChannel } | null>(null);
  const checkInFlightRef = useRef(false);
  const installInProgressRef = useRef(false);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const lastScheduledChannelRef = useRef<UpdateChannel | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (!installInProgressRef.current) void updateRef.current?.update.close().catch(() => {});
      updateRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isTauri() || !window.navigator.userAgent.includes("Windows")) return;

    let active = true;
    let badgeImage: TaskbarBadgeImage | null = null;

    void Promise.all([
      import("@tauri-apps/api/image"),
      import("@tauri-apps/api/window"),
    ])
      .then(async ([{ Image }, { getCurrentWindow }]) => {
        const appWindow = getCurrentWindow();
        const image = await applyUpdateTaskbarBadge(
          status === "available" || status === "preparing",
          {
          createImage: (rgba, width, height) => Image.new(rgba, width, height),
          setOverlayIcon: (icon) => appWindow.setOverlayIcon(icon),
          },
        );
        if (!image) return;
        if (!active) {
          await image.close();
          return;
        }
        badgeImage = image;
      })
      .catch(() => {
        // A taskbar badge is a quiet enhancement and must never block updates.
      });

    return () => {
      active = false;
      if (badgeImage) void badgeImage.close();
    };
  }, [status]);

  const checkForUpdates = useCallback(async function runCheck(manual = false) {
    if (!getSettingsState().ready || checkInFlightRef.current || installInProgressRef.current) return;
    const channel = getSettingsState().settings.preferences.updateChannel;
    const generation = generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current
      && channel === getSettingsState().settings.preferences.updateChannel;
    checkInFlightRef.current = true;
    const previous = updateRef.current;
    updateRef.current = null;
    void previous?.update.close().catch(() => {});
    setDetails(null);
    setStatus("checking");
    setError(null);
    setIsToastDismissed(false);

    try {
      const previewAvailable =
        import.meta.env.DEV &&
        (new URLSearchParams(window.location.search).get("update") ===
          "available" || import.meta.env.VITE_FORCE_UPDATE_AVAILABLE === "1");
      if (previewAvailable) {
        await wait(350);
        if (!isCurrent()) return;
        setDetails(PREVIEW_UPDATE);
        setStatus("available");
        if (manual) setIsModalOpen(true);
        return;
      }

      if (!isTauri()) {
        await wait(250);
        if (!isCurrent()) return;
        setStatus("current");
        return;
      }

      const metadata = await invoke<ConstructorParameters<typeof Update>[0] | null>("updater_check", { channel });
      const update = metadata ? new Update(metadata) : null;
      if (!isCurrent()) {
        await update?.close().catch(() => {});
        return;
      }

      if (!update) {
        setStatus("current");
        return;
      }

      updateRef.current = { update, channel };
      setDetails({
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body || "This release includes improvements and fixes.",
        date: update.date,
      });
      setStatus("available");
      if (manual) setIsModalOpen(true);
    } catch (cause) {
      if (!isCurrent()) return;
      const message =
        cause instanceof Error ? cause.message : "The update check failed.";
      setError(message);
      setStatus("error");
      if (manual) setIsModalOpen(true);
    } finally {
      checkInFlightRef.current = false;
      // A channel switch during a request queues one check for the latest choice.
      if (mountedRef.current && !isCurrent()) void runCheck(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const firstCheck = lastScheduledChannelRef.current === null;
    lastScheduledChannelRef.current = updateChannel;
    generationRef.current += 1;
    const timeout = window.setTimeout(() => {
      if (installInProgressRef.current) return;
      void updateRef.current?.update.close().catch(() => {});
      updateRef.current = null;
      setDetails(null);
      setIsModalOpen(false);
      setStatus("idle");
      void checkForUpdates(false);
    }, firstCheck ? (isTauri() ? 2_500 : 700) : 0);

    return () => window.clearTimeout(timeout);
  }, [checkForUpdates, ready, updateChannel]);

  useEffect(() => {
    if (!ready || updateCheckIntervalMinutes === 0) return;

    const interval = window.setInterval(
      () => void checkForUpdates(false),
      updateCheckIntervalMinutes * 60_000,
    );
    return () => window.clearInterval(interval);
  }, [checkForUpdates, ready, updateCheckIntervalMinutes, updateChannel]);

  const setUpdateChannel = useCallback((channel: UpdateChannel) => {
    if (installInProgressRef.current || !["stable", "beta"].includes(channel)) return;
    savePreference({ updateChannel: channel });
  }, []);

  const setUpdateCheckIntervalMinutes = useCallback(
    (interval: UpdateCheckIntervalMinutes) => {
      const supported = SUPPORTED_UPDATE_CHECK_INTERVALS.includes(interval)
        ? interval
        : DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES;
      savePreference({ updateCheckIntervalMinutes: supported });
    },
    [],
  );

  const installUpdate = useCallback(async (
    prepare?: () => Promise<unknown>,
    rollback?: () => Promise<unknown>,
  ) => {
    if (installInProgressRef.current) return;
    installInProgressRef.current = true;
    setProgress(0);
    setError(null);

    try {
      const offer = updateRef.current;
      const channel = getSettingsState().settings.preferences.updateChannel;
      if (isTauri() && (!offer || offer.channel !== channel)) {
        throw new Error("The update channel changed. Check again before installing.");
      }
      if (prepare) {
        setStatus("preparing");
        await prepare();
      }
      setStatus("downloading");

      if (!isTauri()) {
        for (const step of [12, 28, 46, 63, 78, 91, 100]) {
          await wait(130);
          setProgress(step);
        }
        setStatus("ready");
        return;
      }

      if (!offer || offer.channel !== getSettingsState().settings.preferences.updateChannel) {
        throw new Error("The update channel changed. Check again before installing.");
      }
      const { update } = offer;

      let downloaded = 0;
      let total = 0;

      // Windows installers may exit without the normal window-close path.
      await invoke("connection_shutdown_network");
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setProgress(0);
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
          }
        }

        if (event.event === "Finished") {
          setProgress(100);
        }
      });

      setStatus("ready");
      await relaunch();
    } catch (cause) {
      if (rollback) {
        try {
          await rollback();
        } catch {
          // Preserve the updater error; Transfers reports rollback failures.
        }
      }
      const message =
        cause instanceof Error ? cause.message : "The update could not install.";
      setError(message);
      setStatus("error");
    } finally {
      installInProgressRef.current = false;
    }
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);
  const remindLater = useCallback(() => {
    setIsToastDismissed(true);
    setIsModalOpen(false);
  }, []);

  return {
    status,
    details,
    progress,
    error,
    isModalOpen,
    shouldShowToast: status === "available" && !isToastDismissed && !isModalOpen,
    updateCheckIntervalMinutes,
    updateChannel,
    setUpdateChannel,
    checkForUpdates,
    setUpdateCheckIntervalMinutes,
    installUpdate,
    openModal,
    closeModal,
    remindLater,
  };
}
