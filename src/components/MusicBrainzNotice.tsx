import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type ClientStatus = {
  revision: number;
  retryAtMs: number | null;
  cacheWarning: string | null;
};

export function MusicBrainzNotice() {
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [now, setNow] = useState(Date.now);
  const [dismissedWarning, setDismissedWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const apply = (next: ClientStatus) => {
      if (!mounted || !next || typeof next.revision !== "number") return;
      setStatus((current) => !current || next.revision >= current.revision ? next : current);
      setNow(Date.now());
    };
    void (async () => {
      try {
        // Subscribe before fetching the snapshot; revisions reject late snapshots.
        const dispose = await listen<ClientStatus>("forever://musicbrainz-status", (event) => apply(event.payload));
        if (!mounted) { dispose(); return; }
        unlisten = dispose;
        apply(await invoke<ClientStatus>("musicbrainz_status"));
      } catch {
        // Metadata requests still surface their own errors if status IPC fails.
      }
    })();
    return () => { mounted = false; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!status?.retryAtMs) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= status.retryAtMs!) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [status?.retryAtMs]);

  const seconds = Math.max(0, Math.ceil(((status?.retryAtMs ?? 0) - now) / 1000));
  const warning = status?.cacheWarning && status.cacheWarning !== dismissedWarning ? status.cacheWarning : null;
  if (!seconds && !warning) return null;

  return (
    <aside className="musicbrainz-notice" role="status" aria-label="MusicBrainz status">
      {seconds > 0 && <p>MusicBrainz is busy or rate-limiting. Waiting {seconds} s before more requests.</p>}
      {warning && <div><p>{warning}</p><button type="button" onClick={() => setDismissedWarning(warning)}>Dismiss cache notice</button></div>}
    </aside>
  );
}
