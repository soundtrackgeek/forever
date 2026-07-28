import {
  Archive,
  ArrowSquareOut,
  ArrowsClockwise,
  CheckCircle,
  FolderOpen,
  LockKey,
  MagnifyingGlass,
  Record,
  ShieldCheck,
  Trash,
  Waveform,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { buildArrivals, type Arrival, type ArrivalState } from "../utils/arrivals";
import { formatAlbumBytes } from "../utils/albumSources";
import type { TransferGroup } from "../utils/transfers";

type ArrivalDeskProps = {
  groups: TransferGroup[];
  archiveOwnedReleaseIds: ReadonlySet<string>;
  refreshing: boolean;
  onRefreshArchive: () => Promise<unknown>;
  onRevealRelease: (releaseId: string) => Promise<unknown>;
  onVerifyRelease: (releaseId: string) => Promise<unknown>;
  onSoundcheckRelease: (releaseId: string, deep: boolean) => Promise<unknown>;
  onFindAlternatives: (releaseId: string, title: string) => Promise<unknown>;
  soundcheckEnabled: boolean;
  onSetReleaseFiled: (releaseId: string, filed: boolean) => Promise<unknown>;
  onClearReleaseHistory: (releaseIds: string[]) => Promise<unknown>;
  onOpenTransfer: (groupId: string) => void;
};

type ArrivalFilter = "all" | ArrivalState;

const states: ArrivalFilter[] = ["all", "ready", "filed", "moved", "attention"];

const stateCopy: Record<ArrivalState, { label: string; detail: string }> = {
  ready: { label: "Ready to file", detail: "Verified in Forever’s download folder" },
  filed: { label: "Filed away", detail: "Recognized by your library or confirmed manually" },
  moved: { label: "Moved outside Forever", detail: "Audio left the download folder" },
  attention: { label: "Needs attention", detail: "A partial move or verification issue needs review" },
};

const parseRelease = (title: string) => {
  const match = /^(.*?)\s+-\s+(.+?)(?:\s+\((\d{4})\))?$/.exec(title.trim());
  return match
    ? { artist: match[1].trim(), album: match[2].trim(), year: match[3] ?? null }
    : { artist: "Soulseek arrival", album: title, year: null };
};

const relativeTime = (timestamp: number) => {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const stateCount = (arrivals: Arrival[], state: ArrivalState) =>
  arrivals.filter((arrival) => arrival.state === state).length;

const soundcheckCopy = {
  pending: { label: "Awaiting Soundcheck", detail: "Run a quick scan to inspect the audio" },
  passed: { label: "Soundcheck passed", detail: "Headers, duration, and sequence look right" },
  review: { label: "Review suggested", detail: "Audio is readable, with notes worth checking" },
  failed: { label: "Soundcheck failed", detail: "One or more audio files need attention" },
} as const;

const formatDuration = (seconds: number | null) => {
  if (!seconds) return "duration unknown";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

export function ArrivalDesk({
  groups,
  archiveOwnedReleaseIds,
  refreshing,
  onRefreshArchive,
  onRevealRelease,
  onVerifyRelease,
  onSoundcheckRelease,
  onFindAlternatives,
  soundcheckEnabled,
  onSetReleaseFiled,
  onClearReleaseHistory,
  onOpenTransfer,
}: ArrivalDeskProps) {
  const [filter, setFilter] = useState<ArrivalFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const arrivals = useMemo(
    () => buildArrivals(groups, archiveOwnedReleaseIds),
    [archiveOwnedReleaseIds, groups],
  );
  const visible = useMemo(
    () => filter === "all" ? arrivals : arrivals.filter((arrival) => arrival.state === filter),
    [arrivals, filter],
  );
  const filedIds = useMemo(
    () => arrivals
      .filter((arrival) => arrival.state === "filed")
      .map((arrival) => arrival.group.releaseId)
      .filter((releaseId): releaseId is string => Boolean(releaseId)),
    [arrivals],
  );

  const perform = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="arrival-desk">
      <section className="arrival-hero">
        <div className="arrival-hero-mark"><FolderOpen size={28} weight="thin" /></div>
        <div>
          <small>ARRIVAL DESK</small>
          <h2>Downloads, on their way home.</h2>
          <p>Finish the journey from Soulseek to your real collection. Forever observes Music Library in read-only mode and never moves or imports a file.</p>
        </div>
        <div className="arrival-hero-actions">
          <span><LockKey size={13} /> Music Library · read-only</span>
          <span className={soundcheckEnabled ? "is-soundcheck-live" : ""}><Waveform size={13} /> Soundcheck · {soundcheckEnabled ? "automatic" : "manual"}</span>
          <button type="button" disabled={refreshing} onClick={() => void perform("refresh", onRefreshArchive)}>
            <ArrowsClockwise className={refreshing ? "is-spinning" : ""} size={15} />
            {refreshing ? "Reconciling…" : "Reconcile now"}
          </button>
        </div>
      </section>

      <section className="arrival-summary" aria-label="Arrival Desk status">
        <article className="is-ready"><span><FolderOpen size={18} /></span><div><small>Ready to file</small><strong>{stateCount(arrivals, "ready")}</strong><p>verified downloads</p></div></article>
        <article className="is-filed"><span><ShieldCheck size={18} weight="fill" /></span><div><small>Filed away</small><strong>{stateCount(arrivals, "filed")}</strong><p>recognized or confirmed</p></div></article>
        <article className="is-moved"><span><Archive size={18} /></span><div><small>Moved</small><strong>{stateCount(arrivals, "moved")}</strong><p>waiting for confirmation</p></div></article>
        <article className="is-attention"><span><WarningCircle size={18} weight="fill" /></span><div><small>Needs attention</small><strong>{stateCount(arrivals, "attention")}</strong><p>unexpected issues</p></div></article>
      </section>

      <div className="arrival-toolbar">
        <div role="tablist" aria-label="Filter arrivals">
          {states.map((state) => (
            <button key={state} type="button" role="tab" aria-selected={filter === state} className={filter === state ? "is-active" : ""} onClick={() => setFilter(state)}>
              {state === "all" ? "All arrivals" : stateCopy[state].label}
              <small>{state === "all" ? arrivals.length : stateCount(arrivals, state)}</small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="arrival-clear-filed"
          disabled={filedIds.length === 0 || Boolean(busy)}
          onClick={() => void perform("clear-filed", () => onClearReleaseHistory(filedIds))}
        >
          <Trash size={14} /> {busy === "clear-filed" ? "Clearing…" : `Clear filed history${filedIds.length ? ` (${filedIds.length})` : ""}`}
        </button>
      </div>

      <section className="arrival-list" aria-live="polite">
        {visible.length === 0 ? (
          <div className="arrival-empty">
            <Record size={34} weight="thin" />
            <strong>{arrivals.length ? "Nothing in this lane" : "The desk is clear"}</strong>
            <p>{arrivals.length ? "Choose another state above." : "Completed album downloads will settle here after verification."}</p>
          </div>
        ) : visible.map((arrival) => {
          const release = parseRelease(arrival.group.title);
          const releaseId = arrival.group.releaseId;
          const actionBusy = Boolean(busy && busy.startsWith(arrival.group.id));
          const copy = stateCopy[arrival.state];
          const signal = soundcheckCopy[arrival.soundcheck.state];
          return (
            <article className={`arrival-row is-${arrival.state}`} key={arrival.group.id}>
              <div className="arrival-row-art"><Record size={28} weight="thin" /><i /></div>
              <div className="arrival-row-identity">
                <small>{release.year ?? "YEAR UNKNOWN"} · {release.artist}</small>
                <strong>{release.album}</strong>
                <p>from {arrival.group.username} · completed {relativeTime(arrival.group.updatedAtMs)}</p>
              </div>
              <div className={`arrival-row-files is-${arrival.soundcheck.state}`}>
                <small>SOUND CHECK</small>
                <strong><Waveform size={13} /> {signal.label}</strong>
                <p>{arrival.soundcheck.checkedCount}/{arrival.audioCount} scanned · {formatAlbumBytes(arrival.group.sizeBytes)}</p>
              </div>
              <div className="arrival-row-state">
                <small>JOURNEY STATE</small>
                <strong>{arrival.state === "filed" ? <CheckCircle size={14} weight="fill" /> : arrival.state === "attention" ? <WarningCircle size={14} weight="fill" /> : <span aria-hidden="true" />}{copy.label}</strong>
                <p>{arrival.archiveOwned ? "Matched in Music Library" : arrival.manuallyFiled ? "Confirmed by you" : copy.detail}</p>
              </div>
              <div className="arrival-row-actions">
                {arrival.state === "ready" && releaseId ? (
                  <button type="button" className="is-primary" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-file`, () => onSetReleaseFiled(releaseId, true))}><Archive size={15} /> {actionBusy ? "Filing…" : "Mark as filed"}</button>
                ) : null}
                {arrival.state === "moved" && releaseId ? (
                  <button type="button" className="is-primary" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-confirm`, () => onSetReleaseFiled(releaseId, true))}><CheckCircle size={15} /> {actionBusy ? "Confirming…" : "Confirm filed"}</button>
                ) : null}
                {arrival.state === "filed" && arrival.manuallyFiled && !arrival.archiveOwned && releaseId ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-undo`, () => onSetReleaseFiled(releaseId, false))}><ArrowsClockwise size={15} /> {actionBusy ? "Reopening…" : "Undo filed"}</button>
                ) : null}
                {arrival.state === "ready" && releaseId ? <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-reveal`, () => onRevealRelease(releaseId))}><FolderOpen size={15} /> Reveal</button> : null}
                {arrival.state === "attention" && releaseId ? <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-verify`, () => onVerifyRelease(releaseId))}><ShieldCheck size={15} /> Verify</button> : null}
                <button type="button" onClick={() => onOpenTransfer(arrival.group.id)}><ArrowSquareOut size={15} /> Details</button>
                {releaseId ? <button type="button" className="is-icon" aria-label={`Remove ${release.album} from Arrival Desk history`} title="Remove completed transfer history" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-remove`, () => onClearReleaseHistory([releaseId]))}><Trash size={15} /></button> : null}
              </div>
              <details className={`arrival-soundcheck is-${arrival.soundcheck.state}`}>
                <summary>
                  <span><Waveform size={14} /><strong>{signal.label}</strong><small>{arrival.soundcheck.deep ? "Deep scan" : arrival.soundcheck.checkedCount ? "Quick scan" : "Not scanned"} · {arrival.audioCount} audio tracks{arrival.soundcheck.expectedTrackCount ? ` · ${arrival.soundcheck.expectedTrackCount} expected` : ""}</small></span>
                  <span>View track evidence</span>
                </summary>
                <div className="arrival-soundcheck-body">
                  {arrival.soundcheck.issues.length ? (
                    <div className="arrival-soundcheck-release-issues">
                      {arrival.soundcheck.issues.map((issue) => <span key={issue}><WarningCircle size={13} weight="fill" />{issue}</span>)}
                    </div>
                  ) : null}
                  <div className="arrival-soundcheck-tracks">
                    {arrival.soundcheck.audio.map((transfer) => {
                      const result = transfer.soundcheck;
                      return (
                        <div key={transfer.id} className={`is-${result?.status ?? "pending"}`}>
                          <span><strong>{transfer.title}</strong><small>{result ? `${result.codec ?? result.container ?? "Audio"} · ${formatDuration(result.durationSeconds)}${result.bitrateKbps ? ` · ${result.bitrateKbps} kbps` : ""}${result.sampleRate ? ` · ${(result.sampleRate / 1000).toFixed(1)} kHz` : ""}` : "Not scanned yet"}</small></span>
                          <span>{result?.issues.length ? result.issues.join(" · ") : result ? result.status === "passed" ? "Passed" : "Review" : "Pending"}</span>
                        </div>
                      );
                    })}
                  </div>
                  {releaseId ? (
                    <div className="arrival-soundcheck-actions">
                      <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-quick`, () => onSoundcheckRelease(releaseId, false))}><Waveform size={14} /> {actionBusy ? "Scanning…" : "Quick scan"}</button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-deep`, () => onSoundcheckRelease(releaseId, true))}><ShieldCheck size={14} /> {actionBusy ? "Scanning…" : "Deep scan"}</button>
                      {arrival.soundcheck.state === "failed" ? <button type="button" className="is-replacement" disabled={Boolean(busy)} onClick={() => void perform(`${arrival.group.id}-find`, async () => { await onFindAlternatives(releaseId, arrival.group.title); onOpenTransfer(arrival.group.id); })}><MagnifyingGlass size={14} /> Find replacement</button> : null}
                    </div>
                  ) : null}
                </div>
              </details>
            </article>
          );
        })}
      </section>
    </div>
  );
}
