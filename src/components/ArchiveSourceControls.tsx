import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { FolderOpen, ArrowCounterClockwise } from "@phosphor-icons/react";
import type { ArchiveStatus } from "../types";

type Props = {
  status: ArchiveStatus | null;
  loading: boolean;
  onSelectDatabase: (path: string | null) => Promise<ArchiveStatus>;
};

export function ArchiveSourceControls({ status, loading, onSelectDatabase }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = async (automatic: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (!isTauri()) throw new Error("Choose an Archive database in the desktop app.");
      const path = automatic ? null : await open({
        title: "Choose Music Library database",
        directory: false,
        multiple: false,
        filters: [{ name: "SQLite database", extensions: ["sqlite3", "sqlite", "db"] }],
      });
      if (!automatic && typeof path !== "string") return;
      await onSelectDatabase(typeof path === "string" ? path : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="archive-source-controls">
      <span className="archive-path-source">{status?.pathSource === "custom" ? "Custom database" : status?.connected ? "Detected automatically" : "Automatic location"}</span>
      <button type="button" disabled={busy || loading} onClick={() => void select(false)}><FolderOpen size={15} /> Choose database…</button>
      <button type="button" disabled={busy || loading || status?.pathSource !== "custom"} onClick={() => void select(true)}><ArrowCounterClockwise size={15} /> Use automatic location</button>
      {status?.settingsNotice ? <p role="status">{status.settingsNotice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
