import { useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { DownloadSimple } from "@phosphor-icons/react";

export function DiagnosticsExport() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const native = isTauri();

  const exportDiagnostics = async () => {
    if (!native || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage(""); setError("");
    try {
      const path = await save({
        title: "Export Forever diagnostics",
        defaultPath: `forever-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: "Diagnostics ZIP", extensions: ["zip"] }],
      });
      if (!path) return;
      await invoke("diagnostics_export", { path });
      setMessage("Diagnostics saved. Nothing was uploaded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <div className="diagnostics-export">
    <p>Save event logs, app details, a settings summary, and the latest panic report for a bug report. Credentials, IP addresses, usernames, folder paths, and free-form messages are excluded.</p>
    <button type="button" className="secondary-text-button" disabled={!native || busy} onClick={() => void exportDiagnostics()}>
      <DownloadSimple size={16} /> {busy ? "Exporting diagnostics…" : "Export diagnostics"}
    </button>
    {!native && <p>Diagnostics export is available in the desktop app.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="connection-error" role="alert">{error}</p>}
  </div>;
}
