import { describe, expect, it } from "vitest";
import type { Transfer, WantedAlbum } from "../types";
import { verifiedDownloadedWantedAlbumIds } from "./wantedFulfillment";

const album = (addedAtMs = 100): WantedAlbum => ({
  albumId: "release-group-unveiled",
  artist: "Whitecross",
  title: "Unveiled",
  firstReleaseDate: "1994-01-01",
  coverArtUrl: null,
  paused: false,
  fulfilled: false,
  fulfilledAtMs: null,
  ownedTrackCount: null,
  preferences: {
    formatPreference: "mp3Only",
    minimumBitrateKbps: 320,
    minimumTrackCount: 2,
  },
  addedAtMs,
  lastCheckedAtMs: 90,
  sourceCount: 4,
  matchingSourceCount: 3,
  readySourceCount: 2,
  completeSourceCount: 3,
  newSourceCount: 1,
  bestFormat: "MP3",
  bestTrackCount: 2,
  bestSizeBytes: 20_000_000,
  bestSpeedBytesPerSecond: 2_000_000,
  bestSource: null,
  error: null,
});

const transfer = (index: number): Transfer => ({
  id: `unveiled-${index}`,
  releaseId: "download-unveiled",
  releaseTitle: "Whitecross - Unveiled (1994)",
  releaseFolder: "C:\\Downloads\\Whitecross - Unveiled (1994)",
  releaseGroupId: "release-group-unveiled",
  fileIndex: index,
  fileCount: 2,
  expectedTrackCount: 2,
  title: `0${index} - Track.mp3`,
  username: "source",
  remoteFilename: `Music\\Unveiled\\0${index} - Track.mp3`,
  sizeBytes: 10_000_000,
  transferredBytes: 10_000_000,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queuePosition: null,
  localPath: `C:\\Downloads\\Whitecross - Unveiled (1994)\\0${index} - Track.mp3`,
  error: null,
  verificationStatus: "verified",
  verifiedAtMs: 200 + index,
  soundcheck: {
    status: "passed",
    checkedAtMs: 200 + index,
    deep: false,
    codec: "MP3",
    container: "MP3",
    durationSeconds: 240,
    bitrateKbps: 320,
    sampleRate: 44_100,
    bitsPerSample: null,
    channels: 2,
    trackNumber: index,
    trackTotal: 2,
    issues: [],
  },
  createdAtMs: 110,
  updatedAtMs: 200 + index,
});

describe("verified Wanted download fulfillment", () => {
  it("retires a matching release only after every expected file verifies", () => {
    expect(verifiedDownloadedWantedAlbumIds([album()], [transfer(1), transfer(2)]))
      .toEqual(["release-group-unveiled"]);

    const missing = transfer(2);
    missing.verificationStatus = "missing";
    expect(verifiedDownloadedWantedAlbumIds([album()], [transfer(1), missing]))
      .toEqual([]);
  });

  it("keeps incomplete or failed-Soundcheck releases in Wanted", () => {
    expect(verifiedDownloadedWantedAlbumIds([album()], [transfer(1)])).toEqual([]);

    const failed = transfer(2);
    failed.soundcheck = { ...failed.soundcheck!, status: "failed", issues: ["Decoder stopped early."] };
    expect(verifiedDownloadedWantedAlbumIds([album()], [transfer(1), failed]))
      .toEqual([]);
  });

  it("does not let an old verified download retire a newly re-added watch", () => {
    expect(verifiedDownloadedWantedAlbumIds([album(500)], [transfer(1), transfer(2)]))
      .toEqual([]);
  });

  it("recognizes legacy download history by its canonical title", () => {
    const legacy = [transfer(1), transfer(2)].map((item) => ({
      ...item,
      releaseGroupId: null,
    }));
    expect(verifiedDownloadedWantedAlbumIds([album()], legacy))
      .toEqual(["release-group-unveiled"]);
  });

  it("accepts size verification when automatic Soundcheck was disabled", () => {
    const unchecked = [transfer(1), transfer(2)].map((item) => ({
      ...item,
      soundcheck: null,
    }));
    expect(verifiedDownloadedWantedAlbumIds([album()], unchecked))
      .toEqual(["release-group-unveiled"]);
  });

  it("does not keep an audio album wanted because an optional companion moved", () => {
    const companion: Transfer = {
      ...transfer(2),
      id: "unveiled-cover",
      title: "cover.jpg",
      remoteFilename: "Music\\Unveiled\\cover.jpg",
      localPath: "C:\\Downloads\\Whitecross - Unveiled (1994)\\cover.jpg",
      verificationStatus: "missing",
      soundcheck: null,
    };
    expect(verifiedDownloadedWantedAlbumIds(
      [album()],
      [transfer(1), transfer(2), companion],
    )).toEqual(["release-group-unveiled"]);
  });
});
