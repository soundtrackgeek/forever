import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FolderFile,
  ReleaseAlternativeSource,
  SearchResult,
  Transfer,
  TransferQueueSnapshot,
} from "../types";
import { groupTransfers } from "../utils/transfers";

const previewNames = [
  "01 - Thresholds.flac",
  "02 - Hollow Planes.flac",
  "03 - Vector Dreams.flac",
  "04 - Night Geometry.flac",
  "05 - Static Bloom.flac",
  "06 - Liminal Structures.flac",
  "07 - Phase Rotate.flac",
  "08 - Afterglow.flac",
  "09 - Silent Constellations.flac",
  "10 - Return Vector.flac",
];

const now = Date.now();
const previewTransfers: Transfer[] = [
  ...previewNames.map((title, index): Transfer => {
    const completed = index < 3;
    const downloading = index === 3;
    const sizeBytes = 84_000_000 + index * 3_700_000;
    return {
      id: `preview-night-${index + 1}`,
      releaseId: "preview-night-geometry",
      releaseTitle: "Night Geometry",
      releaseFolder: "C:\\Users\\Music\\Forever\\Night Geometry",
      fileIndex: index + 1,
      fileCount: previewNames.length,
      title,
      username: "audiophile92",
      remoteFilename: `Music\\Liminal Structures\\Night Geometry\\${title}`,
      sizeBytes,
      transferredBytes: completed ? sizeBytes : downloading ? 62_100_000 : 0,
      speedBytesPerSecond: downloading ? 8_200_000 : 0,
      etaSeconds: downloading ? 5 : completed ? 0 : null,
      status: completed ? "completed" : downloading ? "downloading" : "queued",
      queuePosition: null,
      localPath: `C:\\Users\\Music\\Forever\\Night Geometry\\${title}`,
      error: null,
      verificationStatus: completed ? "verified" : "pending",
      verifiedAtMs: completed ? now : null,
      createdAtMs: now - 30_000 + index,
      updatedAtMs: now,
    };
  }),
  ...["01 - Carbon Echoes.flac", "02 - Peripheral Light.flac"].map(
    (title, index): Transfer => ({
      id: `preview-spheric-${index + 1}`,
      releaseId: "preview-spheric-dusk",
      releaseTitle: "Spheric Dusk",
      releaseFolder: "C:\\Users\\Music\\Forever\\Spheric Dusk",
      fileIndex: index + 1,
      fileCount: 2,
      title,
      username: "vinyljunkie",
      remoteFilename: `Music\\Carbon Echoes\\Spheric Dusk\\${title}`,
      sizeBytes: 78_000_000 + index * 4_000_000,
      transferredBytes: 0,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      status: "queued",
      queuePosition: null,
      localPath: `C:\\Users\\Music\\Forever\\Spheric Dusk\\${title}`,
      error: null,
      verificationStatus: "pending",
      alternativeSources: [
        {
          username: "signalrelay",
          remoteFolder: "Music\\Carbon Echoes\\Spheric Dusk [FLAC]",
          files: [
            { title: "01 - Carbon Echoes.flac", remoteFilename: "Music\\Carbon Echoes\\Spheric Dusk [FLAC]\\01 - Carbon Echoes.flac", sizeBytes: 78_000_000 },
            { title: "02 - Peripheral Light.flac", remoteFilename: "Music\\Carbon Echoes\\Spheric Dusk [FLAC]\\02 - Peripheral Light.flac", sizeBytes: 82_000_000 },
          ],
        },
      ],
      createdAtMs: now - 12_000 + index,
      updatedAtMs: now,
    }),
  ),
  {
    id: "preview-apex-horizon",
    releaseId: "preview-apex-horizon-release",
    releaseTitle: "Apex Horizon (Deluxe)",
    releaseFolder: "C:\\Users\\Music\\Forever\\Apex Horizon (Deluxe)",
    fileIndex: 1,
    fileCount: 1,
    title: "01 - First Light.mp3",
    username: "soulseeker7",
    remoteFilename: "Music\\Apex Horizon\\01 - First Light.mp3",
    sizeBytes: 52_300_000,
    transferredBytes: 52_300_000,
    speedBytesPerSecond: 0,
    etaSeconds: 0,
    status: "completed",
    queuePosition: null,
    localPath: "C:\\Users\\Music\\Forever\\Apex Horizon (Deluxe)\\01 - First Light.mp3",
    error: null,
    verificationStatus: "missing",
    verificationMessage: "The completed file is no longer present in the download folder.",
    verifiedAtMs: now - 79_000,
    createdAtMs: now - 86_400_000,
    updatedAtMs: now - 80_000,
  },
];

const emptySnapshot: TransferQueueSnapshot = {
  transfers: [],
  activeCount: 0,
  maxConcurrentDownloads: 3,
  relaySuggestionMinutes: 10,
};

const withCount = (
  transfers: Transfer[],
  settings: Pick<TransferQueueSnapshot, "maxConcurrentDownloads" | "relaySuggestionMinutes"> = {
    maxConcurrentDownloads: 3,
    relaySuggestionMinutes: 10,
  },
): TransferQueueSnapshot => ({
  transfers,
  activeCount: transfers.filter((transfer) =>
    ["requesting", "remotelyQueued", "connecting", "downloading"].includes(
      transfer.status,
    ),
  ).length,
  maxConcurrentDownloads: settings.maxConcurrentDownloads,
  relaySuggestionMinutes: settings.relaySuggestionMinutes,
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

const normalizedFolder = (value: string) =>
  value.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/^\\|\\$/g, "").toLocaleLowerCase();

const remoteFolder = (remoteFilename: string) => {
  const normalized = normalizedFolder(remoteFilename);
  const separator = normalized.lastIndexOf("\\");
  return separator >= 0 ? normalized.slice(0, separator) : "";
};

const reorderReleaseTransfers = (
  transfers: Transfer[],
  releaseId: string,
  beforeTransferId: string | null,
) => {
  const moving = transfers.filter((transfer) => transfer.releaseId === releaseId);
  if (moving.length === 0) return transfers;
  const remaining = transfers.filter((transfer) => transfer.releaseId !== releaseId);
  const insertion = beforeTransferId
    ? remaining.findIndex((transfer) => transfer.id === beforeTransferId)
    : -1;
  const index = insertion >= 0 ? insertion : remaining.length;
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
};

export type EnqueueReleaseInput = {
  title: string;
  username: string;
  remoteFolder: string;
  files: FolderFile[];
  alternatives?: ReleaseAlternativeSource[];
};

export type TransferCompletionNotice = {
  groupId: string;
  title: string;
  kind: "verified" | "attention";
  message: string;
};

export type TransferActivityNotice = {
  groupId: string;
  title: string;
  kind: "queued" | "started" | "failed";
  message: string;
};

export function useSoulseekTransfers() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<TransferQueueSnapshot>(
    native ? emptySnapshot : withCount(previewTransfers),
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<TransferCompletionNotice | null>(null);
  const [activityNotice, setActivityNotice] = useState<TransferActivityNotice | null>(null);
  const completionState = useRef<Map<string, string>>(new Map());
  const completionReady = useRef(false);
  const activityState = useRef<Map<string, string>>(new Map());
  const activityReady = useRef(false);

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
    const groups = groupTransfers(snapshot.transfers);
    if (completionReady.current && native) {
      for (const group of groups) {
        if (
          group.status === "completed" &&
          completionState.current.get(group.id) !== "completed"
        ) {
          const issues = group.transfers.filter((transfer) =>
            ["missing", "sizeMismatch"].includes(transfer.verificationStatus ?? "pending"),
          ).length;
          setCompletionNotice({
            groupId: group.id,
            title: group.title,
            kind: issues ? "attention" : "verified",
            message: issues
              ? `${issues} ${issues === 1 ? "file needs" : "files need"} attention.`
              : `${group.transfers.length} ${group.transfers.length === 1 ? "file" : "files"} verified in the download folder.`,
          });
          void (async () => {
            let granted = await isPermissionGranted();
            if (!granted) granted = (await requestPermission()) === "granted";
            if (granted) {
              sendNotification({
                title: issues ? "Download completed with issues" : "Release downloaded and verified",
                body: issues
                  ? `${group.title} · ${issues} ${issues === 1 ? "file needs" : "files need"} attention`
                  : `${group.title} · ${group.transfers.length} ${group.transfers.length === 1 ? "file" : "files"} verified`,
              });
            }
          })();
        }
      }
    }
    completionState.current = new Map(
      groups.map((group) => [group.id, group.status]),
    );
    completionReady.current = true;
  }, [native, snapshot.transfers]);

  useEffect(() => {
    if (!ready) return;
    const groups = groupTransfers(snapshot.transfers);
    let noticeTimer: number | undefined;
    if (activityReady.current) {
      const notices: TransferActivityNotice[] = [];
      for (const group of groups) {
        const previous = activityState.current.get(group.id);
        if (group.status === "failed" && previous !== "failed") {
          notices.push({
            groupId: group.id,
            title: group.title,
            kind: "failed",
            message: "The release needs attention in Transfers.",
          });
        } else if (group.status === "active" && previous !== "active") {
          notices.push({
            groupId: group.id,
            title: group.title,
            kind: "started",
            message: "The signal is live and progress is now visible everywhere.",
          });
        } else if (!previous && group.status === "queued") {
          notices.push({
            groupId: group.id,
            title: group.title,
            kind: "queued",
            message: `Added to release queue #${group.queuePosition ?? 1}.`,
          });
        }
      }
      const next = notices.find((notice) => notice.kind === "failed")
        ?? notices.find((notice) => notice.kind === "started")
        ?? notices[0];
      if (next) {
        noticeTimer = window.setTimeout(() => setActivityNotice(next), 0);
      }
    }
    activityState.current = new Map(groups.map((group) => [group.id, group.status]));
    activityReady.current = true;
    return () => {
      if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
    };
  }, [ready, snapshot.transfers]);

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
          if (
            !hasActive &&
            (transfer.status === "queued" ||
              (transfer.status === "retrying" &&
                (transfer.retryAtMs ?? 0) <= Date.now()))
          ) {
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
        return withCount(next, current);
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
      const next = withCount([...snapshot.transfers, transfer], snapshot);
      setSnapshot(next);
      return next;
    },
    [native, snapshot],
  );

  const enqueueRelease = useCallback(
    async (release: EnqueueReleaseInput) => {
      setError(null);
      if (release.files.length === 0) {
        const message = "Choose at least one file before downloading the release.";
        setError(message);
        throw new Error(message);
      }
      const duplicate = groupTransfers(snapshot.transfers).some(
        (group) =>
          Boolean(group.releaseId) &&
          group.status !== "completed" &&
          group.username.toLocaleLowerCase() === release.username.toLocaleLowerCase() &&
          group.transfers.some(
            (transfer) =>
              remoteFolder(transfer.remoteFilename) ===
              normalizedFolder(release.remoteFolder),
          ),
      );
      if (duplicate) {
        const message = "That exact listener and folder are already in the release queue.";
        setError(message);
        throw new Error(message);
      }
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>(
            "transfer_enqueue_release",
            {
              request: {
                title: release.title,
                username: release.username,
                remoteFolder: release.remoteFolder,
                files: release.files.map((file) => ({
                  title: file.filename,
                  remoteFilename: file.remoteFilename,
                  sizeBytes: file.sizeBytes,
                })),
                alternatives: release.alternatives ?? [],
              },
            },
          );
          setSnapshot(next);
          return next;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }

      const created = Date.now();
      const releaseId = `preview-release-${created}`;
      const folderName = release.title.replace(/[<>:"/\\|?*]/g, "_");
      const queueBusy = snapshot.transfers.some((transfer) =>
        [
          "queued",
          "requesting",
          "remotelyQueued",
          "connecting",
          "downloading",
        ].includes(transfer.status),
      );
      const previewSpeed = 4_800_000;
      const preview = release.files.map(
        (file, index): Transfer => {
          const startsNow = !queueBusy && index === 0;
          return {
            id: `${releaseId}-${index}`,
            releaseId,
            releaseTitle: release.title,
            releaseFolder: `C:\\Users\\Music\\Forever\\${folderName}`,
            fileIndex: index + 1,
            fileCount: release.files.length,
            title: file.filename,
            username: release.username,
            remoteFilename: file.remoteFilename,
            sizeBytes: file.sizeBytes,
            transferredBytes: 0,
            speedBytesPerSecond: startsNow ? previewSpeed : 0,
            etaSeconds: startsNow
              ? Math.ceil(file.sizeBytes / previewSpeed)
              : null,
            status: startsNow ? "downloading" : "queued",
            queuePosition: null,
            localPath: `C:\\Users\\Music\\Forever\\${folderName}\\${file.filename}`,
            error: null,
            verificationStatus: "pending",
            alternativeSources: release.alternatives ?? [],
            createdAtMs: created + index,
            updatedAtMs: created,
          };
        },
      );
      const next = withCount([...snapshot.transfers, ...preview], snapshot);
      setSnapshot(next);
      return next;
    },
    [native, snapshot],
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
          current,
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
          current,
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
        withCount(current.transfers.filter((transfer) => transfer.id !== id), current),
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

  const pauseRelease = useCallback(
    async (releaseId: string) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>(
            "transfer_pause_release",
            { releaseId },
          );
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
            transfer.releaseId === releaseId && transfer.status !== "completed"
              ? {
                  ...transfer,
                  status: "paused" as const,
                  speedBytesPerSecond: 0,
                  etaSeconds: null,
                }
              : transfer,
          ),
          current,
        ),
      );
    },
    [native],
  );

  const resumeRelease = useCallback(
    async (releaseId: string) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>(
            "transfer_resume_release",
            { releaseId },
          );
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
            transfer.releaseId === releaseId &&
            ["paused", "failed"].includes(transfer.status)
              ? {
                  ...transfer,
                  status: "queued" as const,
                  error: null,
                  queuePosition: null,
                }
              : transfer,
          ),
          current,
        ),
      );
    },
    [native],
  );

  const cancelRelease = useCallback(
    async (releaseId: string) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>(
            "transfer_cancel_release",
            { releaseId },
          );
          setSnapshot(next);
          return;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }
      setSnapshot((current) =>
        withCount(
          current.transfers.filter(
            (transfer) => transfer.releaseId !== releaseId,
          ),
          current,
        ),
      );
    },
    [native],
  );

  const reorderRelease = useCallback(
    async (releaseId: string, beforeTransferId: string | null) => {
      setError(null);
      if (native) {
        try {
          const next = await invoke<TransferQueueSnapshot>(
            "transfer_reorder_release",
            { releaseId, beforeTransferId },
          );
          setSnapshot(next);
          return;
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }
      setSnapshot((current) =>
        withCount(
          reorderReleaseTransfers(
            current.transfers,
            releaseId,
            beforeTransferId,
          ),
          current,
        ),
      );
    },
    [native],
  );

  const clearCompleted = useCallback(async () => {
    setError(null);
    if (native) {
      try {
        const next = await invoke<TransferQueueSnapshot>(
          "transfer_clear_completed",
        );
        setSnapshot(next);
        return;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    }
    setSnapshot((current) => {
      const completedGroups = new Set(
        groupTransfers(current.transfers)
          .filter((group) => group.status === "completed")
          .map((group) => group.id),
      );
      return withCount(
        current.transfers.filter((transfer) => {
          const groupId = transfer.releaseId ?? `single:${transfer.id}`;
          return !completedGroups.has(groupId);
        }),
        current,
      );
    });
  }, [native]);

  const revealRelease = useCallback(
    async (releaseId: string) => {
      if (!native) return;
      try {
        const path = await invoke<string>("transfer_reveal_release_path", {
          releaseId,
        });
        await revealItemInDir(path);
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native],
  );

  const verifyRelease = useCallback(async (releaseId: string) => {
    setError(null);
    if (native) {
      try {
        const next = await invoke<TransferQueueSnapshot>("transfer_verify_release", { releaseId });
        setSnapshot(next);
        return;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    }
    setSnapshot((current) => withCount(current.transfers.map((transfer) =>
      transfer.releaseId === releaseId && transfer.status === "completed"
        ? { ...transfer, verifiedAtMs: Date.now() }
        : transfer,
    ), current));
  }, [native]);

  const retryReleaseIssues = useCallback(async (releaseId: string) => {
    setError(null);
    if (native) {
      try {
        const next = await invoke<TransferQueueSnapshot>("transfer_retry_release_issues", { releaseId });
        setSnapshot(next);
        return;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    }
    setSnapshot((current) => withCount(current.transfers.map((transfer) => {
      const recoverable = transfer.releaseId === releaseId && (
        transfer.status === "failed" || transfer.verificationStatus === "missing"
      );
      return recoverable ? {
        ...transfer,
        status: "queued" as const,
        transferredBytes: transfer.verificationStatus === "missing" ? 0 : transfer.transferredBytes,
        verificationStatus: "pending" as const,
        verificationMessage: null,
        verifiedAtMs: null,
        error: null,
        retryCount: 0,
        retryAtMs: null,
      } : transfer;
    }), current));
  }, [native]);

  const switchReleaseSource = useCallback(async (
    releaseId: string,
    source: ReleaseAlternativeSource,
  ) => {
    setError(null);
    if (native) {
      try {
        const next = await invoke<TransferQueueSnapshot>("transfer_switch_release_source", {
          releaseId,
          username: source.username,
          remoteFolder: source.remoteFolder,
        });
        setSnapshot(next);
        return;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    }
    setSnapshot((current) => {
      const releaseTransfers = current.transfers.filter((transfer) => transfer.releaseId === releaseId);
      const first = releaseTransfers[0];
      if (!first) return current;
      const previous: ReleaseAlternativeSource = {
        username: first.username,
        remoteFolder: remoteFolder(first.remoteFilename),
        files: releaseTransfers.map((transfer) => ({
          title: transfer.title,
          remoteFilename: transfer.remoteFilename,
          sizeBytes: transfer.sizeBytes,
        })),
      };
      return withCount(current.transfers.map((transfer) => {
        if (transfer.releaseId !== releaseId) return transfer;
        const alternatives = (transfer.alternativeSources ?? [])
          .filter((candidate) => !(candidate.username.toLocaleLowerCase() === source.username.toLocaleLowerCase() && normalizedFolder(candidate.remoteFolder) === normalizedFolder(source.remoteFolder)));
        if (!alternatives.some((candidate) => candidate.username.toLocaleLowerCase() === previous.username.toLocaleLowerCase() && normalizedFolder(candidate.remoteFolder) === normalizedFolder(previous.remoteFolder))) alternatives.push(previous);
        if (transfer.status === "completed" && transfer.verificationStatus !== "missing") return { ...transfer, alternativeSources: alternatives };
        const match = source.files.find((file) => file.sizeBytes === transfer.sizeBytes && basename(file.remoteFilename).toLocaleLowerCase() === basename(transfer.remoteFilename).toLocaleLowerCase());
        if (!match) return { ...transfer, alternativeSources: alternatives };
        return {
          ...transfer,
          username: source.username,
          remoteFilename: match.remoteFilename,
          title: match.title,
          status: "queued" as const,
          error: null,
          retryCount: 0,
          retryAtMs: null,
          verificationStatus: "pending" as const,
          verificationMessage: null,
          verifiedAtMs: null,
          alternativeSources: alternatives,
        };
      }), current);
    });
  }, [native]);

  const relayReleaseSource = useCallback(async (
    releaseId: string,
    source: ReleaseAlternativeSource,
  ) => {
    setError(null);
    try {
      if (native) {
        const next = await invoke<TransferQueueSnapshot>("transfer_relay_release_source", {
          releaseId,
          source,
        });
        setSnapshot(next);
        return next;
      }
      await switchReleaseSource(releaseId, source);
      return snapshot;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, [native, snapshot, switchReleaseSource]);

  const clearCompletionNotice = useCallback(() => setCompletionNotice(null), []);
  const clearActivityNotice = useCallback(() => setActivityNotice(null), []);
  const clearError = useCallback(() => setError(null), []);
  const setMaxConcurrentDownloads = useCallback(async (maxConcurrentDownloads: number) => {
    setError(null);
    try {
      const next = native
        ? await invoke<TransferQueueSnapshot>("transfer_set_max_concurrent_downloads", { maxConcurrentDownloads })
        : { ...snapshot, maxConcurrentDownloads };
      setSnapshot(next);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, [native, snapshot]);

  const setRelaySuggestionMinutes = useCallback(async (minutes: number) => {
    setError(null);
    try {
      const next = native
        ? await invoke<TransferQueueSnapshot>("transfer_set_relay_suggestion_minutes", { minutes })
        : { ...snapshot, relaySuggestionMinutes: minutes };
      setSnapshot(next);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, [native, snapshot]);

  return useMemo(
    () => ({
      ready,
      snapshot,
      error,
      enqueue,
      enqueueRelease,
      pause,
      resume,
      cancel,
      reveal,
      pauseRelease,
      resumeRelease,
      cancelRelease,
      reorderRelease,
      clearCompleted,
      revealRelease,
      verifyRelease,
      retryReleaseIssues,
      switchReleaseSource,
      relayReleaseSource,
      setMaxConcurrentDownloads,
      setRelaySuggestionMinutes,
      completionNotice,
      clearCompletionNotice,
      activityNotice,
      clearActivityNotice,
      clearError,
    }),
    [
      cancel,
      cancelRelease,
      clearCompleted,
      clearCompletionNotice,
      clearActivityNotice,
      clearError,
      enqueue,
      enqueueRelease,
      error,
      pause,
      pauseRelease,
      ready,
      reorderRelease,
      resume,
      resumeRelease,
      reveal,
      revealRelease,
      verifyRelease,
      retryReleaseIssues,
      switchReleaseSource,
      relayReleaseSource,
      setMaxConcurrentDownloads,
      setRelaySuggestionMinutes,
      completionNotice,
      activityNotice,
      snapshot,
    ],
  );
}
