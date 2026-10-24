import { useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getSettingsState, importSettings, resetSettingsSection, validateSettingsImport, type Settings, type SettingsSection } from "../settings";

const sections: { id: SettingsSection; label: string; detail: string }[] = [
  { id: "desktop", label: "Desktop & background", detail: "Restore close-to-tray and background sign-in preferences. Operating system autostart registration is unchanged." },
  { id: "preferences", label: "Notifications, updates & discovery", detail: "Restore notification toggles, update cadence, and the MusicBrainz fallback count." },
  { id: "transfers", label: "Downloads & Soundcheck", detail: "Restore three download lanes, a ten-minute relay delay, and Soundcheck. Transfer history is kept." },
  { id: "sharing", label: "Sharing & uploads", detail: "Remove shared folders from Forever and restore upload defaults. Files and upload history are kept." },
  { id: "wanted", label: "Wanted defaults", detail: "Restore the Wanted interval and default matching profile. Existing albums and their individual profiles are kept." },
  { id: "searches", label: "Dial Memory", detail: "Clear pinned presets and recent searches. Open searches remain available until closed." },
  { id: "archive", label: "Archive source", detail: "Use the automatically detected Music Library database. No database contents are changed." },
  { id: "connection", label: "Soulseek account & network", detail: "Disconnect, forget this account and its saved password, and return to account setup." },
];

export function SettingsPortability({ onApplied }: { onApplied?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ json: string; settings: Settings } | null>(null);
  const [section, setSection] = useState<SettingsSection>("preferences");
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const exportFile = () => run(async () => {
    if (isTauri()) {
      const path = await save({ defaultPath: "forever-settings.json", filters: [{ name: "Forever settings", extensions: ["json"] }] });
      if (!path) return;
      await invoke("settings_export", { path });
    } else {
      const url = URL.createObjectURL(new Blob([JSON.stringify(getSettingsState().settings, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "forever-settings.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setMessage("Settings exported. Passwords and activity history are excluded.");
  });
  return <section className="settings-panel settings-portability" aria-labelledby="settings-backup-title">
    <div className="settings-panel-heading"><div><h2 id="settings-backup-title">Backup & restore settings</h2>
      <p>Keep your preferences and pinned searches together, or move them to another PC.</p></div></div>
    <p>Exports include your username, folder paths, shared folders, and search presets. Passwords stay in the operating system. Message drafts and scroll positions stay on this PC.</p>
    <div className="settings-backup-actions">
      <button type="button" className="secondary-text-button" disabled={busy} onClick={() => void exportFile()}>Export settings</button>
      <button type="button" className="secondary-text-button" disabled={busy} onClick={() => { setPending(null); input.current?.click(); }}>Import settings</button>
      <input ref={input} type="file" accept=".json,application/json" aria-label="Settings file to import" hidden onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        setPending(null); setConfirmReset(false);
        void run(async () => {
          if (file.size > 256 * 1024) throw new Error("Settings files must be smaller than 256 KiB.");
          const json = await file.text(); const imported = await validateSettingsImport(json);
          setPending({ json, settings: imported });
        });
      }} />
    </div>
    {pending && <div className="settings-import-review" role="region" aria-label="Review settings import">
      <h3>Review settings import</h3>
      <p>This replaces all settings. Account or network changes disconnect the current session. Enter your password on the new PC before connecting.</p>
      <dl>
        <dt>Account</dt><dd>{pending.settings.connection?.username || "No account"}</dd>
        <dt>Download folder</dt><dd>{pending.settings.connection?.downloadDirectory || "Choose during setup"}</dd>
        <dt>Archive</dt><dd>{pending.settings.archiveDatabasePath || "Automatic detection"}</dd>
        <dt>Downloads</dt><dd>{pending.settings.transfers.maxConcurrentDownloads} lanes · Soundcheck {pending.settings.transfers.soundcheckEnabled ? "on" : "off"}</dd>
        <dt>Sharing</dt><dd>{pending.settings.sharing.roots.length ? pending.settings.sharing.roots.map((root) => <div key={root.id}>{root.path} — {root.enabled ? "shared when connected" : "disabled"}</div>) : "No shared folders"}</dd>
        <dt>Dial Memory</dt><dd>{pending.settings.dialMemory.pinned.length} pinned presets</dd>
      </dl>
      <p>Check that these folders belong on this PC. Missing folders remain visible for correction; files are never moved.</p>
      <div className="settings-backup-actions">
        <button type="button" className="primary-action" disabled={busy} onClick={() => void run(async () => {
          await importSettings(pending.json); setPending(null); setMessage("Settings imported. Pinned presets open on the next launch."); onApplied?.();
        })}>Apply imported settings</button>
        <button type="button" className="secondary-text-button" disabled={busy} onClick={() => setPending(null)}>Cancel import</button>
      </div>
    </div>}
    <div className="settings-section-reset">
      <label htmlFor="settings-reset-section">Reset section to defaults</label>
      <select id="settings-reset-section" value={section} disabled={busy} onChange={(event) => { setSection(event.target.value as SettingsSection); setConfirmReset(false); }}>
        {sections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <p>{sections.find((item) => item.id === section)?.detail}</p>
      {!confirmReset ? <button type="button" className="secondary-text-button" disabled={busy} onClick={() => { setConfirmReset(true); setPending(null); }}>Reset selected section</button> :
        <div className="settings-backup-actions">
          <button type="button" className="danger-button" disabled={busy} onClick={() => void run(async () => { await resetSettingsSection(section); setConfirmReset(false); setMessage("Section reset to defaults."); onApplied?.(); })}>Confirm section reset</button>
          <button type="button" className="secondary-text-button" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel reset</button>
        </div>}
    </div>
    {!isTauri() && <p className="settings-preview-note">Browser preview — changes last for this session. The desktop app stores settings on disk.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
