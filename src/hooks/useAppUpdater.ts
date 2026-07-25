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

const PREVIEW_UPDATE: UpdateDetails = {
  currentVersion: "0.0.2",
  version: "0.0.3",
  body: "A preview release for exercising Forever’s signed update experience.",
  date: "2026-07-25",
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
  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    setStatus("checking");
    setError(null);
    setIsToastDismissed(false);

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

    try {
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
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void checkForUpdates(false);
    }, isTauri() ? 2_500 : 700);

    return () => window.clearTimeout(timeout);
  }, [checkForUpdates]);

  const installUpdate = useCallback(async () => {
    setStatus("downloading");
    setProgress(0);
    setError(null);

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
      setError("The update is no longer available. Check again and retry.");
      setStatus("error");
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
    checkForUpdates,
    installUpdate,
    openModal,
    closeModal,
    remindLater,
  };
}
