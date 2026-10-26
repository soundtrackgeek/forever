import type { SmartDownloadSettings } from "../settings";
import type { AlbumTrack, FolderInspection, WantedAlbum, WantedBestSource, WantedSmartState, WantedSmartTriedSource } from "../types";
import {
  SMART_TRIED_LIMIT,
  SMART_VETS_PER_PASS,
  describeOutcome,
  effectiveSmartState,
  emptySmartState,
  findCurrentGroup,
  groupsForAlbum,
  observeProgress,
  planSmartDownload,
  type ProgressMemo,
  type SmartPlan,
} from "./smartDownload";
import { inspectionAudioFiles, type TracklistConfidence } from "./tracklistConfidence";
import type { TransferGroup } from "./transfers";

// The doing half of Smart Downloads: vets sources the way a careful person
// would (open the folder, compare it with MusicBrainz), queues the first good
// one, and writes down what happened so a restart picks up where it left off.

export type SmartDeps = {
  now: () => number;
  inspect: (album: WantedAlbum, source: WantedBestSource) => Promise<FolderInspection>;
  officialTracks: (album: WantedAlbum) => Promise<AlbumTrack[]>;
  confidence: (inspection: FolderInspection, tracks: AlbumTrack[], artist: string) => Promise<TracklistConfidence>;
  enqueue: (album: WantedAlbum, source: WantedBestSource, inspection: FolderInspection, expectedTrackCount: number | null) => Promise<{ releaseId: string | null }>;
  cancelRelease: (releaseId: string) => Promise<unknown>;
  save: (albumId: string, state: WantedSmartState) => Promise<unknown>;
  recheck: (albumId: string) => Promise<unknown>;
  setAuto: (albumId: string, auto: boolean) => Promise<unknown>;
};

export type PassInput = {
  albums: WantedAlbum[];
  groups: TransferGroup[];
  settings: SmartDownloadSettings;
  progress: Map<string, ProgressMemo>;
  checking: boolean;
  excluded?: (username: string) => boolean;
  deps: SmartDeps;
  cancelled?: () => boolean;
};

const INSPECT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type Vetted = { ok: true; inspection: FolderInspection; audioCount: number } | { ok: false; outcome: string };

async function vet(album: WantedAlbum, source: WantedBestSource, tracks: AlbumTrack[], deps: SmartDeps): Promise<Vetted> {
  let inspection: FolderInspection;
  try {
    inspection = await withTimeout(deps.inspect(album, source), INSPECT_TIMEOUT_MS);
  } catch {
    return { ok: false, outcome: "unreachable" };
  }
  const audioCount = inspectionAudioFiles(inspection).length;
  if (audioCount === 0) return { ok: false, outcome: "noAudio" };
  const minimum = album.preferences.minimumTrackCount ?? 0;
  if (audioCount < minimum) return { ok: false, outcome: "short" };
  if (tracks.length > 0) {
    try {
      const confidence = await deps.confidence(inspection, tracks, album.artist);
      if (!confidence.safeToRecommend) {
        return { ok: false, outcome: confidence.state === "durationMismatch" ? "lengths" : "tracklist" };
      }
    } catch {
      return { ok: false, outcome: "tracklist" };
    }
  }
  return { ok: true, inspection, audioCount };
}

type Outcome = "running" | "ended" | "unchanged";

async function startDownload(
  album: WantedAlbum,
  plan: Extract<SmartPlan, { kind: "start" }>,
  base: WantedSmartState,
  input: PassInput,
  now: number,
): Promise<Outcome> {
  const { deps } = input;
  const save = (state: WantedSmartState) => deps.save(album.albumId, {
    ...state, tried: state.tried.slice(-SMART_TRIED_LIMIT), updatedAtMs: now,
  });
  const tracks = await deps.officialTracks(album).catch(() => [] as AlbumTrack[]);
  // A chosen edition cannot be checked without its own tracklist; wait for it
  // rather than judging folders against the wrong one.
  if (!tracks.length && album.selectedReleaseId) return "unchanged";

  const rejected: WantedSmartTriedSource[] = [];
  for (const source of plan.candidates.slice(0, SMART_VETS_PER_PASS)) {
    if (input.cancelled?.()) return "unchanged";
    const result = await vet(album, source, tracks, deps);
    if (!result.ok) {
      rejected.push({ username: source.username, folder: source.folder, outcome: result.outcome, atMs: now });
      continue;
    }
    let queued: { releaseId: string | null };
    try {
      queued = await deps.enqueue(album, source, result.inspection, Math.max(tracks.length, result.audioCount) || null);
    } catch {
      rejected.push({ username: source.username, folder: source.folder, outcome: "enqueue", atMs: now });
      continue;
    }
    const replaced = plan.replace && base.current;
    if (plan.replace?.releaseId) await deps.cancelRelease(plan.replace.releaseId).catch(() => undefined);
    if (replaced) rejected.push({ username: replaced.username, folder: replaced.folder, outcome: "stalled", atMs: now });
    await save({
      ...base,
      attempts: base.attempts + 1,
      tried: [...base.tried, ...rejected],
      current: { releaseId: queued.releaseId, username: source.username, folder: source.folder, startedAtMs: now },
      message: replaced
        ? `Switched to ${source.username} after ${replaced.username} stalled.`
        : tracks.length ? `Downloading from ${source.username}.` : `Downloading from ${source.username} (official tracklist unavailable, matched by track count).`,
    });
    return "running";
  }

  if (!rejected.length) return "unchanged";
  const last = rejected[rejected.length - 1];
  await save({
    ...base,
    tried: [...base.tried, ...rejected],
    message: `Passed over ${rejected.length} ${rejected.length === 1 ? "source" : "sources"} (${last.username} ${describeOutcome(last.outcome)}). Looking for others.`,
  });
  return "unchanged";
}

async function execute(album: WantedAlbum, plan: SmartPlan, input: PassInput, now: number): Promise<Outcome> {
  if (plan.kind === "idle") return "unchanged";
  const { deps } = input;
  const base = effectiveSmartState(album.smart, now);
  const save = (state: WantedSmartState) => deps.save(album.albumId, {
    ...state, tried: state.tried.slice(-SMART_TRIED_LIMIT), updatedAtMs: now,
  });
  switch (plan.kind) {
    case "start":
      return startDownload(album, plan, base, input, now);
    case "retire": {
      if (plan.group.releaseId) await deps.cancelRelease(plan.group.releaseId).catch(() => undefined);
      const attempt = base.current;
      await save({
        ...base,
        current: null,
        tried: attempt ? [...base.tried, { username: attempt.username, folder: attempt.folder, outcome: plan.outcome, atMs: now }] : base.tried,
        message: `${plan.message} Looking for another source.`,
      });
      return "ended";
    }
    case "stop":
      await deps.setAuto(album.albumId, false);
      await save({ ...emptySmartState, message: plan.message });
      return "ended";
    case "cooldown":
      await save({ ...base, resumeAtMs: plan.resumeAtMs, message: plan.message });
      return "unchanged";
    case "recheck":
      // A refused check (one is already running, or offline) is simply retried next pass.
      await deps.recheck(album.albumId);
      await save({ ...base, lastRecheckAtMs: now });
      return "unchanged";
  }
}

/** One look at every Wanted album; call it on a timer and whenever Wanted or Transfers change. */
export async function runSmartPass(input: PassInput) {
  const { albums, groups, settings, deps, progress } = input;
  const now = deps.now();
  const eligible = albums.filter((album) => settings.enabled && !album.fulfilled && !album.paused && album.autoDownload !== false);

  const running = new Set<string>();
  const live = new Set<string>();
  for (const album of eligible) {
    const attempt = album.smart?.current;
    if (!attempt) continue;
    const group = findCurrentGroup(attempt, groupsForAlbum(album, groups));
    if (!group) continue;
    running.add(album.albumId);
    live.add(album.albumId);
    progress.set(album.albumId, observeProgress(progress.get(album.albumId), group, now));
  }
  for (const id of [...progress.keys()]) if (!live.has(id)) progress.delete(id);

  // Albums already downloading go first so a stalled one can swap its source
  // before a new album claims the free slot.
  const ordered = [...eligible].sort((a, b) => Number(Boolean(b.smart?.current)) - Number(Boolean(a.smart?.current)));
  for (const album of ordered) {
    if (input.cancelled?.()) return;
    try {
      const plan = planSmartDownload({
        album, groups, settings, now,
        runningElsewhere: running.size - (running.has(album.albumId) ? 1 : 0),
        progress: progress.get(album.albumId),
        excluded: input.excluded,
        checking: input.checking,
      });
      const outcome = await execute(album, plan, input, now);
      if (outcome === "running") {
        running.add(album.albumId);
        progress.set(album.albumId, { bytes: 0, changedAtMs: now });
      } else if (outcome === "ended") {
        running.delete(album.albumId);
        progress.delete(album.albumId);
      }
    } catch {
      // One album's failure must not stop the others; the next pass tries again.
    }
  }
}
