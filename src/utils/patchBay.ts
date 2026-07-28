import type { AlbumTrack, SearchResult, Transfer } from "../types";
import { isAudioTransfer } from "./soundcheck";

export type PatchBayIssueState =
  | "ready"
  | "queued"
  | "downloading"
  | "rechecking"
  | "repaired"
  | "attention";

export type PatchBayCandidate = {
  result: SearchResult;
  score: number;
  confidence: "strong" | "possible" | "caution";
  warnings: string[];
  sameFormat: boolean;
};

export type PatchBayIssue = {
  id: string;
  transferId: string | null;
  trackNumber: number | null;
  title: string;
  reason: string;
  state: PatchBayIssueState;
  transfer: Transfer | null;
  candidates: PatchBayCandidate[];
};

const audioFormats = new Set([
  "aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp4", "mp3", "oga", "ogg", "opus", "wav", "wma", "wv",
]);

const basename = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() ?? value;
const extension = (value: string) => basename(value).split(".").pop()?.toLocaleLowerCase() ?? "";

const trackNumberFromName = (value: string) => {
  const match = /^(?:cd\s*\d+[\s._-]*)?(\d{1,3})(?:\D|$)/i.exec(basename(value));
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? number : null;
};

const normalizedTitle = (value: string) => basename(value)
  .replace(/\.[^.]+$/, "")
  .replace(/^(?:cd\s*\d+[\s._-]*)?\d{1,3}(?:\s*[-._)]\s*|\s+)/i, "")
  .replace(/\b(?:disc|disk|cd)\s*\d+\b/gi, "")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const words = (value: string) => new Set(normalizedTitle(value).split(/\s+/).filter((word) => word.length > 1));

const titleSimilarity = (left: string, right: string) => {
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.size || !rightWords.size) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / Math.max(leftWords.size, rightWords.size);
};

export const patchTrackNumber = (transfer: Transfer) =>
  transfer.soundcheck?.trackNumber
  ?? trackNumberFromName(transfer.remoteFilename);

const issueReason = (transfer: Transfer) => {
  if (transfer.patchRepair && transfer.soundcheck?.status === "failed") {
    return transfer.soundcheck.issues[0] ?? "The replacement did not pass Deep Soundcheck.";
  }
  if (transfer.patchRepair && transfer.status === "failed") {
    return transfer.error ?? "The replacement transfer failed.";
  }
  if (transfer.patchRepair) return transfer.patchRepair.reason;
  if (transfer.status === "failed") return transfer.error ?? "The original transfer failed.";
  if (transfer.verificationStatus === "missing") return "The completed file is missing from the release folder.";
  if (transfer.verificationStatus === "sizeMismatch") return transfer.verificationMessage ?? "The completed file has an unexpected size.";
  if (transfer.soundcheck?.status === "failed") return transfer.soundcheck.issues[0] ?? "Soundcheck could not read this audio file.";
  return null;
};

export const patchIssueState = (transfer: Transfer): PatchBayIssueState => {
  if (!transfer.patchRepair) return "ready";
  if (["queued", "retrying", "paused"].includes(transfer.status)) return "queued";
  if (["requesting", "remotelyQueued", "connecting", "downloading"].includes(transfer.status)) return "downloading";
  if (transfer.status === "failed" || transfer.soundcheck?.status === "failed") return "attention";
  if (transfer.status === "completed" && transfer.patchRepair.repairedAtMs) {
    return transfer.soundcheck ? "repaired" : "rechecking";
  }
  return "ready";
};

const candidateFor = (
  result: SearchResult,
  transfer: Transfer | null,
  trackNumber: number | null,
  title: string,
  preferredFormat: string | null = null,
): PatchBayCandidate | null => {
  if (result.source !== "live" || !result.filename || !result.sizeBytes) return null;
  const candidateFormat = extension(result.filename);
  if (!audioFormats.has(candidateFormat)) return null;
  const targetFormat = transfer ? extension(transfer.remoteFilename) : preferredFormat;
  const candidateTrack = trackNumberFromName(result.filename);
  const similarity = !/^Missing track\s+\d+$/i.test(title)
    ? titleSimilarity(title, result.filename)
    : 0;
  let score = 0;
  const warnings: string[] = [];

  if (trackNumber && candidateTrack === trackNumber) score += 52;
  else if (trackNumber && candidateTrack) warnings.push(`Track number is ${candidateTrack}, expected ${trackNumber}.`);
  else if (trackNumber) warnings.push("Track number could not be confirmed from the filename.");

  if (similarity >= 0.8) score += 34;
  else if (similarity >= 0.5) score += 23;
  else if (similarity > 0) score += Math.round(similarity * 20);

  const sameFormat = !targetFormat || targetFormat === candidateFormat;
  if (sameFormat) score += 18;
  else warnings.push(`Format changes from ${targetFormat.toUpperCase()} to ${candidateFormat.toUpperCase()}.`);

  const originalDuration = transfer?.soundcheck?.durationSeconds;
  if (originalDuration && result.durationSeconds) {
    const delta = Math.abs(originalDuration - result.durationSeconds);
    if (delta <= 3) score += 12;
    else if (delta <= 10) score += 6;
    else if (delta > Math.max(20, originalDuration * 0.08)) warnings.push(`Duration differs by ${Math.round(delta)} seconds.`);
  }
  if (transfer?.soundcheck?.sampleRate && result.sampleRate && transfer.soundcheck.sampleRate !== result.sampleRate) {
    warnings.push(`Sample rate changes from ${(transfer.soundcheck.sampleRate / 1000).toFixed(1)} to ${(result.sampleRate / 1000).toFixed(1)} kHz.`);
  }
  if (transfer?.soundcheck?.bitsPerSample && result.bitDepth && transfer.soundcheck.bitsPerSample !== result.bitDepth) {
    warnings.push(`Bit depth changes from ${transfer.soundcheck.bitsPerSample} to ${result.bitDepth}-bit.`);
  }

  const identityMatch = !trackNumber || candidateTrack === trackNumber || similarity >= 0.5;
  if (!identityMatch) return null;
  return {
    result,
    score,
    confidence: score >= 80 && warnings.length === 0 ? "strong" : score >= 55 ? "possible" : "caution",
    warnings,
    sameFormat,
  };
};

const candidatesFor = (
  results: SearchResult[],
  transfer: Transfer | null,
  trackNumber: number | null,
  title: string,
  preferredFormat: string | null = null,
) => results
  .flatMap((result) => {
    const candidate = candidateFor(result, transfer, trackNumber, title, preferredFormat);
    return candidate ? [candidate] : [];
  })
  .sort((left, right) => right.score - left.score || Number(right.result.slotFree) - Number(left.result.slotFree))
  .filter((candidate, index, candidates) => candidates.findIndex((other) =>
    other.result.owner.toLocaleLowerCase() === candidate.result.owner.toLocaleLowerCase()
      && other.result.filename?.toLocaleLowerCase() === candidate.result.filename?.toLocaleLowerCase(),
  ) === index)
  .slice(0, 4);

export function buildPatchBayIssues(
  transfers: Transfer[],
  results: SearchResult[],
  officialTracks: AlbumTrack[] = [],
): PatchBayIssue[] {
  const audio = transfers.filter(isAudioTransfer);
  const issues = audio.flatMap((transfer): PatchBayIssue[] => {
    const reason = issueReason(transfer);
    if (!reason) return [];
    const trackNumber = patchTrackNumber(transfer);
    const official = trackNumber ? officialTracks.find((track) => track.position === trackNumber) : null;
    const title = official ? `${String(trackNumber).padStart(2, "0")} - ${official.title}` : transfer.title;
    return [{
      id: transfer.id,
      transferId: transfer.id,
      trackNumber,
      title,
      reason,
      state: patchIssueState(transfer),
      transfer,
      candidates: candidatesFor(results, transfer, trackNumber, title),
    }];
  });

  const expected = audio.find((transfer) => transfer.expectedTrackCount)?.expectedTrackCount ?? null;
  const formatCounts = audio.reduce<Map<string, number>>((counts, transfer) => {
    const format = extension(transfer.remoteFilename);
    counts.set(format, (counts.get(format) ?? 0) + 1);
    return counts;
  }, new Map());
  const preferredFormat = [...formatCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const numberedAudio = audio.filter((transfer) => patchTrackNumber(transfer) !== null);
  if (expected && expected <= 300 && numberedAudio.length === audio.length) {
    const present = new Set(audio.flatMap((transfer) => {
      const number = patchTrackNumber(transfer);
      return number ? [number] : [];
    }));
    for (let number = 1; number <= expected; number += 1) {
      if (present.has(number)) continue;
      const official = officialTracks.find((track) => track.position === number);
      const title = official
        ? `${String(number).padStart(2, "0")} - ${official.title}`
        : `Missing track ${String(number).padStart(2, "0")}`;
      issues.push({
        id: `missing:${number}`,
        transferId: null,
        trackNumber: number,
        title,
        reason: official
          ? `“${official.title}” is absent from the official ${expected}-track sequence.`
          : `Track ${number} is absent from the expected ${expected}-track sequence.`,
        state: "ready",
        transfer: null,
        candidates: candidatesFor(results, null, number, title, preferredFormat),
      });
    }
  }

  return issues.sort((left, right) => (left.trackNumber ?? 999) - (right.trackNumber ?? 999));
}
