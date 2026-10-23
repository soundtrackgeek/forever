import { useState, type FormEvent } from "react";
import type { UploadPolicy } from "../types";

export function UploadPolicySettings({ policy, onSave }: {
  policy: UploadPolicy;
  onSave: (policy: UploadPolicy) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="upload-policy" onSubmit={(event) => void save(event)} aria-label="Upload fairness and policy">
      <h3>Upload fairness</h3>
      <p>Users take turns. Everyone waiting gets one active slot before anyone gets a second. Queued requests survive restarts.</p>
      <fieldset disabled={saving}>
        <legend className="sr-only">Upload policy</legend>
        <div className="upload-policy-limits">
          <label>Files per user
            <input type="number" min={1} max={500} step={1} required value={draft.maxFilesPerUser || ""}
              onChange={(event) => setDraft({ ...draft, maxFilesPerUser: Number(event.target.value) })} />
          </label>
          <label>MB per user
            <input type="number" min={1} max={1_000_000} step={1} required value={draft.maxMegabytesPerUser || ""}
              onChange={(event) => setDraft({ ...draft, maxMegabytesPerUser: Number(event.target.value) })} />
          </label>
        </div>
        <p>Limits count queued and active files at their full size. 1 MB = 1,000,000 bytes. Lower limits apply to new requests; accepted requests stay queued.</p>
        <label className="upload-policy-toggle">
          <input type="checkbox" checked={draft.prioritizeFavorites}
            onChange={(event) => setDraft({ ...draft, prioritizeFavorites: event.target.checked })} />
          Favorites first within each turn
        </label>
        <label className="upload-policy-toggle">
          <input type="checkbox" checked={draft.prioritizePrivileged}
            onChange={(event) => setDraft({ ...draft, prioritizePrivileged: event.target.checked })} />
          Privileged users first within each turn
        </label>
        <p>Favorites take precedence when both are enabled. Priority never interrupts an active upload or skips another user's turn.</p>
        <button className="primary-action" type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save upload policy"}</button>
      </fieldset>
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </form>
  );
}
