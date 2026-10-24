import type { ReleaseAlternativeSource, SourceReliability, Transfer } from "../types";

export const sourceMemory = (memory: Record<string, SourceReliability>, user: string) => memory[user.toLowerCase()];
export const flakySource = (r?: SourceReliability) => !!r && r.failures >= 3 && r.failures > r.successes;
export const reliabilityScore = (r?: SourceReliability) => r
  ? Math.round(1500 * (r.successes + 1) / (r.successes + r.failures + 2)) - 750
    - Math.min(500, r.denials * 100) - Math.min(500, r.typicalStartDelayMs / 1000)
    - Math.min(200, (r.sonicObservations?.filter((item) => item.concern).length ?? 0) * 25)
  : 0;
export const reliabilityDescription = (r: SourceReliability) => {
  const outcomes = r.successes + r.failures;
  const sonic = r.sonicObservations ?? [];
  return `${outcomes ? Math.round(r.successes / outcomes * 100) : 0}% successful attempts · ${r.successes} completed · ${r.failures} failed · ${r.denials} denied${r.starts ? ` · typical start ${Math.ceil(r.typicalStartDelayMs / 60_000)} min` : ""}${sonic.length ? ` · ${sonic.filter((item) => item.concern).length}/${sonic.length} sonic reviews (advisory)` : ""}. Observed on this computer.`;
};

export function stalledForRecovery(transfers: Transfer[], minutes: number, now: number) {
  return minutes > 0 && !transfers.some((t) => ["downloading", "paused"].includes(t.status) || (t.automaticSources?.length ?? 0) >= 4)
    && transfers.some((t) => t.status !== "completed" && t.waitingSinceMs != null && now - t.waitingSinceMs >= minutes * 60_000);
}

export function exactMirror(transfers: Transfer[], source: ReleaseAlternativeSource) {
  if (transfers.some((t) => t.username.toLowerCase() === source.username.toLowerCase()
    || t.automaticSources?.some((u) => u.toLowerCase() === source.username.toLowerCase()))) return false;
  const unfinished = transfers.filter((t) => t.status !== "completed");
  const basename = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();
  const used = new Set<number>();
  return unfinished.length > 0 && unfinished.every((t) => {
    const matches = source.files.flatMap((file, index) => file.sizeBytes === t.sizeBytes && basename(file.remoteFilename) === basename(t.remoteFilename) ? [index] : []);
    if (matches.length !== 1 || used.has(matches[0])) return false;
    used.add(matches[0]); return true;
  });
}
