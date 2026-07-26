import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { LocalSharesSnapshot, UploadQueueSnapshot } from "../types";

const emptyShares: LocalSharesSnapshot = {
  roots: [],
  uploadSlots: 1,
  scanning: false,
  totalFileCount: 0,
  totalDirectoryCount: 0,
  totalSizeBytes: 0,
  lastScanAtMs: null,
};

const previewShares: LocalSharesSnapshot = {
  roots: [
    {
      id: "preview-share",
      path: "C:\\Users\\Music\\Midnight Archive",
      alias: "Midnight Archive",
      enabled: true,
      fileCount: 1248,
      directoryCount: 93,
      totalSizeBytes: 71_600_000_000,
      error: null,
    },
  ],
  uploadSlots: 1,
  scanning: false,
  totalFileCount: 1248,
  totalDirectoryCount: 93,
  totalSizeBytes: 71_600_000_000,
  lastScanAtMs: Date.now() - 84_000,
};

const emptyUploads: UploadQueueSnapshot = {
  uploads: [],
  activeCount: 0,
  queuedCount: 0,
  sessionUploadedBytes: 0,
};

const previewUploads: UploadQueueSnapshot = {
  uploads: [
    {
      id: "preview-upload",
      username: "lowlight.fm",
      remoteFilename: "Midnight Archive\\Burial\\Untrue\\04 Endorphin.flac",
      filename: "04 Endorphin.flac",
      sizeBytes: 31_800_000,
      transferredBytes: 21_200_000,
      speedBytesPerSecond: 2_800_000,
      etaSeconds: 4,
      status: "uploading",
      queuePosition: 0,
      error: null,
      createdAtMs: Date.now() - 18_000,
      updatedAtMs: Date.now(),
    },
  ],
  activeCount: 1,
  queuedCount: 0,
  sessionUploadedBytes: 184_000_000,
};

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function useLocalSharing() {
  const native = isTauri();
  const [shares, setShares] = useState(native ? emptyShares : previewShares);
  const [uploads, setUploads] = useState(native ? emptyUploads : previewUploads);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    const disposers: Array<() => void> = [];

    void Promise.all([
      listen<LocalSharesSnapshot>("forever://local-shares", (event) => {
        if (mounted) setShares(event.payload);
      }),
      listen<UploadQueueSnapshot>("forever://uploads", (event) => {
        if (mounted) setUploads(event.payload);
      }),
      invoke<LocalSharesSnapshot>("local_shares_snapshot"),
      invoke<UploadQueueSnapshot>("uploads_snapshot"),
    ])
      .then(([stopShares, stopUploads, nextShares, nextUploads]) => {
        if (!mounted) {
          stopShares();
          stopUploads();
          return;
        }
        disposers.push(stopShares, stopUploads);
        setShares(nextShares);
        setUploads(nextUploads);
      })
      .catch((cause) => mounted && setError(errorMessage(cause)));

    return () => {
      mounted = false;
      disposers.forEach((dispose) => dispose());
    };
  }, [native]);

  const shareAction = useCallback(
    async (command: string, args?: Record<string, unknown>) => {
      setError(null);
      if (!native) return shares;
      try {
        const snapshot = await invoke<LocalSharesSnapshot>(command, args);
        setShares(snapshot);
        return snapshot;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native, shares],
  );

  const addRoot = useCallback(
    (path: string) => shareAction("local_shares_add", { path }),
    [shareAction],
  );
  const removeRoot = useCallback(
    (id: string) => shareAction("local_shares_remove", { id }),
    [shareAction],
  );
  const setRootEnabled = useCallback(
    (id: string, enabled: boolean) =>
      shareAction("local_shares_set_enabled", { id, enabled }),
    [shareAction],
  );
  const rescan = useCallback(
    () => shareAction("local_shares_rescan"),
    [shareAction],
  );
  const setUploadSlots = useCallback(
    (uploadSlots: number) =>
      shareAction("local_shares_set_upload_slots", { uploadSlots }),
    [shareAction],
  );

  const cancelUpload = useCallback(
    async (id: string) => {
      if (!native) {
        setUploads((current) => ({
          ...current,
          activeCount: 0,
          uploads: current.uploads.map((upload) =>
            upload.id === id ? { ...upload, status: "cancelled" as const } : upload,
          ),
        }));
        return;
      }
      try {
        setError(null);
        const snapshot = await invoke<UploadQueueSnapshot>("upload_cancel", { id });
        setUploads(snapshot);
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native],
  );

  const clearFinishedUploads = useCallback(async () => {
    if (!native) {
      setUploads((current) => ({
        ...current,
        uploads: current.uploads.filter((upload) =>
          ["queued", "connecting", "uploading"].includes(upload.status),
        ),
      }));
      return;
    }
    try {
      setError(null);
      const snapshot = await invoke<UploadQueueSnapshot>("upload_clear_finished");
      setUploads(snapshot);
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, [native]);

  return {
    shares,
    uploads,
    error,
    addRoot,
    removeRoot,
    setRootEnabled,
    rescan,
    setUploadSlots,
    cancelUpload,
    clearFinishedUploads,
    clearError: () => setError(null),
  };
}
