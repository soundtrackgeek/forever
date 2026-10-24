import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Desktop } from "@phosphor-icons/react";
import { patchSettings, useSettings } from "../settings";

type Status = { trayAvailable: boolean; autostartEnabled: boolean };

export function DesktopSettings() {
  const native = isTauri();
  const { settings } = useSettings();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const refresh = () => { void invoke<Status>("desktop_status").then((next) => { if (!disposed) setStatus(next); }).catch((cause) => { if (!disposed) setError(String(cause)); }); };
    refresh(); window.addEventListener("focus", refresh);
    return () => { disposed = true; window.removeEventListener("focus", refresh); };
  }, [native]);
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="settings-panel desktop-panel" aria-labelledby="desktop-heading">
    <div className="settings-panel-heading"><div className="settings-icon"><Desktop size={19} /></div><div><h2 id="desktop-heading">Desktop & background</h2><p>Keep your searches, sharing, and downloads running while the window is closed.</p></div></div>
    {!native && <p role="status">Browser preview · tray and sign-in controls require the desktop app.</p>}
    {status && !status.trayAvailable && <p role="status">The tray is unavailable. Closing the window will use Safe Passage to exit.</p>}
    <fieldset className="desktop-controls" disabled={busy}>
      <legend className="sr-only">Desktop preferences</legend>
      <label className="bandwidth-toggle"><input type="checkbox" checked={settings.desktop.closeToTray} onChange={(e) => void change(() => patchSettings({ closeToTray: e.target.checked }))} />Keep Forever running in the tray when I close the window</label>
      <label className="bandwidth-toggle"><input type="checkbox" checked={status?.autostartEnabled ?? false} disabled={!native || !status} onChange={(e) => void change(async () => setStatus(await invoke<Status>("desktop_set_autostart", { enabled: e.target.checked })))} />Start Forever when I sign in</label>
      <label className="bandwidth-toggle"><input type="checkbox" checked={settings.desktop.startInTray} onChange={(e) => void change(() => patchSettings({ startInTray: e.target.checked }))} />Start in the tray at sign-in</label>
    </fieldset>
    <p>Open Forever from its tray icon or launch it again. The tray shows connection and transfer status, with Pause all transfers, Resume, and Quit.</p>
    <p>Sign-in startup is off until you enable it on this computer. Enable automatic connection in your Soulseek account settings to connect at startup. Quit uses Safe Passage to save partial downloads.</p>
    <button type="button" className="modal-secondary" disabled={!native || busy} onClick={() => void change(() => invoke("desktop_request_quit"))}>Quit Forever…</button>
    {error && <p role="alert" className="connection-error">{error}</p>}
  </section>;
}
