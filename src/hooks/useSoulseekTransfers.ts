import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SearchResult,
  Transfer,
  TransferQueueSnapshot,
} from "../types";

const previewTransfers: Transfer[] = [
  {
    id: "preview-thresholds",
    title: "01 - Thresholds.flac",
    username: "audiophile92",
    remoteFilename:
      "Music\\Liminal Structures\\Night Geometry\\01 - Thresholds.flac",
    sizeBytes: 118_400_000,
    transferredBytes: 72_300_000,
    speedBytesPerSecond: 8_200_000,
    etaSeconds: 6,
    status: "downloading",
    queuePosition: null,
    localPath: "C:\\Users\\Music\\Forever\\01 - Thresholds.flac",
    error: null,
    createdAtMs: Date.now() - 18_000,
    updatedAtMs: Date.now(),
  },
  {
    id: "preview-hollow-planes",
    title: "02 - Hollow Planes.flac",
    username: "deepcrate",
    remoteFilename:
      "Music\\Liminal Structures\\Night Geometry\\02 - Hollow Planes.flac",
    sizeBytes: 112_700_000,
    transferredBytes: 0,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    status: "queued",
    queuePosition: null,
    localPath: "C:\\Users\\Music\\Forever\\02 - Hollow Planes.flac",
    error: null,
    createdAtMs: Date.now() - 7_000,
    updatedAtMs: Date.now(),
  },
];

const emptySnapshot: TransferQueueSnapshot = {
  transfers: [],
  activeCount: 0,
};

const withCount = (transfers: Transfer[]): TransferQueueSnapshot => ({
  transfers,
  activeCount: transfers.filter((transfer) =>
    ["requesting", "remotelyQueued", "connecting", "downloading"].includes(
      transfer.status,
    ),
  ).length,
});

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const previewFilename = (result: SearchResult) =>
  result.filename ??
  `Music\\Preview\\${result.title.replace(/[<>:"/\\|?*]/g, "_")}.flac`;

const basename = (path: string) => {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
};

export function useSoulseekTransfers() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<TransferQueueSnapshot>(
    native ? emptySnapshot : withCount(previewTransfers),
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<TransferQueueSnapshot>("forever://transfers", (event) => {
      if (mounted) setSnapshot(event.payload);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });

    void invoke<TransferQueueSnapshot>("transfers_snapshot")
      .then((next) => {
        if (mounted) setSnapshot(next);
      })
      .catch((cause) => {
        if (mounted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [native]);

  useEffect(() => {
    if (native) return;
    const timer = window.setInterval(() => {
      setSnapshot((current) => {
        let hasActive = current.transfers.some((transfer) =>
          ["requesting", "remotelyQueued", "connecting", "downloading"].includes(
            transfer.status,
          ),
        );
        const next = current.transfers.map((transfer) => {
          if (transfer.status === "downloading") {
            const transferredBytes = Math.min(
              transfer.sizeBytes,
              transfer.transferredBytes + transfer.speedBytesPerSecond / 2,
            );
            const complete = transferredBytes >= transfer.sizeBytes;
            if (complete) hasActive = false;
            return {
              ...transfer,
              transferredBytes,
              etaSeconds: complete
                ? 0
                : Math.ceil(
                    (transfer.sizeBytes - transferredBytes) /
                      transfer.speedBytesPerSecond,
                  ),
              speedBytesPerSecond: complete
                ? 0
                : transfer.speedBytesPerSecond,
              status: complete ? ("completed" as const) : transfer.status,
              updatedAtMs: Date.now(),
            };
          }
          if (!hasActive && transfer.status === "queued") {
            hasActive = true;
            return {
              ...transfer,
              status: "downloading" as const,
              speedBytesPerSecond: 6_800_000,
              etaSeconds: Math.ceil(
                (transfer.sizeBytes - transfer.transferredBytes) / 6_800_000,
              ),
              updatedAtMs: Date.now(),
            };
          }
          return transfer;
        });
        return withCount(next);
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [native]);

  const enqueue = useCallback(
    async (result: SearchResult) => {
      setError(null);
      const remoteFilename = previewFilename(result);
      const sizeBytes = result.sizeBytes ?? 118_400_000;
      if (native && (!result.filename || !result.sizeBytes || result.source !== "live")) {
        const message = "Choose a live Soulseek file before downloading.";
        setError(message);
        throw new Error(message);
      }

      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>("transfer_enqueue", {
            request: {
              title: result.title,
              username: result.owner,
              remoteFilename,
              sizeBytes,
            },
          });
          setSnapshot(next);
          return next;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }

      const id = `preview-download-${Date.now()}`;
      const transfer: Transfer = {
        id,
        title: basename(remoteFilename) || result.title,
        username: result.owner,
        remoteFilename,
        sizeBytes,
        transferredBytes: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        status: "queued",
        queuePosition: null,
        localPath: `C:\\Users\\Music\\Forever\\${basename(remoteFilename)}`,
        error: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      const next = withCount([...snapshot.transfers, transfer]);
      setSnapshot(next);
      return next;
    },
    [native, snapshot.transfers],
  );

  const pause = useCallback(
    async (id: string) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>("transfer_pause", { id });
          setSnapshot(next);
          return;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }
      setSnapshot((current) =>
        withCount(
          current.transfers.map((transfer) =>
            transfer.id === id
              ? {
                  ...transfer,
                  status: "paused" as const,
                  speedBytesPerSecond: 0,
                  etaSeconds: null,
                }
              : transfer,
          ),
        ),
      );
    },
    [native],
  );

  const resume = useCallback(
    async (id: string) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>("transfer_resume", { id });
          setSnapshot(next);
          return;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }
      setSnapshot((current) =>
        withCount(
          current.transfers.map((transfer) =>
            transfer.id === id
              ? {
                  ...transfer,
                  status: "queued" as const,
                  error: null,
                  queuePosition: null,
                }
              : transfer,
          ),
        ),
      );
    },
    [native],
  );

  const cancel = useCallback(
    async (id: string) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>("transfer_cancel", { id });
          setSnapshot(next);
          return;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }
      setSnapshot((current) =>
        withCount(current.transfers.filter((transfer) => transfer.id !== id)),
      );
    },
    [native],
  );

  const reveal = useCallback(
    async (id: string) => {
      if (!native) return;
      try {
        const path = await invoke<string>("transfer_reveal_path", { id });
        await revealItemInDir(path);
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native],
  );

  return useMemo(
    () => ({
      ready,
      snapshot,
      error,
      enqueue,
      pause,
      resume,
      cancel,
      reveal,
      clearError: () => setError(null),
    }),
    [cancel, enqueue, error, pause, ready, resume, reveal, snapshot],
  );
}
