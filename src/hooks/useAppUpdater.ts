import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
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
  currentVersion: "0.0.30",
  version: "0.0.31",
  body: `## What’s new in Forever 0.0.31

### Added

- Open Frequency brings native Soulseek public rooms into a polished three-pane workspace with a searchable room dial, live chat, and a listener rail.
- Room member cards show presence, country, upload-slot availability, speed, and shared-library totals with direct Profile, Message, Browse, Save, Ignore, and Ban actions.
- Mentions and messages in starred rooms can raise native Windows notifications, while bounded room history and favorites stay on this device.

### Changed

- Joined rooms reconnect automatically with the Soulseek session, unread and mention counts appear in Rooms and the sidebar, and public room names and messages are safety-bounded.
- Private room administration is intentionally deferred; v0.0.31 focuses on the public room experience.`,
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

  const checkForUpdates = useCallback(async (manual = false) => {
    if (checkInFlightRef.current || installInProgressRef.current) return;
    checkInFlightRef.current = true;
    setStatus("checking");
    setError(null);
    setIsToastDismissed(false);

    try {
      if (!isTauri()) {
        if (
          import.meta.env.DEV &&
          new URLSearchParams(window.location.search).get("update") ===
            "available"
        ) {
          await wait(350);
          setDetails(PREVIEW_UPDATE);
          setStatus("available");
          if (manual) setIsModalOpen(true);
          return;
        }

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

  const installUpdate = useCallback(async () => {
    if (installInProgressRef.current) return;
    installInProgressRef.current = true;
    setStatus("downloading");
    setProgress(0);
    setError(null);

    if (!isTauri()) {
      for (const step of [12, 28, 46, 63, 78, 91, 100]) {
        await wait(130);
        setProgress(step);
      }
      setStatus("ready");
      installInProgressRef.current = false;
      return;
    }

    const update = updateRef.current;
    if (!update) {
      setError("The update is no longer available. Check again and retry.");
      setStatus("error");
      installInProgressRef.current = false;
      return;
    }

    try {
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
