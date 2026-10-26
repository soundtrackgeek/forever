import { describe, expect, it } from "vitest";
import {
  MINUTE, T0, groupsOf, releaseTransfers, smartSettings, smartState, source, wantedAlbum,
} from "../test/smartFixture";
import {
  SMART_COOLDOWN_MS, SMART_RECHECK_GAP_MS, SMART_START_GRACE_MS,
  effectiveSmartState, observeProgress, planSmartDownload, releaseVerdict, smartStatus, sourceKey, untriedCandidates,
  type PlanInput,
} from "./smartDownload";

const plan = (overrides: Partial<PlanInput> = {}) => planSmartDownload({
  album: wantedAlbum(), groups: [], settings: smartSettings, now: T0, runningElsewhere: 0, checking: false, ...overrides,
});
const current = (overrides: Partial<NonNullable<ReturnType<typeof smartState>["current"]>> = {}) => ({
  releaseId: "release-1", username: "alice", folder: "Music\\Unveiled", startedAtMs: T0 - 30 * MINUTE, ...overrides,
});
const running = (stateOverrides = {}) => wantedAlbum({
  smart: smartState({ attempts: 1, current: current(), ...stateOverrides }),
});

describe("when Smart Download leaves an album alone", () => {
  it.each([
    ["it is switched off globally", { settings: { ...smartSettings, enabled: false } }],
    ["the album opted out", { album: wantedAlbum({ autoDownload: false }) }],
    ["the watch is paused", { album: wantedAlbum({ paused: true }) }],
    ["the album is already fulfilled", { album: wantedAlbum({ fulfilled: true }) }],
  ])("does nothing when %s", (_name, overrides) => {
    expect(plan(overrides as Partial<PlanInput>)).toEqual({ kind: "idle" });
  });

  it("stays out of a download the person queued themselves", () => {
    const manual = groupsOf(releaseTransfers({ releaseId: "manual", username: "dave", status: "downloading" }));
    expect(plan({ groups: manual })).toEqual({ kind: "idle" });
  });

  it("is not blocked by a manual download that already failed", () => {
    const failed = groupsOf(releaseTransfers({ releaseId: "manual", username: "dave", status: "failed" }));
    expect(plan({ groups: failed }).kind).toBe("start");
  });

  it("ignores transfers from before the album was added to Wanted", () => {
    const old = groupsOf(releaseTransfers({ releaseId: "old", status: "downloading", createdAtMs: T0 - 120 * MINUTE }));
    expect(plan({ groups: old }).kind).toBe("start");
  });
});

describe("choosing a source to start", () => {
  it("offers the ranked candidates best first", () => {
    const result = plan();
    expect(result.kind).toBe("start");
    if (result.kind === "start") {
      expect(result.candidates.map((candidate) => candidate.username)).toEqual(["alice", "bob", "carol"]);
      expect(result.replace).toBeNull();
    }
  });

  it("falls back to the single best source when no ranked list was stored", () => {
    const result = plan({ album: wantedAlbum({ candidates: undefined }) });
    expect(result.kind === "start" && result.candidates.map((c) => c.username)).toEqual(["alice"]);
  });

  it("skips sources already tried and users who are blocked", () => {
    const album = wantedAlbum({
      smart: smartState({ attempts: 1, tried: [{ username: "ALICE", folder: "music\\unveiled\\", outcome: "stalled", atMs: T0 }] }),
    });
    const result = plan({ album, excluded: (name) => name === "bob" });
    expect(result.kind === "start" && result.candidates.map((c) => c.username)).toEqual(["carol"]);
  });

  it("treats a different folder from the same user as a different source", () => {
    const album = wantedAlbum({
      candidates: [source("alice", "Music\\Unveiled"), source("alice", "Music\\Unveiled (Deluxe)")],
      smart: smartState({ tried: [{ username: "alice", folder: "Music\\Unveiled", outcome: "lengths", atMs: T0 }] }),
    });
    expect(untriedCandidates(album, album.smart!).map((c) => c.folder)).toEqual(["Music\\Unveiled (Deluxe)"]);
    expect(sourceKey("A", "x/y")).toBe(sourceKey("a", "X\\Y\\"));
  });

  it("waits for a free automatic slot", () => {
    expect(plan({ runningElsewhere: 2 })).toEqual({ kind: "idle" });
    expect(plan({ runningElsewhere: 1 }).kind).toBe("start");
  });
});

describe("a download in progress", () => {
  const inFlight = (status: "downloading" | "failed" | "completed" | "paused" | "queued", extra = {}) =>
    groupsOf(releaseTransfers({ status, ...extra }));

  it("is left alone while data keeps arriving", () => {
    const progress = { bytes: 5, changedAtMs: T0 - MINUTE };
    expect(plan({ album: running(), groups: inFlight("downloading"), progress })).toEqual({ kind: "idle" });
  });

  it("is replaced once it has waited past the stall limit and another source is known", () => {
    const groups = inFlight("downloading");
    const result = plan({ album: running(), groups, progress: { bytes: 0, changedAtMs: T0 - 21 * MINUTE } });
    expect(result.kind).toBe("start");
    if (result.kind === "start") {
      // The source being replaced is not offered again.
      expect(result.candidates.map((c) => c.username)).toEqual(["bob", "carol"]);
      expect(result.replace?.releaseId).toBe("release-1");
    }
  });

  it("counts the wait from when the attempt started when no progress was ever seen", () => {
    const album = running({ current: current({ startedAtMs: T0 - 5 * MINUTE }) });
    expect(plan({ album, groups: inFlight("downloading") })).toEqual({ kind: "idle" });
  });

  it("keeps waiting, and asks for one fresh search, when nothing better is known", () => {
    const album = wantedAlbum({ candidates: [source("alice")], smart: smartState({ attempts: 1, current: current() }) });
    const groups = inFlight("downloading");
    const progress = { bytes: 0, changedAtMs: T0 - 25 * MINUTE };
    expect(plan({ album, groups, progress })).toEqual({ kind: "recheck" });
    const asked = wantedAlbum({ ...album, smart: smartState({ attempts: 1, current: current(), lastRecheckAtMs: T0 - MINUTE * 3 }) });
    expect(plan({ album: asked, groups, progress })).toEqual({ kind: "idle" });
    expect(plan({ album, groups, progress, checking: true })).toEqual({ kind: "idle" });
  });

  it("does not swap sources once the album has used all its attempts", () => {
    const album = running({ attempts: 3 });
    expect(plan({ album, groups: inFlight("downloading"), progress: { bytes: 0, changedAtMs: T0 - 40 * MINUTE } }).kind).not.toBe("start");
  });

  it("gives up on a release that failed outright", () => {
    const result = plan({ album: running(), groups: inFlight("failed") });
    expect(result).toMatchObject({ kind: "retire", outcome: "failed" });
  });

  it("gives up on finished files that fail verification", () => {
    const groups = groupsOf(releaseTransfers({ status: "completed", verification: "sizeMismatch", soundcheck: null }));
    expect(plan({ album: running(), groups })).toMatchObject({ kind: "retire", outcome: "badFiles" });
    const damaged = groupsOf(releaseTransfers({ status: "completed", soundcheck: "failed" }));
    expect(plan({ album: running(), groups: damaged })).toMatchObject({ kind: "retire", outcome: "badFiles" });
  });

  it("waits for verification to finish and for a person to review a flagged soundcheck", () => {
    const verifying = groupsOf(releaseTransfers({ status: "completed", verification: "pending", soundcheck: null }));
    expect(plan({ album: running(), groups: verifying })).toEqual({ kind: "idle" });
    const flagged = groupsOf(releaseTransfers({ status: "completed", soundcheck: "review" }));
    expect(plan({ album: running(), groups: flagged })).toEqual({ kind: "idle" });
    expect(releaseVerdict(releaseTransfers({ status: "completed", soundcheck: "review" }))).toBe("review");
  });

  it("is done once verification passes, leaving fulfillment to the Wanted list", () => {
    const groups = groupsOf(releaseTransfers({ status: "completed" }));
    expect(plan({ album: running(), groups })).toEqual({ kind: "idle" });
    expect(releaseVerdict(releaseTransfers({ status: "completed" }))).toBe("passed");
  });

  it("respects a pause the person chose", () => {
    expect(plan({ album: running(), groups: inFlight("paused"), progress: { bytes: 0, changedAtMs: T0 - 90 * MINUTE } })).toEqual({ kind: "idle" });
  });

  it("treats a vanished release as the person removing it", () => {
    expect(plan({ album: running() })).toMatchObject({ kind: "stop" });
    const fresh = running({ current: current({ startedAtMs: T0 - SMART_START_GRACE_MS + 1_000 }) });
    expect(plan({ album: fresh })).toEqual({ kind: "idle" });
  });

  it("finds the release by user when its id could not be read back", () => {
    const album = running({ current: current({ releaseId: null }) });
    expect(plan({ album, groups: inFlight("failed") })).toMatchObject({ kind: "retire" });
  });
});

describe("retries, resting and fresh searches", () => {
  it("gives a source that was only offline another chance after a few hours", () => {
    const tried = [{ username: "alice", folder: "Music\\Unveiled", outcome: "unreachable", atMs: T0 - 4 * 60 * MINUTE }];
    const album = wantedAlbum({ smart: smartState({ tried }) });
    expect(untriedCandidates(album, album.smart!, undefined, T0).map((c) => c.username)).toContain("alice");
    const recent = wantedAlbum({ smart: smartState({ tried: [{ ...tried[0], atMs: T0 - MINUTE }] }) });
    expect(untriedCandidates(recent, recent.smart!, undefined, T0).map((c) => c.username)).not.toContain("alice");
    const bad = wantedAlbum({ smart: smartState({ tried: [{ ...tried[0], outcome: "lengths" }] }) });
    expect(untriedCandidates(bad, bad.smart!, undefined, T0).map((c) => c.username)).not.toContain("alice");
  });

  it("rests after the attempt limit is spent", () => {
    const album = wantedAlbum({ smart: smartState({ attempts: 3 }) });
    expect(plan({ album })).toEqual({
      kind: "cooldown",
      resumeAtMs: T0 + SMART_COOLDOWN_MS,
      message: "Tried 3 sources without a finished download. Resting before the next round.",
    });
  });

  it("stays quiet while resting, then starts over with a clean slate", () => {
    const resting = wantedAlbum({ smart: smartState({ attempts: 3, resumeAtMs: T0 + MINUTE, tried: [{ username: "alice", folder: "Music\\Unveiled", outcome: "failed", atMs: T0 }] }) });
    expect(plan({ album: resting })).toEqual({ kind: "idle" });
    const rested = plan({ album: resting, now: T0 + 2 * MINUTE });
    expect(rested.kind === "start" && rested.candidates.map((c) => c.username)).toEqual(["alice", "bob", "carol"]);
    expect(effectiveSmartState(resting.smart, T0 + 2 * MINUTE)).toMatchObject({ attempts: 0, tried: [], resumeAtMs: null });
    expect(effectiveSmartState(resting.smart, T0)).toBe(resting.smart);
  });

  it("asks for a fresh search once every known source has been tried", () => {
    const album = wantedAlbum({
      smart: smartState({ attempts: 2, tried: ["alice", "bob", "carol"].map((username) => ({ username, folder: "Music\\Unveiled", outcome: "lengths", atMs: T0 - 10 * MINUTE })) }),
    });
    expect(plan({ album })).toEqual({ kind: "recheck" });
    expect(plan({ album, checking: true })).toEqual({ kind: "idle" });
    const asked = wantedAlbum({ ...album, smart: { ...album.smart!, lastRecheckAtMs: T0 - MINUTE } });
    expect(plan({ album: asked })).toEqual({ kind: "idle" });
    // Even after a newer failure, searches are never requested back to back.
    const justAsked = wantedAlbum({ ...album, smart: { ...album.smart!, lastRecheckAtMs: T0 - SMART_RECHECK_GAP_MS + 1, tried: album.smart!.tried.map((t) => ({ ...t, atMs: T0 })) } });
    expect(plan({ album: justAsked })).toEqual({ kind: "idle" });
  });

  it("never searches on its own for an album nobody has offered a source for", () => {
    expect(plan({ album: wantedAlbum({ candidates: [], bestSource: null }) })).toEqual({ kind: "idle" });
  });
});

describe("telling a slow source from a busy queue", () => {
  const group = (status: "downloading" | "queued" | "remotelyQueued", transferredBytes = 0) =>
    groupsOf(releaseTransfers({ status, transferredBytes }))[0];

  it("restarts the clock whenever bytes arrive", () => {
    const before = { bytes: 40, changedAtMs: T0 - 10 * MINUTE };
    expect(observeProgress(before, group("downloading", 50), T0)).toEqual({ bytes: 100, changedAtMs: T0 });
  });

  it("keeps the old timestamp while the source stays silent", () => {
    const before = { bytes: 100, changedAtMs: T0 - 10 * MINUTE };
    const same = group("remotelyQueued", 50);
    expect(observeProgress({ bytes: same.transferredBytes, changedAtMs: before.changedAtMs }, same, T0)).toEqual({ bytes: 100, changedAtMs: T0 - 10 * MINUTE });
    expect(observeProgress(undefined, same, T0)).toEqual({ bytes: 100, changedAtMs: T0 });
  });

  it("does not blame the source when files wait in the local queue", () => {
    const local = group("queued");
    const before = { bytes: local.transferredBytes, changedAtMs: T0 - 40 * MINUTE };
    expect(observeProgress(before, local, T0).changedAtMs).toBe(T0);
  });
});

describe("the status line on the Wanted list", () => {
  const status = (album = wantedAlbum(), groups = groupsOf()) => smartStatus(album, smartSettings, groups, T0);

  it("is hidden when Smart Downloads is off or the album is done", () => {
    expect(smartStatus(wantedAlbum(), { ...smartSettings, enabled: false }, [], T0)).toBeNull();
    expect(status(wantedAlbum({ fulfilled: true }))).toBeNull();
  });

  it("describes each stage in plain words", () => {
    expect(status(wantedAlbum({ autoDownload: false }))).toMatchObject({ tone: "off" });
    expect(status(wantedAlbum({ candidates: [], bestSource: null }))?.text).toBe("Auto · waiting for a matching source");
    expect(status()?.text).toBe("Auto · choosing the best source");
    expect(status(wantedAlbum({ smart: smartState({ message: "Passed over 1 source." }) }))?.text).toBe("Auto · Passed over 1 source.");
    const downloading = status(running(), groupsOf(releaseTransfers({ status: "downloading" })));
    expect(downloading).toEqual({ tone: "working", text: "Auto · downloading from alice · source 1 of 3" });
    const resting = status(wantedAlbum({ smart: smartState({ resumeAtMs: T0 + 3 * MINUTE, message: "Tried every source." }) }));
    expect(resting?.tone).toBe("rest");
    expect(resting?.text).toContain("Resting until");
  });
});
