import { useState, type FormEvent } from "react";
import { ArrowsDownUp } from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { bandwidthSummary, defaultBandwidth, useBandwidthStatus, validateBandwidth, type BandwidthSettings as Policy } from "../bandwidth";
import { patchSettings, useSettings } from "../settings";

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };

export function BandwidthSettings() {
  const { settings } = useSettings();
  const policy = settings.transfers.bandwidth ?? defaultBandwidth();
  const { snapshot, error } = useBandwidthStatus();
  return <section className="settings-panel bandwidth-panel" aria-labelledby="bandwidth-heading">
    <div className="settings-panel-heading"><div className="settings-icon"><ArrowsDownUp size={19} weight="light" /></div><div><h2 id="bandwidth-heading">Bandwidth limits and scheduling</h2><p>Leave room for the rest of your connection.</p></div></div>
    <p className="bandwidth-status" role="status">{!isTauri() ? "Browser preview · transfer controls are simulated" : snapshot ? bandwidthSummary(snapshot) : "Reading bandwidth status…"}</p>
    {snapshot && <p>Network cost: {snapshot.networkCost}. Checked every five seconds.</p>}
    {error && <p role="alert" className="connection-error">{error}</p>}
    <BandwidthForm key={JSON.stringify(policy)} policy={policy} onSave={(bandwidth) => patchSettings({ bandwidth })} />
  </section>;
}

export function BandwidthForm({ policy, onSave }: { policy: Policy; onSave: (policy: Policy) => Promise<unknown> }) {
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  const validation = validateBandwidth(draft);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (validation) { setError(validation); return; }
    setSaving(true); setError(null);
    try { await onSave(draft); }
    catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  }
  return <form className="bandwidth-form" aria-label="Bandwidth policy" onSubmit={(event) => void save(event)}>
    <p>All transfers share these caps. 0 means unlimited; 1 KiB/s = 1,024 bytes per second. The combined cap covers uploads and downloads together.</p>
    <fieldset disabled={saving}>
      <legend className="sr-only">Bandwidth controls</legend>
      <div className="bandwidth-profiles">
        {(["normal", "alternate"] as const).map((profile) => <fieldset key={profile}>
          <legend>{profile === "normal" ? "Normal limits" : "Alternate limits"}</legend>
          {([ ["totalKib", "Combined"], ["downloadKib", "Download"], ["uploadKib", "Upload"] ] as const).map(([key, label]) => <label key={key}>{label} <span>KiB/s</span>
            <input aria-label={`${profile === "normal" ? "Normal" : "Alternate"} ${label.toLowerCase()} limit`} type="number" min={0} max={1_000_000} step={1} required value={Number.isNaN(draft[profile][key]) ? "" : draft[profile][key]}
              onChange={(event) => setDraft({ ...draft, [profile]: { ...draft[profile], [key]: event.target.value === "" ? NaN : Number(event.target.value) } })} />
          </label>)}
        </fieldset>)}
      </div>
      <label className="bandwidth-toggle"><input type="checkbox" checked={draft.scheduleEnabled} onChange={(event) => setDraft({ ...draft, scheduleEnabled: event.target.checked })} />Use alternate limits on a daily schedule</label>
      <div className="bandwidth-times">
        <label>Start time<input aria-label="Alternate start time" type="time" required disabled={!draft.scheduleEnabled} value={Number.isNaN(draft.startMinute) ? "" : clock(draft.startMinute)} onChange={(event) => setDraft({ ...draft, startMinute: minute(event.target.value) })} /></label>
        <label>End time<input aria-label="Alternate end time" type="time" required disabled={!draft.scheduleEnabled} value={Number.isNaN(draft.endMinute) ? "" : clock(draft.endMinute)} onChange={(event) => setDraft({ ...draft, endMinute: minute(event.target.value) })} /></label>
      </div>
      <p>Uses your computer’s local time every day, including across midnight. Normal limits apply outside this window. Changes apply while Forever is open.</p>
      <label className="bandwidth-toggle"><input type="checkbox" checked={draft.pauseOnMetered} onChange={(event) => setDraft({ ...draft, pauseOnMetered: event.target.checked })} />Pause file transfers on metered networks</label>
      <p>Uses Windows’ internet connection cost. Unknown cost also holds transfers until the network is unmetered or this option is turned off. Search, chat, metadata, and bytes already buffered by the network can still use data.</p>
      {validation && dirty && <p role="alert" className="connection-error">{validation}</p>}
      <button className="primary-action" type="submit" disabled={!dirty || saving || !!validation}>{saving ? "Saving…" : "Save bandwidth settings"}</button>
    </fieldset>
    {error && <p role="alert" className="connection-error">{error}</p>}
  </form>;
}
