import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowsClockwise,
  Check,
  FolderOpen,
  LockKey,
  Plug,
  Plugs,
  ShieldCheck,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ConnectionProfile,
  ConnectionSnapshot,
  DiagnosticEntry,
} from "../types";

type ConnectionSettingsProps = {
  profile: ConnectionProfile;
  hasPassword: boolean;
  snapshot: ConnectionSnapshot;
  diagnostics: DiagnosticEntry[];
  diagnosticsPath: string;
  error: string | null;
  onSave: (profile: ConnectionProfile, password?: string) => Promise<unknown>;
  onConnect: () => Promise<unknown>;
  onDisconnect: () => Promise<unknown>;
  onReset: () => Promise<unknown>;
  onLoadDiagnostics: () => Promise<DiagnosticEntry[]>;
  onCheckForUpdates: () => void;
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
  diagnostics: initialDiagnostics,
  diagnosticsPath,
  error,
  onSave,
  onConnect,
  onDisconnect,
  onReset,
  onLoadDiagnostics,
  onCheckForUpdates,
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
  }, [onLoadDiagnostics, snapshot.updatedAtMs]);

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
        <div className={`connection-state-badge is-${snapshot.state}`}>
          <i aria-hidden="true" />
          <span>
            <strong>{statusLabels[snapshot.state]}</strong>
            <small>{snapshot.server || "Soulseek network"}</small>
          </span>
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
            <div>
              <h2>Forever 0.0.2</h2>
              <p>Updates install from signed GitHub Releases.</p>
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
