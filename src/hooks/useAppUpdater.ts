import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
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

export type UpdateCheckIntervalMinutes = 0 | 1 | 5 | 15 | 30 | 60;

export const DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES: UpdateCheckIntervalMinutes = 5;
export const UPDATE_CHECK_INTERVAL_STORAGE_KEY =
  "forever.updateCheckIntervalMinutes";

const SUPPORTED_UPDATE_CHECK_INTERVALS: UpdateCheckIntervalMinutes[] = [
  0, 1, 5, 15, 30, 60,
];

const PREVIEW_UPDATE: UpdateDetails = {
  currentVersion: "0.0.42",
  version: "0.0.43",
  body: `## What’s new in Forever 0.0.43

### Fixed

- Release validation now gives frontend integration flows enough time on slower Windows runners.

### Changed

- Safe Passage remains unchanged: active downloads are still flushed, persisted, and resumed safely.`,
  date: "2026-07-27",
};

const wait = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

function readUpdateCheckInterval(): UpdateCheckIntervalMinutes {
  try {
    const value = window.localStorage.getItem(
      UPDATE_CHECK_INTERVAL_STORAGE_KEY,
    );
    if (value === null) return DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES;
    const stored = Number(value);
    if (
      SUPPORTED_UPDATE_CHECK_INTERVALS.includes(
        stored as UpdateCheckIntervalMinutes,
      )
    ) {
      return stored as UpdateCheckIntervalMinutes;
    }
  } catch {
    // Fall back to the safe default if WebView storage is unavailable.
  }

  return DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES;
}

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isToastDismissed, setIsToastDismissed] = useState(false);
  const [updateCheckIntervalMinutes, setUpdateCheckIntervalState] =
    useState<UpdateCheckIntervalMinutes>(readUpdateCheckInterval);
  const updateRef = useRef<Update | null>(null);
  const checkInFlightRef = useRef(false);
  const installInProgressRef = useRef(false);

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

  const checkForUpdates = useCallback(async (manual = false) => {
    if (checkInFlightRef.current || installInProgressRef.current) return;
    checkInFlightRef.current = true;
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
        setDetails(PREVIEW_UPDATE);
        setStatus("available");
        if (manual) setIsModalOpen(true);
        return;
      }

      if (!isTauri()) {
        await wait(250);
        setStatus("current");
        if (manual) {
          window.setTimeout(() => setStatus("idle"), 2200);
        }
        return;
      }

      const update = await check({ timeout: 12_000 });

      if (!update) {
        setStatus("current");
        if (manual) {
          window.setTimeout(() => setStatus("idle"), 2200);
        }
        return;
      }

      updateRef.current = update;
      setDetails({
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body || "This release includes improvements and fixes.",
        date: update.date,
      });
      setStatus("available");
      if (manual) setIsModalOpen(true);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The update check failed.";
      setError(message);
      setStatus("error");
      if (manual) setIsModalOpen(true);
    } finally {
      checkInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void checkForUpdates(false);
    }, isTauri() ? 2_500 : 700);

    return () => window.clearTimeout(timeout);
  }, [checkForUpdates]);

  useEffect(() => {
    if (updateCheckIntervalMinutes === 0) return;

    const interval = window.setInterval(
      () => void checkForUpdates(false),
      updateCheckIntervalMinutes * 60_000,
    );
    return () => window.clearInterval(interval);
  }, [checkForUpdates, updateCheckIntervalMinutes]);

  const setUpdateCheckIntervalMinutes = useCallback(
    (interval: UpdateCheckIntervalMinutes) => {
      const supported = SUPPORTED_UPDATE_CHECK_INTERVALS.includes(interval)
        ? interval
        : DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES;
      setUpdateCheckIntervalState(supported);
      try {
        window.localStorage.setItem(
          UPDATE_CHECK_INTERVAL_STORAGE_KEY,
          String(supported),
        );
      } catch {
        // The current session still uses the selected interval.
      }
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

      const update = updateRef.current;
      if (!update) {
        throw new Error("The update is no longer available. Check again and retry.");
      }

      let downloaded = 0;
      let total = 0;

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
    checkForUpdates,
    setUpdateCheckIntervalMinutes,
    installUpdate,
    openModal,
    closeModal,
    remindLater,
  };
}
