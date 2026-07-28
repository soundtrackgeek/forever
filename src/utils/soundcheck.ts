import type { SoundcheckResult, Transfer } from "../types";

export type ReleaseSoundcheckState = "pending" | "passed" | "review" | "failed";

export type ReleaseSoundcheck = {
  state: ReleaseSoundcheckState;
  audio: Transfer[];
  checkedCount: number;
  passedCount: number;
  reviewCount: number;
  failedCount: number;
  expectedTrackCount: number | null;
  issues: string[];
  deep: boolean;
};

const AUDIO_FORMATS = new Set([
  "aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp4", "mp3", "oga", "ogg", "opus", "wav", "wma", "wv",
]);

export const isAudioTransfer = (transfer: Transfer) =>
  AUDIO_FORMATS.has(transfer.remoteFilename.split(".").pop()?.toLocaleLowerCase() ?? "");

const countResult = (results: SoundcheckResult[], status: SoundcheckResult["status"]) =>
  results.filter((result) => result.status === status).length;

const uniqueIssues = (issues: string[]) => [...new Set(issues)];

export function summarizeSoundcheck(transfers: Transfer[]): ReleaseSoundcheck {
  const audio = transfers.filter(isAudioTransfer);
  const results = audio.flatMap((transfer) => transfer.soundcheck ? [transfer.soundcheck] : []);
  const expectedTrackCount = transfers.find((transfer) => transfer.expectedTrackCount)?.expectedTrackCount ?? null;
  const issues = results.flatMap((result) => result.issues);
  const failedCount = countResult(results, "failed");
  const reviewCount = countResult(results, "review") + countResult(results, "unsupported");
  const passedCount = countResult(results, "passed");

  if (expectedTrackCount && audio.length !== expectedTrackCount) {
    issues.push(`Expected ${expectedTrackCount} audio tracks, but found ${audio.length}.`);
  }

  const numbered = results.flatMap((result) => result.trackNumber ? [result.trackNumber] : []);
  const duplicates = [...new Set(numbered.filter((number, index) => numbered.indexOf(number) !== index))]
    .sort((left, right) => left - right);
  if (duplicates.length) issues.push(`Duplicate track numbers: ${duplicates.join(", ")}.`);

  if (expectedTrackCount && numbered.length === audio.length) {
    const present = new Set(numbered);
    const missing = Array.from({ length: expectedTrackCount }, (_, index) => index + 1)
      .filter((number) => !present.has(number));
    if (missing.length) issues.push(`Missing track numbers: ${missing.join(", ")}.`);
  }

  const structuralIssue = Boolean(
    (expectedTrackCount && audio.length !== expectedTrackCount) || duplicates.length,
  );
  let state: ReleaseSoundcheckState = "pending";
  if (failedCount || structuralIssue) state = "failed";
  else if (reviewCount || issues.length) state = "review";
  else if (audio.length > 0 && results.length === audio.length && passedCount === audio.length) state = "passed";

  return {
    state,
    audio,
    checkedCount: results.length,
    passedCount,
    reviewCount,
    failedCount,
    expectedTrackCount,
    issues: uniqueIssues(issues),
    deep: results.length > 0 && results.every((result) => result.deep),
  };
}

