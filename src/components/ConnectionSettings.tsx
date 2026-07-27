import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowsClockwise,
  BellRinging,
  Check,
  DownloadSimple,
  FolderOpen,
  FolderPlus,
  HardDrives,
  LockKey,
  Plug,
  Plugs,
  ShieldCheck,
  Trash,
  UserPlus,
} from "@phosphor-icons/react";
import type { UpdateCheckIntervalMinutes } from "../hooks/useAppUpdater";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ConnectionProfile,
  ConnectionSnapshot,
  DiagnosticEntry,
  DistributedSnapshot,
  LocalSharesSnapshot,
} from "../types";

type ConnectionSettingsProps = {
  profile: ConnectionProfile;
  hasPassword: boolean;
  snapshot: ConnectionSnapshot;
  searchNetwork: DistributedSnapshot;
  diagnostics: DiagnosticEntry[];
  diagnosticsPath: string;
  error: string | null;
  onSave: (profile: ConnectionProfile, password?: string) => Promise<unknown>;
  onConnect: () => Promise<unknown>;
  onDisconnect: () => Promise<unknown>;
  onReset: () => Promise<unknown>;
  onLoadDiagnostics: () => Promise<DiagnosticEntry[]>;
  onCheckForUpdates: () => void;
  updateCheckIntervalMinutes: UpdateCheckIntervalMinutes;
  onUpdateCheckIntervalChange: (
    interval: UpdateCheckIntervalMinutes,
  ) => void;
  localShares: LocalSharesSnapshot;
  sharingError: string | null;
  onAddShare: (path: string) => Promise<unknown>;
  onRemoveShare: (id: string) => Promise<unknown>;
  onSetShareEnabled: (id: string, enabled: boolean) => Promise<unknown>;
  onRescanShares: () => Promise<unknown>;
  onSetUploadSlots: (slots: number) => Promise<unknown>;
  maxConcurrentDownloads: number;
  onSetMaxConcurrentDownloads: (maximum: number) => Promise<unknown>;
  messageNotificationsEnabled: boolean;
  onMessageNotificationsChange: (enabled: boolean) => void;
  roomNotificationsEnabled: boolean;
  onRoomNotificationsChange: (enabled: boolean) => void;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
};

const statusLabels: Record<ConnectionSnapshot["state"], string> = {
  unconfigured: "Not configured",
  offline: "Offline",
  connecting: "Connecting",
  authenticating: "Signing in",
  online: "Network online",
  reconnecting: "Reconnecting",
  error: "Needs attention",
};

const searchNetworkLabels: Record<DistributedSnapshot["state"], string> = {
  offline: "Global search offline",
  discovering: "Finding search relay",
  connected: "Global search connected",
  branchRoot: "Global search connected",
};

const searchNetworkDetail = (snapshot: DistributedSnapshot) => {
  if (snapshot.state === "connected" || snapshot.state === "branchRoot") {
    return `${snapshot.searchesReceived} received · ${snapshot.searchesAnswered} answered`;
  }
  return snapshot.message;
};

function formatTime(timestampMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestampMs);
}

export function ConnectionSettings({
  profile,
  hasPassword,
  snapshot,
  searchNetwork,
  diagnostics: initialDiagnostics,
  diagnosticsPath,
  error,
  onSave,
  onConnect,
  onDisconnect,
  onReset,
  onLoadDiagnostics,
  onCheckForUpdates,
  updateCheckIntervalMinutes,
  onUpdateCheckIntervalChange,
  localShares,
  sharingError,
  onAddShare,
  onRemoveShare,
  onSetShareEnabled,
  onRescanShares,
  onSetUploadSlots,
  maxConcurrentDownloads,
  onSetMaxConcurrentDownloads,
  messageNotificationsEnabled,
  onMessageNotificationsChange,
  roomNotificationsEnabled,
  onRoomNotificationsChange,
}: ConnectionSettingsProps) {
  const [draft, setDraft] = useState(profile);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics);
  const busy = ["connecting", "authenticating", "reconnecting"].includes(
    snapshot.state,
  );

  useEffect(() => {
    void onLoadDiagnostics()
      .then(setDiagnostics)
      .catch(() => undefined);
  }, [onLoadDiagnostics, searchNetwork.updatedAtMs, snapshot.updatedAtMs]);

  const chooseFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose Forever download folder",
      defaultPath: draft.downloadDirectory,
    });
    if (typeof selected === "string") {
      setDraft((current) => ({ ...current, downloadDirectory: selected }));
    }
  };

  const addSharedFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a release folder to share",
    });
    if (typeof selected === "string") await onAddShare(selected);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await onSave(draft, password || undefined);
      setPassword("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch {
      // The connection hook exposes the user-facing error beside the form.
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="connection-settings">
      <header className="settings-heading">
        <div>
          <span className="eyebrow">Settings</span>
          <h1>Connection</h1>
          <p>Account, network, and startup preferences for Soulseek.</p>
        </div>
        <div className="settings-status-cluster">
          <div className={`connection-state-badge is-${snapshot.state}`}>
            <i aria-hidden="true" />
            <span>
              <strong>{statusLabels[snapshot.state]}</strong>
              <small>{snapshot.server || "Soulseek network"}</small>
            </span>
          </div>
          <div
            className={`connection-state-badge search-network-badge is-${searchNetwork.state}`}
          >
            <i aria-hidden="true" />
            <span>
              <strong>{searchNetworkLabels[searchNetwork.state]}</strong>
              <small>{searchNetworkDetail(searchNetwork)}</small>
            </span>
          </div>
        </div>
      </header>

      <div className="settings-scroll">
        <form className="settings-panel" onSubmit={save}>
          <div className="settings-panel-heading">
            <div className="settings-icon">
              <ShieldCheck size={19} weight="light" />
            </div>
            <div>
              <h2>Soulseek account</h2>
              <p>Credentials stay protected by the operating system.</p>
            </div>
          </div>

          <div className="settings-form-grid">
            <label className="connection-field">
              <span>Username</span>
              <input
                required
                maxLength={30}
                autoComplete="username"
                value={draft.username}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
              />
            </label>
            <label className="connection-field">
              <span>Password</span>
              <span className="input-with-icon">
                <LockKey size={15} />
                <input
                  type="password"
                  required={!hasPassword}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={hasPassword ? "Stored securely ••••••••" : "Required"}
                />
              </span>
            </label>
            <label className="connection-field">
              <span>Server</span>
              <input
                required
                value={draft.serverHost}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    serverHost: event.target.value,
                  }))
                }
              />
            </label>
            <label className="connection-field">
              <span>Port</span>
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={draft.serverPort}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    serverPort: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="connection-field settings-folder">
              <span>Download folder</span>
              <span className="folder-input">
                <input
                  required
                  value={draft.downloadDirectory}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      downloadDirectory: event.target.value,
                    }))
                  }
                />
                <button type="button" onClick={() => void chooseFolder()}>
                  <FolderOpen size={16} /> Browse
                </button>
              </span>
            </label>
          </div>

          <div className="account-behavior-note is-compact">
            <UserPlus size={16} weight="light" />
            <span>
              <strong>Unused usernames are registered automatically</strong>
              <small>
                Soulseek only reports a wrong password when that username
                already belongs to someone.
              </small>
            </span>
          </div>

          <div className="settings-toggle-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.rememberPassword}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    rememberPassword: event.target.checked,
                  }))
                }
              />
              <span className="toggle-visual" aria-hidden="true">
                <i />
              </span>
              <span>
                <strong>Remember password</strong>
                <small>Keep it in Windows Credential Manager.</small>
              </span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.autoConnect}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    autoConnect: event.target.checked,
                  }))
                }
              />
              <span className="toggle-visual" aria-hidden="true">
                <i />
              </span>
              <span>
                <strong>Connect on startup</strong>
                <small>Tune in automatically when Forever opens.</small>
              </span>
            </label>
          </div>

          {(error || snapshot.state === "error") && (
            <p className="connection-error" role="alert">
              {error || snapshot.message}
            </p>
          )}

          <div className="settings-actions">
            <button className="primary-action" type="submit" disabled={saving}>
              {saved ? <Check size={16} weight="bold" /> : null}
              {saved ? "Saved" : saving ? "Saving…" : "Save changes"}
            </button>
            {snapshot.state === "online" || busy ? (
              <button
                className="secondary-text-button"
                type="button"
                onClick={() => void onDisconnect()}
              >
                <Plugs size={16} /> Disconnect
              </button>
            ) : (
              <button
                className="secondary-text-button"
                type="button"
                onClick={() => void onConnect()}
              >
                <Plug size={16} /> Connect now
              </button>
            )}
            <span className="settings-status-copy">{snapshot.message}</span>
          </div>
        </form>

        <section className="settings-panel download-lanes-panel">
          <div className="settings-panel-heading">
            <div className="settings-icon"><DownloadSimple size={19} weight="light" /></div>
            <div>
              <h2>Download lanes</h2>
              <p>Download one file per user while several different users send in parallel.</p>
            </div>
          </div>
          <label className="download-lanes-field">
            <span><strong>Simultaneous users</strong><small>Three is the default. Existing downloads finish naturally if you lower it.</small></span>
            <select aria-label="Simultaneous download users" value={maxConcurrentDownloads} onChange={(event) => void onSetMaxConcurrentDownloads(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((maximum) => <option value={maximum} key={maximum}>{maximum} {maximum === 1 ? "user" : "users"}</option>)}
            </select>
          </label>
        </section>

        <section className="settings-panel sharing-panel">
          <div className="settings-panel-heading sharing-panel-heading">
            <div className="settings-icon">
              <HardDrives size={19} weight="light" />
            </div>
            <div>
              <h2>Your shared releases</h2>
              <p>Audio, artwork, lyrics, cue sheets, logs, and other release files are indexed. Local paths never leave Forever.</p>
            </div>
            <span className="sharing-total">
              <strong>{localShares.totalFileCount.toLocaleString()}</strong>
              <small>files · {formatBytes(localShares.totalSizeBytes)}</small>
            </span>
          </div>

          <div className="share-root-list">
            {localShares.roots.length === 0 ? (
              <div className="share-empty">
                <HardDrives size={22} weight="thin" />
                <span><strong>No releases shared yet</strong><small>Add a folder to let other Soulseek users browse and download complete releases from you.</small></span>
              </div>
            ) : localShares.roots.map((root) => (
              <div className={`share-root-row ${root.enabled ? "" : "is-disabled"}`} key={root.id}>
                <label className="share-root-toggle">
                  <input
                    type="checkbox"
                    checked={root.enabled}
                    onChange={(event) => void onSetShareEnabled(root.id, event.target.checked)}
                    aria-label={`Share ${root.alias}`}
                  />
                  <span className="toggle-visual" aria-hidden="true"><i /></span>
                </label>
                <span className="share-root-name">
                  <strong>{root.alias}</strong>
                  <small title={root.path}>{root.path}</small>
                  {root.error ? <em>{root.error}</em> : null}
                </span>
                <span className="share-root-counts">
                  <strong>{root.fileCount.toLocaleString()} files</strong>
                  <small>{root.directoryCount.toLocaleString()} folders · {formatBytes(root.totalSizeBytes)}</small>
                </span>
                <button type="button" onClick={() => void onRemoveShare(root.id)} aria-label={`Remove ${root.alias}`}>
                  <Trash size={15} />
                </button>
              </div>
            ))}
          </div>

          {sharingError ? <p className="connection-error" role="alert">{sharingError}</p> : null}

          <div className="sharing-actions">
            <button type="button" className="primary-action" onClick={() => void addSharedFolder()}>
              <FolderPlus size={16} /> Add folder
            </button>
            <button type="button" className="secondary-text-button" disabled={localShares.scanning} onClick={() => void onRescanShares()}>
              <ArrowsClockwise size={15} className={localShares.scanning ? "is-spinning" : ""} />
              {localShares.scanning ? "Scanning…" : "Rescan"}
            </button>
            <label className="upload-slots-field">
              <span>Upload slots</span>
              <select value={localShares.uploadSlots} onChange={(event) => void onSetUploadSlots(Number(event.target.value))}>
                <option value={1}>1 slot</option>
                <option value={2}>2 slots</option>
                <option value={3}>3 slots</option>
              </select>
            </label>
            <small className="sharing-scan-time">
              {localShares.lastScanAtMs ? `Last indexed ${formatTime(localShares.lastScanAtMs)}` : "Not indexed yet"}
            </small>
          </div>
        </section>

        <div className="settings-lower-grid">
          <section className="settings-panel diagnostics-panel">
            <div className="settings-panel-heading">
              <div className="settings-icon">
                <ArrowsClockwise size={18} weight="light" />
              </div>
              <div>
                <h2>Recent activity</h2>
                <p>Connection events only—never passwords.</p>
              </div>
            </div>
            <div className="diagnostic-list">
              {diagnostics.slice(-4).reverse().map((entry) => (
                <div className="diagnostic-row" key={`${entry.timestampMs}-${entry.event}`}>
                  <i className={`is-${entry.level}`} aria-hidden="true" />
                  <span>
                    <strong>{entry.message}</strong>
                    <small>
                      {formatTime(entry.timestampMs)} · {entry.event.replace(/_/g, " ")}
                    </small>
                  </span>
                </div>
              ))}
              {diagnostics.length === 0 && (
                <p className="empty-diagnostics">No connection activity yet.</p>
              )}
            </div>
            <p className="diagnostics-path" title={diagnosticsPath}>
              {diagnosticsPath}
            </p>
          </section>

          <section className="settings-panel maintenance-panel">
            <div className="update-preferences">
              <h2>Forever 0.0.38</h2>
              <p>Updates install from signed GitHub Releases.</p>
              <label className="update-interval-field">
                <span>Automatic update checks</span>
                <select
                  value={updateCheckIntervalMinutes}
                  onChange={(event) =>
                    onUpdateCheckIntervalChange(
                      Number(event.target.value) as UpdateCheckIntervalMinutes,
                    )
                  }
                >
                  <option value={1}>Every minute</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every hour</option>
                  <option value={0}>Only at startup</option>
                </select>
                <small>
                  Default: every 5 minutes while Forever is running.
                </small>
              </label>
              <label className="toggle-row message-notification-preference">
                <input
                  type="checkbox"
                  checked={messageNotificationsEnabled}
                  onChange={(event) =>
                    onMessageNotificationsChange(event.target.checked)
                  }
                />
                <span className="toggle-visual" aria-hidden="true">
                  <i />
                </span>
                <span>
                  <strong><BellRinging size={13} /> Private-message alerts</strong>
                  <small>Show a Windows notification when a new message arrives.</small>
                </span>
              </label>
              <label className="toggle-row message-notification-preference">
                <input
                  type="checkbox"
                  checked={roomNotificationsEnabled}
                  onChange={(event) =>
                    onRoomNotificationsChange(event.target.checked)
                  }
                />
                <span className="toggle-visual" aria-hidden="true">
                  <i />
                </span>
                <span>
                  <strong><BellRinging size={13} /> Room alerts</strong>
                  <small>Notify for mentions and new messages in starred rooms.</small>
                </span>
              </label>
              <button
                type="button"
                className="secondary-text-button"
                onClick={onCheckForUpdates}
              >
                Check for updates
              </button>
            </div>
            <div className="danger-zone">
              <h3>Remove this account</h3>
              <p>Deletes local settings and the stored credential.</p>
              <button
                type="button"
                className={confirmReset ? "danger-action is-confirming" : "danger-action"}
                onClick={() => {
                  if (!confirmReset) {
                    setConfirmReset(true);
                    return;
                  }
                  void onReset();
                }}
              >
                <Trash size={15} />
                {confirmReset ? "Click again to remove" : "Remove account"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
