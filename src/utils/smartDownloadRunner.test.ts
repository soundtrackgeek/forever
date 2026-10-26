import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINUTE, T0, groupsOf, inspection, releaseTransfers, smartSettings, smartState, source, wantedAlbum,
} from "../test/smartFixture";
import type { AlbumTrack, WantedAlbum, WantedSmartState } from "../types";
import type { ProgressMemo } from "./smartDownload";
import { SMART_COOLDOWN_MS, SMART_VETS_PER_PASS } from "./smartDownload";
import { runSmartPass, type SmartDeps } from "./smartDownloadRunner";
import type { TracklistConfidence } from "./tracklistConfidence";

const tracks: AlbumTrack[] = [1, 2].map((position) => ({ position, discNumber: 1, discPosition: position, title: `Track ${position}`, durationMs: 240_000 }));
const verdict = (overrides: Partial<TracklistConfidence> = {}) => ({ state: "exact", safeToRecommend: true, ...overrides }) as TracklistConfidence;

type Saved = { albumId: string; state: WantedSmartState };

function harness(overrides: Partial<SmartDeps> = {}) {
  const saved: Saved[] = [];
  const deps = {
    now: () => T0,
    inspect: vi.fn(async (_album: WantedAlbum, candidate) => inspection(candidate.username)),
    officialTracks: vi.fn(async () => tracks),
    confidence: vi.fn(async () => verdict()),
    enqueue: vi.fn(async () => ({ releaseId: "release-new" })),
    cancelRelease: vi.fn(async () => undefined),
    save: vi.fn(async (albumId: string, state: WantedSmartState) => { saved.push({ albumId, state }); }),
    recheck: vi.fn(async () => undefined),
    setAuto: vi.fn(async () => undefined),
    ...overrides,
  } satisfies SmartDeps;
  const pass = (albums: WantedAlbum[], groups = groupsOf(), extra: { progress?: Map<string, ProgressMemo>; checking?: boolean } = {}) =>
    runSmartPass({ albums, groups, settings: smartSettings, progress: extra.progress ?? new Map(), checking: extra.checking ?? false, deps });
  return { deps, saved, pass };
}

const lastSaved = (saved: Saved[]) => saved[saved.length - 1].state;
const stalled = () => new Map<string, ProgressMemo>([["release-group-unveiled", { bytes: 0, changedAtMs: T0 - 30 * MINUTE }]]);
const downloadingFrom = (username: string) => wantedAlbum({
  smart: smartState({ attempts: 1, current: { releaseId: "release-1", username, folder: "Music\\Unveiled", startedAtMs: T0 - 40 * MINUTE } }),
});

beforeEach(() => { vi.restoreAllMocks(); });

describe("starting a download without anyone clicking", () => {
  it("inspects the best source, checks it against MusicBrainz and queues it", async () => {
    const { deps, saved, pass } = harness();
    await pass([wantedAlbum()]);

    expect(deps.inspect).toHaveBeenCalledTimes(1);
    expect(deps.confidence).toHaveBeenCalledWith(expect.objectContaining({ username: "alice" }), tracks, "Whitecross");
    expect(deps.enqueue).toHaveBeenCalledWith(expect.objectContaining({ albumId: "release-group-unveiled" }), expect.objectContaining({ username: "alice" }), expect.anything(), 2);
    expect(saved).toHaveLength(1);
    expect(lastSaved(saved)).toMatchObject({
      attempts: 1,
      tried: [],
      current: { releaseId: "release-new", username: "alice", folder: "Music\\Unveiled", startedAtMs: T0 },
      message: "Downloading from alice.",
    });
  });

  it("expects the larger of the official and inspected track counts", async () => {
    const { deps, pass } = harness({ inspect: vi.fn(async (_a, c) => inspection(c.username, 3)) });
    await pass([wantedAlbum()]);
    expect(deps.enqueue).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3);
  });

  it("skips a source whose track lengths do not match and takes the next one", async () => {
    const confidence = vi.fn()
      .mockResolvedValueOnce(verdict({ state: "durationMismatch", safeToRecommend: false }))
      .mockResolvedValue(verdict());
    const { deps, saved, pass } = harness({ confidence });
    await pass([wantedAlbum()]);

    expect(deps.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: "bob" }), expect.anything(), 2);
    expect(lastSaved(saved)).toMatchObject({
      attempts: 1,
      current: { username: "bob" },
      tried: [{ username: "alice", folder: "Music\\Unveiled", outcome: "lengths", atMs: T0 }],
    });
  });

  it.each([
    ["cannot be reached", { inspect: vi.fn().mockRejectedValue(new Error("offline")) }, "unreachable"],
    ["has no audio files", { inspect: vi.fn(async (_a: WantedAlbum, c: { username: string }) => ({ ...inspection(c.username, 0) })) }, "noAudio"],
    ["names the wrong tracks", { confidence: vi.fn(async () => verdict({ state: "unclear", safeToRecommend: false })) }, "tracklist"],
    ["cannot be queued", { enqueue: vi.fn().mockRejectedValue(new Error("duplicate")) }, "enqueue"],
  ])("records a source that %s and never queues it", async (_name, override, outcome) => {
    const { deps, saved, pass } = harness(override as Partial<SmartDeps>);
    await pass([wantedAlbum()]);
    expect(lastSaved(saved).current).toBeNull();
    expect(lastSaved(saved).tried.map((t) => t.outcome)).toEqual(Array(SMART_VETS_PER_PASS).fill(outcome));
    expect(lastSaved(saved).attempts).toBe(0);
    expect(lastSaved(saved).message).toMatch(/^Passed over 3 sources/);
    if (outcome !== "enqueue") expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("rejects folders with fewer tracks than the album's profile asks for", async () => {
    const { deps, saved, pass } = harness();
    await pass([wantedAlbum({ preferences: { formatPreference: "any", minimumBitrateKbps: null, minimumTrackCount: 3 } })]);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(lastSaved(saved).tried[0].outcome).toBe("short");
  });

  it("falls back to track count alone when MusicBrainz has no tracklist", async () => {
    const { deps, saved, pass } = harness({ officialTracks: vi.fn(async () => []) });
    await pass([wantedAlbum()]);
    expect(deps.confidence).not.toHaveBeenCalled();
    expect(deps.enqueue).toHaveBeenCalled();
    expect(lastSaved(saved).message).toContain("tracklist unavailable");
  });

  it("will not guess at a chosen edition whose tracklist cannot be loaded", async () => {
    const { deps, saved, pass } = harness({ officialTracks: vi.fn(async () => []) });
    await pass([wantedAlbum({ selectedReleaseId: "edition-1" })]);
    expect(deps.inspect).toHaveBeenCalledTimes(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("vets only a few sources per pass", async () => {
    const many = ["a", "b", "c", "d", "e"].map((name) => source(name));
    const { deps, pass } = harness({ inspect: vi.fn().mockRejectedValue(new Error("offline")) });
    await pass([wantedAlbum({ candidates: many })]);
    expect(deps.inspect).toHaveBeenCalledTimes(SMART_VETS_PER_PASS);
  });

  it("changes nothing for an album that is not eligible", async () => {
    const { deps, saved, pass } = harness();
    await pass([wantedAlbum({ autoDownload: false }), wantedAlbum({ albumId: "b", paused: true }), wantedAlbum({ albumId: "c", fulfilled: true })]);
    expect(deps.inspect).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("starts no more albums than the setting allows", async () => {
    const albums = ["one", "two", "three"].map((id) => wantedAlbum({ albumId: id }));
    const { deps, pass } = harness();
    await pass(albums);
    expect(deps.enqueue).toHaveBeenCalledTimes(smartSettings.maxActiveAlbums);
  });

  it("keeps going when one album's backend call fails", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
    const { deps, pass } = harness({ save });
    await pass([wantedAlbum({ albumId: "one" }), wantedAlbum({ albumId: "two" })]);
    expect(deps.enqueue).toHaveBeenCalledTimes(2);
  });
});

describe("switching away from a source that has stalled", () => {
  it("queues the next good source first, then drops the stalled release", async () => {
    const order: string[] = [];
    const { deps, saved, pass } = harness({
      enqueue: vi.fn(async () => { order.push("enqueue"); return { releaseId: "release-new" }; }),
      cancelRelease: vi.fn(async () => { order.push("cancel"); }),
    });
    await pass([downloadingFrom("alice")], groupsOf(releaseTransfers({ status: "remotelyQueued" })), { progress: stalled() });

    expect(order).toEqual(["enqueue", "cancel"]);
    expect(deps.cancelRelease).toHaveBeenCalledWith("release-1");
    expect(deps.inspect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: "bob" }));
    expect(lastSaved(saved)).toMatchObject({
      attempts: 2,
      current: { releaseId: "release-new", username: "bob" },
      tried: [{ username: "alice", outcome: "stalled" }],
      message: "Switched to bob after alice stalled.",
    });
  });

  it("keeps the stalled download when no replacement passes the checks", async () => {
    const { deps, saved, pass } = harness({ confidence: vi.fn(async () => verdict({ state: "durationMismatch", safeToRecommend: false })) });
    await pass([downloadingFrom("alice")], groupsOf(releaseTransfers({ status: "remotelyQueued" })), { progress: stalled() });

    expect(deps.cancelRelease).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(lastSaved(saved).current).toMatchObject({ releaseId: "release-1", username: "alice" });
    expect(lastSaved(saved).tried.map((t) => t.username)).toEqual(["bob", "carol"]);
  });

  it("does not switch while the source is still sending data", async () => {
    const { deps, saved, pass } = harness();
    const fresh = new Map<string, ProgressMemo>([["release-group-unveiled", { bytes: 0, changedAtMs: T0 - MINUTE }]]);
    await pass([downloadingFrom("alice")], groupsOf(releaseTransfers({ status: "downloading", transferredBytes: 1 })), { progress: fresh });
    expect(deps.inspect).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("remembers progress between passes so a quiet source is eventually replaced", async () => {
    let clock = T0;
    const { deps, saved, pass } = harness({ now: () => clock });
    const album = wantedAlbum({ smart: smartState({ attempts: 1, current: { releaseId: "release-1", username: "alice", folder: "Music\\Unveiled", startedAtMs: T0 } }) });
    const groups = groupsOf(releaseTransfers({ status: "remotelyQueued", createdAtMs: T0 }));
    const progress = new Map<string, ProgressMemo>();
    await pass([album], groups, { progress });
    expect(saved).toHaveLength(0);
    clock = T0 + 21 * MINUTE;
    await pass([album], groups, { progress });
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("recovering from dead, rejected or removed downloads", () => {
  it("cancels a failed release and remembers the source", async () => {
    const { deps, saved, pass } = harness();
    await pass([downloadingFrom("alice")], groupsOf(releaseTransfers({ status: "failed" })));
    expect(deps.cancelRelease).toHaveBeenCalledWith("release-1");
    expect(lastSaved(saved)).toMatchObject({
      current: null,
      tried: [{ username: "alice", outcome: "failed" }],
      message: "The download from alice failed. Looking for another source.",
    });
  });

  it("starts the next source on the following pass after a retirement", async () => {
    const { deps, pass } = harness();
    const retired = wantedAlbum({ smart: smartState({ attempts: 1, tried: [{ username: "alice", folder: "Music\\Unveiled", outcome: "failed", atMs: T0 }] }) });
    await pass([retired]);
    expect(deps.inspect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: "bob" }));
  });

  it("drops files that fail verification", async () => {
    const { deps, saved, pass } = harness();
    const damaged = groupsOf(releaseTransfers({ status: "completed", soundcheck: "failed" }));
    await pass([downloadingFrom("alice")], damaged);
    expect(deps.cancelRelease).toHaveBeenCalledWith("release-1");
    expect(lastSaved(saved).tried[0].outcome).toBe("badFiles");
  });

  it("turns Auto off when the person removes the download", async () => {
    const { deps, saved, pass } = harness();
    await pass([downloadingFrom("alice")], groupsOf());
    expect(deps.setAuto).toHaveBeenCalledWith("release-group-unveiled", false);
    expect(lastSaved(saved)).toMatchObject({ current: null, attempts: 0, message: expect.stringContaining("You removed the download from alice") });
    expect(deps.cancelRelease).not.toHaveBeenCalled();
  });

  it("rests an album that has used every attempt", async () => {
    const { deps, saved, pass } = harness();
    await pass([wantedAlbum({ smart: smartState({ attempts: 3 }) })]);
    expect(deps.inspect).not.toHaveBeenCalled();
    expect(lastSaved(saved)).toMatchObject({ attempts: 3, resumeAtMs: T0 + SMART_COOLDOWN_MS });
  });

  it("starts a rested album over with a clean list of tried sources", async () => {
    const { deps, saved, pass } = harness();
    const rested = wantedAlbum({ smart: smartState({ attempts: 3, resumeAtMs: T0 - 1, tried: [{ username: "alice", folder: "Music\\Unveiled", outcome: "failed", atMs: T0 - 7 * 60 * MINUTE }] }) });
    await pass([rested]);
    expect(deps.inspect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: "alice" }));
    expect(lastSaved(saved)).toMatchObject({ attempts: 1, resumeAtMs: null, tried: [] });
  });
});

describe("asking for a fresh search", () => {
  const exhausted = () => wantedAlbum({
    smart: smartState({ attempts: 2, tried: ["alice", "bob", "carol"].map((username) => ({ username, folder: "Music\\Unveiled", outcome: "lengths", atMs: T0 - 10 * MINUTE })) }),
  });

  it("requests a Wanted check once, then remembers that it asked", async () => {
    const { deps, saved, pass } = harness();
    await pass([exhausted()]);
    expect(deps.recheck).toHaveBeenCalledWith("release-group-unveiled");
    expect(lastSaved(saved).lastRecheckAtMs).toBe(T0);
  });

  it("tries again later if the check could not start", async () => {
    const { saved, pass } = harness({ recheck: vi.fn().mockRejectedValue(new Error("Another wanted album is already being checked.")) });
    await pass([exhausted()]);
    expect(saved).toHaveLength(0);
  });

  it("does not ask while another check is running", async () => {
    const { deps, pass } = harness();
    await pass([exhausted()], groupsOf(), { checking: true });
    expect(deps.recheck).not.toHaveBeenCalled();
  });
});
