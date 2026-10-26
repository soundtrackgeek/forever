import type { SmartDownloadSettings } from "../settings";
import type { Transfer, WantedAlbum, WantedBestSource, WantedSmartAttempt, WantedSmartState, WantedSmartTriedSource } from "../types";
import { isAudioTransfer, summarizeSoundcheck } from "./soundcheck";
import type { TransferGroup } from "./transfers";
import { releasePassedVerification } from "./wantedFulfillment";

// Smart Downloads turn a Wanted album's best acceptable source into a finished,
// verified download without anyone clicking. This file is the decision half:
// pure functions that read the album, its transfers and the clock, and say what
// to do next. smartDownloadRunner.ts performs the side effects.

/** After this many failed rounds an album rests before starting over. */
export const SMART_COOLDOWN_MS = 6 * 60 * 60_000;
/** Never ask for a fresh search more often than this per album. */
export const SMART_RECHECK_GAP_MS = 2 * 60_000;
/** Time for a new release to appear in the transfer snapshot before it counts as removed. */
export const SMART_START_GRACE_MS = 2 * 60_000;
/** Sources vetted per album per pass; each vetting browses the peer's folder. */
export const SMART_VETS_PER_PASS = 3;
export const SMART_TRIED_LIMIT = 40;
/** A source that was merely offline or refused the queue gets another chance after this long. */
export const SMART_TRANSIENT_RETRY_MS = 3 * 60 * 60_000;
const transientOutcomes = new Set(["unreachable", "enqueue"]);

export const emptySmartState: WantedSmartState = {
  attempts: 0,
  tried: [],
  current: null,
  resumeAtMs: null,
  lastRecheckAtMs: null,
  message: null,
  updatedAtMs: 0,
};

const normalizeFolder = (folder: string) =>
  folder.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/\\$/, "").toLowerCase();

export const sourceKey = (username: string, folder: string) =>
  `${username.toLowerCase()}\u0000${normalizeFolder(folder)}`;

/** An expired rest period wipes the slate: earlier rejections no longer count. */
export function effectiveSmartState(state: WantedSmartState | undefined, now: number): WantedSmartState {
  const smart = state ?? emptySmartState;
  if (smart.resumeAtMs == null || now < smart.resumeAtMs) return smart;
  return { ...smart, attempts: 0, tried: [], resumeAtMs: null, message: null };
}

export function groupsForAlbum(album: WantedAlbum, groups: TransferGroup[]) {
  const albumId = album.albumId.toLowerCase();
  return groups.filter((group) =>
    Boolean(group.releaseId)
    && group.createdAtMs >= album.addedAtMs
    && group.transfers.some((transfer) => transfer.releaseGroupId?.toLowerCase() === albumId));
}

export function findCurrentGroup(attempt: WantedSmartAttempt, mine: TransferGroup[]) {
  if (attempt.releaseId) return mine.find((group) => group.releaseId === attempt.releaseId);
  // The release id could not be read back after queueing; match what was queued.
  return mine.find((group) =>
    group.username.toLowerCase() === attempt.username.toLowerCase()
    && group.createdAtMs >= attempt.startedAtMs - 5_000);
}

/** A download the user queued themselves is theirs; Smart Download stays out. */
const blocksSmartDownload = (group: TransferGroup) =>
  group.status === "active"
  || group.status === "queued"
  || group.status === "paused"
  || (group.status === "completed" && releasePassedVerification(group.transfers));

export type ReleaseVerdict = "passed" | "pending" | "review" | "bad";

/** Whether a finished release is good, still being checked, or needs a different source. */
export function releaseVerdict(transfers: Transfer[]): ReleaseVerdict {
  if (!transfers.length || transfers.some((transfer) => transfer.status !== "completed")) return "pending";
  if (transfers.some((transfer) => transfer.verificationStatus === "missing" || transfer.verificationStatus === "sizeMismatch")) {
    return "bad";
  }
  if (transfers.filter(isAudioTransfer).some((transfer) => transfer.verificationStatus !== "verified")) return "pending";
  if (releasePassedVerification(transfers)) return "passed";
  const soundcheck = summarizeSoundcheck(transfers);
  if (soundcheck.state === "failed") return "bad";
  return soundcheck.state === "review" ? "review" : "pending";
}

export type ProgressMemo = { bytes: number; changedAtMs: number };

// "Waiting" only counts while the source is the one holding things up. Files
// parked in our own queue (all download lanes busy) are not the source's fault.
const remoteStates = new Set<Transfer["status"]>(["requesting", "remotelyQueued", "connecting", "downloading", "retrying"]);

export function observeProgress(previous: ProgressMemo | undefined, group: TransferGroup, now: number): ProgressMemo {
  const bytes = group.transferredBytes;
  const waitingOnSource = group.transfers.some((transfer) => transfer.status !== "completed" && remoteStates.has(transfer.status));
  if (!previous || previous.bytes !== bytes || !waitingOnSource) return { bytes, changedAtMs: now };
  return previous;
}

export type SmartPlan =
  | { kind: "idle" }
  /** The user removed our download: respect that and turn Auto off. */
  | { kind: "stop"; message: string }
  /** The current release is dead; forget it and move on. */
  | { kind: "retire"; group: TransferGroup; outcome: string; message: string }
  | { kind: "cooldown"; resumeAtMs: number; message: string }
  /** Out of candidates: ask the Wanted watcher for a fresh search. */
  | { kind: "recheck" }
  /** Vet these in order and queue the first that passes, replacing `replace`. */
  | { kind: "start"; candidates: WantedBestSource[]; replace: TransferGroup | null };

const IDLE: SmartPlan = { kind: "idle" };

export type PlanInput = {
  album: WantedAlbum;
  groups: TransferGroup[];
  settings: SmartDownloadSettings;
  now: number;
  /** Albums other than this one that are downloading automatically right now. */
  runningElsewhere: number;
  progress?: ProgressMemo;
  excluded?: (username: string) => boolean;
  /** A Wanted check is already running; another cannot start. */
  checking: boolean;
};

export function untriedCandidates(
  album: WantedAlbum,
  state: WantedSmartState,
  excluded?: (username: string) => boolean,
  now = Number.NEGATIVE_INFINITY,
) {
  const pool = album.candidates?.length ? album.candidates : album.bestSource ? [album.bestSource] : [];
  const spent = new Set(state.tried
    .filter((item) => !(transientOutcomes.has(item.outcome) && now - item.atMs >= SMART_TRANSIENT_RETRY_MS))
    .map((item) => sourceKey(item.username, item.folder)));
  if (state.current) spent.add(sourceKey(state.current.username, state.current.folder));
  return pool.filter((source) => !spent.has(sourceKey(source.username, source.folder)) && !excluded?.(source.username));
}

const recheckDue = (state: WantedSmartState, since: number, input: PlanInput) =>
  !input.checking
  && (state.lastRecheckAtMs ?? 0) < since
  && input.now - (state.lastRecheckAtMs ?? 0) >= SMART_RECHECK_GAP_MS;

const lastTriedAt = (tried: WantedSmartTriedSource[]) => tried.reduce((latest, item) => Math.max(latest, item.atMs), 0);

export function planSmartDownload(input: PlanInput): SmartPlan {
  const { album, settings, now } = input;
  if (!settings.enabled || album.paused || album.fulfilled || album.autoDownload === false) return IDLE;

  const smart = effectiveSmartState(album.smart, now);
  const mine = groupsForAlbum(album, input.groups);
  const attempt = smart.current;
  const currentGroup = attempt ? findCurrentGroup(attempt, mine) : undefined;
  if (mine.some((group) => group !== currentGroup && blocksSmartDownload(group))) return IDLE;

  if (attempt) {
    if (!currentGroup) {
      return now - attempt.startedAtMs < SMART_START_GRACE_MS
        ? IDLE
        : { kind: "stop", message: `You removed the download from ${attempt.username}, so automatic downloading is off for this album.` };
    }
    if (currentGroup.status === "completed") {
      const verdict = releaseVerdict(currentGroup.transfers);
      return verdict === "bad"
        ? { kind: "retire", group: currentGroup, outcome: "badFiles", message: `${attempt.username}'s files did not pass verification.` }
        : IDLE;
    }
    if (currentGroup.status === "failed") {
      return { kind: "retire", group: currentGroup, outcome: "failed", message: `The download from ${attempt.username} failed.` };
    }
    if (currentGroup.status === "paused") return IDLE;

    const stallMs = settings.stallMinutes * 60_000;
    const lastProgress = Math.max(attempt.startedAtMs, input.progress?.changedAtMs ?? 0);
    if (now - lastProgress < stallMs) return IDLE;
    const candidates = untriedCandidates(album, smart, input.excluded, now);
    if (candidates.length && smart.attempts < settings.maxAttempts) return { kind: "start", candidates, replace: currentGroup };
    // Nothing better is known. Keep waiting, but ask for a fresh search once.
    return !candidates.length && recheckDue(smart, lastProgress + stallMs, input) ? { kind: "recheck" } : IDLE;
  }

  if (smart.resumeAtMs != null) return IDLE;
  if (smart.attempts >= settings.maxAttempts) {
    return {
      kind: "cooldown",
      resumeAtMs: now + SMART_COOLDOWN_MS,
      message: `Tried ${smart.attempts} ${smart.attempts === 1 ? "source" : "sources"} without a finished download. Resting before the next round.`,
    };
  }
  if (input.runningElsewhere >= settings.maxActiveAlbums) return IDLE;
  const candidates = untriedCandidates(album, smart, input.excluded, now);
  if (candidates.length) return { kind: "start", candidates, replace: null };
  return smart.tried.length && recheckDue(smart, lastTriedAt(smart.tried), input) ? { kind: "recheck" } : IDLE;
}

const outcomeCopy: Record<string, string> = {
  unreachable: "could not be reached",
  noAudio: "had no audio files",
  short: "had too few tracks",
  lengths: "had track lengths that differ",
  tracklist: "did not match the official tracklist",
  enqueue: "could not be queued",
  stalled: "stalled",
  failed: "failed",
  badFiles: "failed verification",
};
export const describeOutcome = (outcome: string) => outcomeCopy[outcome] ?? outcome;

export type SmartStatus = { tone: "off" | "waiting" | "working" | "rest"; text: string };

/** One line for the Wanted list; null when Smart Downloads has nothing to say. */
export function smartStatus(album: WantedAlbum, settings: SmartDownloadSettings, groups: TransferGroup[], now: number): SmartStatus | null {
  if (!settings.enabled || album.fulfilled) return null;
  if (album.autoDownload === false) return { tone: "off", text: "Auto-download off for this album" };
  const smart = album.smart ?? emptySmartState;
  if (smart.resumeAtMs != null && now < smart.resumeAtMs) {
    return { tone: "rest", text: `Resting until ${new Date(smart.resumeAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${smart.message ?? "tried every source"}` };
  }
  if (smart.current) {
    const group = findCurrentGroup(smart.current, groupsForAlbum(album, groups));
    const state = group?.status === "completed" ? "verifying" : group?.status === "queued" ? "queued from" : "downloading from";
    return { tone: "working", text: `Auto · ${state} ${smart.current.username} · source ${Math.max(1, smart.attempts)} of ${settings.maxAttempts}` };
  }
  if (smart.message) return { tone: "waiting", text: `Auto · ${smart.message}` };
  return { tone: "waiting", text: album.candidates?.length || album.bestSource ? "Auto · choosing the best source" : "Auto · waiting for a matching source" };
}
