import {
  ArrowsClockwise,
  Broadcast,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  Gauge,
  WarningCircle,
  Waveform,
  Wrench,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { SearchSessionRecord } from "../hooks/useSoulseekSearch";
import type { PatchBayCandidate, PatchBayIssue } from "../utils/patchBay";
import { formatAlbumBytes } from "../utils/albumSources";

type PatchBayPanelProps = {
  title: string;
  online: boolean;
  record: SearchSessionRecord | null;
  issues: PatchBayIssue[];
  officialTrackCount: number | null;
  busyIssueId: string | null;
  onSearch: () => Promise<unknown>;
  onPatch: (issue: PatchBayIssue, candidate: PatchBayCandidate, allowIncompatible: boolean) => Promise<unknown>;
};

const issueStateCopy = {
  ready: { label: "Ready for a replacement", icon: Wrench },
  queued: { label: "Replacement queued", icon: Gauge },
  downloading: { label: "Downloading replacement", icon: DownloadSimple },
  rechecking: { label: "Running Deep Soundcheck", icon: Waveform },
  repaired: { label: "Repaired and checked", icon: CheckCircle },
  attention: { label: "Replacement still needs attention", icon: WarningCircle },
} as const;

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return null;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

const candidateKey = (issue: PatchBayIssue, candidate: PatchBayCandidate) =>
  `${issue.id}:${candidate.result.id}`;

export function PatchBayPanel({
  title,
  online,
  record,
  issues,
  officialTrackCount,
  busyIssueId,
  onSearch,
  onPatch,
}: PatchBayPanelProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const searching = record?.snapshot.state === "searching";
  const completed = record?.snapshot.state === "completed";
  const actionable = issues.filter((issue) => issue.state === "ready" || issue.state === "attention");
  const candidateCount = actionable.reduce((total, issue) => total + issue.candidates.length, 0);

  return (
    <section className="patch-bay" aria-label={`Patch Bay for ${title}`}>
      <header>
        <span className="patch-bay-mark"><Wrench size={19} weight="light" /></span>
        <span>
          <small>PATCH BAY</small>
          <strong>{issues.some((issue) => issue.state === "repaired") && actionable.length === 0 ? "The signal is whole again." : "Repair only what went quiet."}</strong>
          <p>Verified tracks stay untouched. Every replacement is persisted and checked deeply before filing.{officialTrackCount ? ` MusicBrainz’s ${officialTrackCount}-track official sequence is loaded.` : ""}</p>
        </span>
        <button type="button" disabled={!online || searching} onClick={() => void onSearch()}>
          {searching ? <CircleNotch className="search-spinner" size={14} /> : record ? <ArrowsClockwise size={14} /> : <Broadcast size={14} />}
          {searching ? "Listening…" : record ? "Rescan" : "Find replacements"}
        </button>
      </header>

      {!online ? <p className="patch-bay-note is-warning"><WarningCircle size={14} /> Reconnect before asking the network for replacement tracks.</p> : null}
      {searching && candidateCount === 0 ? <div className="patch-bay-listening"><i /><i /><i /><span>Comparing track numbers, titles, formats, duration, and audio details…</span></div> : null}

      <div className="patch-bay-issues">
        {issues.map((issue) => {
          const copy = issueStateCopy[issue.state];
          const StateIcon = copy.icon;
          const busy = busyIssueId === issue.id;
          const settled = ["queued", "downloading", "rechecking", "repaired"].includes(issue.state);
          return (
            <article className={`patch-bay-issue is-${issue.state}`} key={issue.id}>
              <div className="patch-bay-issue-head">
                <span className="patch-bay-track-number">{issue.trackNumber ? String(issue.trackNumber).padStart(2, "0") : "—"}</span>
                <span><strong>{issue.title}</strong><small>{issue.reason}</small></span>
                <span className="patch-bay-state"><StateIcon className={issue.state === "downloading" || issue.state === "rechecking" ? "is-pulsing" : ""} size={15} weight={issue.state === "repaired" ? "fill" : "regular"} />{copy.label}</span>
              </div>

              {settled ? (
                <div className="patch-bay-progress">
                  <span><i /></span>
                  <small>{issue.state === "queued" ? "The repair will respect your queue and one-file-per-user rule." : issue.state === "downloading" ? "The replacement is moving through the transfer queue now." : issue.state === "rechecking" ? "The file arrived; Forever is validating every readable frame." : "Deep Soundcheck accepted this replacement. The original rejected file remains preserved."}</small>
                </div>
              ) : issue.candidates.length ? (
                <div className="patch-bay-candidates">
                  {issue.candidates.map((candidate) => {
                    const key = candidateKey(issue, candidate);
                    const review = confirming === key;
                    const risky = candidate.warnings.length > 0;
                    return (
                      <div className={`patch-bay-candidate is-${candidate.confidence}${review ? " is-reviewing" : ""}`} key={key}>
                        <span><strong>{candidate.result.owner}</strong><small>{candidate.result.slotFree ? "Free upload slot" : candidate.result.queueLength ? `${candidate.result.queueLength} queued` : "Source queue unknown"}</small></span>
                        <span><strong>{candidate.result.filename?.split(/[\\/]/).pop()}</strong><small>{candidate.result.folder?.replace(/[\\/]/g, " / ")}</small></span>
                        <span className="patch-bay-candidate-signal">
                          <strong>{candidate.result.format.toUpperCase()} · {formatAlbumBytes(candidate.result.sizeBytes ?? 0)}</strong>
                          <small>{[candidate.result.bitrate ? `${candidate.result.bitrate} kbps` : null, formatDuration(candidate.result.durationSeconds), candidate.result.sampleRate ? `${(candidate.result.sampleRate / 1000).toFixed(1)} kHz` : null].filter(Boolean).join(" · ") || "Audio details unavailable"}</small>
                        </span>
                        <span className={`patch-bay-confidence is-${candidate.confidence}`}><i />{candidate.confidence}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (risky && !review) {
                              setConfirming(key);
                              return;
                            }
                            setConfirming(null);
                            void onPatch(issue, candidate, risky);
                          }}
                        >
                          {busy ? <><CircleNotch className="search-spinner" size={13} /> Patching…</> : review ? <><WarningCircle size={13} /> Use anyway</> : <><DownloadSimple size={13} /> Use track</>}
                        </button>
                        {review ? <div className="patch-bay-warnings"><strong>Compatibility check</strong>{candidate.warnings.map((warning) => <span key={warning}><WarningCircle size={12} />{warning}</span>)}<small>This only replaces the selected track; no other file will be changed.</small></div> : null}
                      </div>
                    );
                  })}
                </div>
              ) : completed ? (
                <p className="patch-bay-note"><Broadcast size={14} /> No safe track-level candidate answered this scan. Try again later or use Signal Relay from Transfers for a complete-folder route.</p>
              ) : (
                <p className="patch-bay-note"><Broadcast size={14} /> Start a scan to compare live replacement tracks.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
