import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectionBootstrap,
  ConnectionProfile,
  ConnectionSnapshot,
  DiagnosticEntry,
} from "../types";

const MOCK_PROFILE: ConnectionProfile = {
  username: "SignalLevel",
  serverHost: "server.slsknet.org",
  serverPort: 2242,
  downloadDirectory: "C:\\Users\\Music\\Forever",
  rememberPassword: true,
  autoConnect: true,
};

const now = () => Date.now();

function previewBootstrap(): ConnectionBootstrap {
  const showOnboarding =
    new URLSearchParams(window.location.search).get("onboarding") === "1";
  const profile = showOnboarding ? null : MOCK_PROFILE;

  return {
    profile,
    suggestedProfile: {
      ...MOCK_PROFILE,
      username: "",
    },
    hasPassword: !showOnboarding,
    snapshot: profile
      ? {
          state: "online",
          username: profile.username,
          server: `${profile.serverHost}:${profile.serverPort}`,
          message: "Network online",
          attempt: 1,
          connectedAtMs: now() - 82_000,
          retryInSeconds: null,
          updatedAtMs: now(),
        }
      : {
          state: "unconfigured",
          username: null,
          server: null,
          message: "Add your Soulseek account to get started.",
          attempt: 0,
          connectedAtMs: null,
          retryInSeconds: null,
          updatedAtMs: now(),
        },
    diagnosticsPath:
      "C:\\Users\\AppData\\Roaming\\com.soundtrackgeek.forever\\logs\\connection.log",
    diagnostics: [
      {
        timestampMs: now() - 82_000,
        level: "info",
        event: "connected",
        message: "Authenticated with the Soulseek server.",
      },
    ],
  };
}

const wait = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

function rethrow(cause: unknown): never {
  if (cause instanceof Error) throw cause;
  const error = new Error(errorMessage(cause));
  Object.assign(error, { cause });
  throw error;
}

export function useSoulseekConnection() {
  const native = isTauri();
  const [bootstrap, setBootstrap] = useState<ConnectionBootstrap | null>(() =>
    native ? null : previewBootstrap(),
  );
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(
    () => bootstrap?.snapshot ?? null,
  );
  const bootstrapRef = useRef(bootstrap);
  const [error, setError] = useState<string | null>(null);
  const autoConnectStarted = useRef(false);

  const refresh = useCallback(async () => {
    if (!native) return previewBootstrap();

    try {
      const next = await invoke<ConnectionBootstrap>("connection_bootstrap");
      bootstrapRef.current = next;
      setBootstrap(next);
      setSnapshot(next.snapshot);
      setError(null);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    }
  }, [native]);

  useEffect(() => {
    if (!native) return;

    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<ConnectionSnapshot>(
      "forever://connection-status",
      (event) => {
        if (mounted) setSnapshot(event.payload);
      },
    ).then((dispose) => {
      if (mounted) {
        unlisten = dispose;
      } else {
        dispose();
      }
    });
    void (async () => {
      try {
        const next = await invoke<ConnectionBootstrap>("connection_bootstrap");
        if (!mounted) return;
        bootstrapRef.current = next;
        setBootstrap(next);
        setSnapshot(next.snapshot);
        setError(null);
      } catch (cause) {
        if (mounted) setError(errorMessage(cause));
      }
    })();

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [native]);

  const saveProfile = useCallback(
    async (profile: ConnectionProfile, password?: string) => {
      setError(null);
      // A save is an explicit user flow; do not race it with startup auto-connect.
      autoConnectStarted.current = true;
      try {
        if (!native) {
          await wait(240);
          const next: ConnectionBootstrap = {
            ...(bootstrapRef.current ?? previewBootstrap()),
            profile,
            hasPassword:
              Boolean(password) || bootstrapRef.current?.hasPassword === true,
            snapshot: {
              state: "offline",
              username: profile.username,
              server: `${profile.serverHost}:${profile.serverPort}`,
              message: "Ready to connect.",
              attempt: 0,
              connectedAtMs: null,
              retryInSeconds: null,
              updatedAtMs: now(),
            },
          };
          bootstrapRef.current = next;
          setBootstrap(next);
          setSnapshot(next.snapshot);
          return next;
        }

        const next = await invoke<ConnectionBootstrap>(
          "connection_save_profile",
          {
            request: {
              profile,
              password: password || null,
            },
          },
        );
        bootstrapRef.current = next;
        setBootstrap(next);
        setSnapshot(next.snapshot);
        return next;
      } catch (cause) {
        const message = errorMessage(cause);
        setError(message);
        rethrow(cause);
      }
    },
    [native],
  );

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!native) {
        const profile = bootstrapRef.current?.profile;
        if (!profile) throw new Error("Add your Soulseek account before connecting.");

        setSnapshot({
          state: "connecting",
          username: profile.username,
          server: `${profile.serverHost}:${profile.serverPort}`,
          message: "Connecting to the Soulseek network…",
          attempt: 1,
          connectedAtMs: null,
          retryInSeconds: null,
          updatedAtMs: now(),
        });
        await wait(360);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                state: "authenticating",
                message: "Signing in to Soulseek…",
                updatedAtMs: now(),
              }
            : current,
        );
        await wait(420);
        if (profile.username.toLowerCase() === "invalid") {
          const message = "That Soulseek username or password was not accepted.";
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  state: "error",
                  message,
                  updatedAtMs: now(),
                }
              : current,
          );
          throw new Error(message);
        }
        const connected: ConnectionSnapshot = {
          state: "online",
          username: profile.username,
          server: `${profile.serverHost}:${profile.serverPort}`,
          message: "Network online",
          attempt: 1,
          connectedAtMs: now(),
          retryInSeconds: null,
          updatedAtMs: now(),
        };
        setSnapshot(connected);
        return connected;
      }

      const next = await invoke<ConnectionSnapshot>("connection_connect");
      setSnapshot(next);
      return next;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      rethrow(cause);
    }
  }, [native]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      if (!native) {
        const profile = bootstrapRef.current?.profile;
        const next: ConnectionSnapshot = profile
          ? {
              state: "offline",
              username: profile.username,
              server: `${profile.serverHost}:${profile.serverPort}`,
              message: "Ready to connect.",
              attempt: 0,
              connectedAtMs: null,
              retryInSeconds: null,
              updatedAtMs: now(),
            }
          : previewBootstrap().snapshot;
        setSnapshot(next);
        return next;
      }

      const next = await invoke<ConnectionSnapshot>("connection_disconnect");
      setSnapshot(next);
      return next;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      rethrow(cause);
    }
  }, [native]);

  const reset = useCallback(async () => {
    setError(null);
    try {
      if (!native) {
        const next = previewBootstrap();
        next.profile = null;
        next.hasPassword = false;
        next.snapshot = {
          state: "unconfigured",
          username: null,
          server: null,
          message: "Add your Soulseek account to get started.",
          attempt: 0,
          connectedAtMs: null,
          retryInSeconds: null,
          updatedAtMs: now(),
        };
        bootstrapRef.current = next;
        setBootstrap(next);
        setSnapshot(next.snapshot);
        autoConnectStarted.current = false;
        return next;
      }

      const next = await invoke<ConnectionBootstrap>("connection_reset");
      bootstrapRef.current = next;
      setBootstrap(next);
      setSnapshot(next.snapshot);
      autoConnectStarted.current = false;
      return next;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      rethrow(cause);
    }
  }, [native]);

  const loadDiagnostics = useCallback(async () => {
    if (!native) return bootstrapRef.current?.diagnostics ?? [];
    return invoke<DiagnosticEntry[]>("connection_diagnostics");
  }, [native]);

  useEffect(() => {
    if (
      !bootstrap?.profile?.autoConnect ||
      !bootstrap.hasPassword ||
      snapshot?.state !== "offline" ||
      autoConnectStarted.current
    ) {
      return;
    }

    autoConnectStarted.current = true;
    void connect().catch(() => undefined);
  }, [bootstrap, connect, snapshot?.state]);

  return useMemo(
    () => ({
      ready: bootstrap !== null,
      profile: bootstrap?.profile ?? null,
      suggestedProfile: bootstrap?.suggestedProfile ?? MOCK_PROFILE,
      hasPassword: bootstrap?.hasPassword ?? false,
      snapshot: snapshot ?? previewBootstrap().snapshot,
      diagnosticsPath: bootstrap?.diagnosticsPath ?? "",
      diagnostics: bootstrap?.diagnostics ?? [],
      error,
      saveProfile,
      connect,
      disconnect,
      reset,
      refresh,
      loadDiagnostics,
    }),
    [
      bootstrap,
      connect,
      disconnect,
      error,
      loadDiagnostics,
      refresh,
      reset,
      saveProfile,
      snapshot,
    ],
  );
}
