import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight,
  CaretDown,
  Check,
  FolderOpen,
  LockKey,
  Radio,
  ShieldCheck,
  UserPlus,
  Waveform,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ConnectionProfile,
  ConnectionSnapshot,
} from "../types";

type ConnectionOnboardingProps = {
  profile: ConnectionProfile;
  hasPassword: boolean;
  snapshot: ConnectionSnapshot;
  error: string | null;
  onSave: (profile: ConnectionProfile, password?: string) => Promise<unknown>;
  onConnect: () => Promise<unknown>;
  onComplete: () => void;
  onExploreOffline: () => void;
};

export function ConnectionOnboarding({
  profile,
  hasPassword,
  snapshot,
  error,
  onSave,
  onConnect,
  onComplete,
  onExploreOffline,
}: ConnectionOnboardingProps) {
  const [draft, setDraft] = useState(profile);
  const [password, setPassword] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const connecting = ["connecting", "authenticating", "reconnecting"].includes(
    snapshot.state,
  );

  useEffect(() => {
    if (snapshot.state === "online" && submitting) {
      const timer = window.setTimeout(onComplete, 420);
      return () => window.clearTimeout(timer);
    }
  }, [onComplete, snapshot.state, submitting]);

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await onSave(draft, password || undefined);
      await onConnect();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  };

  return (
    <div className="connection-overlay" role="dialog" aria-modal="true">
      <div className="connection-card onboarding-card">
        <section className="onboarding-art">
          <div className="onboarding-brand">
            <span>FOREVER</span>
            <small>Midnight Radio</small>
          </div>
          <img
            src="/assets/night-geometry-cover.png"
            alt="A violet moon behind a dark geometric monolith"
          />
          <div className="signal-rings" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="onboarding-art-copy">
            <Waveform size={20} weight="light" />
            <p>Rare recordings. Real people. One quiet place to find them.</p>
          </div>
        </section>

        <form className="onboarding-form" onSubmit={submit}>
          <div className="form-heading">
            <span className="eyebrow">First connection</span>
            <h1>Tune into Soulseek</h1>
            <p>
              These are Soulseek credentials, not a separate Forever account.
              Soulseek automatically creates any valid unused username.
            </p>
          </div>

          <div className="connection-field-grid">
            <label className="connection-field">
              <span>Username</span>
              <input
                required
                autoFocus
                autoComplete="username"
                maxLength={30}
                value={draft.username}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder="Your Soulseek name"
              />
            </label>

            <label className="connection-field">
              <span>Password</span>
              <span className="input-with-icon">
                <LockKey size={15} weight="light" />
                <input
                  required={!hasPassword}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={hasPassword ? "Stored securely" : "Enter a password"}
                />
              </span>
            </label>

            <label className="connection-field connection-folder-field">
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
                  <FolderOpen size={16} />
                  Browse
                </button>
              </span>
            </label>
          </div>

          <div className="account-behavior-note">
            <UserPlus size={16} weight="light" />
            <span>
              <strong>Why almost any login works</strong>
              <small>
                An unused name becomes a new account with the password you
                enter. Only an existing username can reject an incorrect
                password.
              </small>
            </span>
          </div>

          <div className="connection-toggles">
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
                <strong>Remember on this device</strong>
                <small>Protected by Windows Credential Manager.</small>
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
                <strong>Connect when Forever opens</strong>
                <small>Start listening without another click.</small>
              </span>
            </label>
          </div>

          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((openState) => !openState)}
          >
            <CaretDown size={13} className={advancedOpen ? "is-open" : ""} />
            Advanced server settings
          </button>

          {advancedOpen && (
            <div className="advanced-fields">
              <label className="connection-field">
                <span>Server</span>
                <input
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
            </div>
          )}

          {(localError || error || snapshot.state === "error") && (
            <p className="connection-error" role="alert">
              {localError || error || snapshot.message}
            </p>
          )}

          <div className="onboarding-actions">
            <button
              type="button"
              className="quiet-action"
              onClick={onExploreOffline}
              disabled={submitting}
            >
              Explore offline
            </button>
            <button
              type="submit"
              className="primary-action connect-action"
              disabled={submitting || !draft.username || !draft.downloadDirectory}
            >
              {snapshot.state === "online" && submitting ? (
                <>
                  <Check size={17} weight="bold" /> Connected
                </>
              ) : connecting ? (
                <>
                  <Radio className="is-pulsing" size={17} /> {snapshot.message}
                </>
              ) : (
                <>
                  Connect to Soulseek <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>

          <p className="credential-note">
            <ShieldCheck size={14} weight="fill" />
            Your password is never written to Forever’s settings or diagnostic
            log.
          </p>
        </form>
      </div>
    </div>
  );
}
