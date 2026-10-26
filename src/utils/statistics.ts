export type StatCounts = {
  downBytes: number;
  downFiles: number;
  upBytes: number;
  upFiles: number;
  downFailures: number;
  wantedAdded: number;
  wantedChecks: number;
  wantedHits: number;
  wantedFulfilled: number;
  foundAfterMsTotal: number;
  soundcheckPassed: number;
  soundcheckReview: number;
  soundcheckFailed: number;
  reachableChecks: number;
  blockedChecks: number;
};

export type StatDay = StatCounts & { day: string };

export type StatSource = {
  username: string;
  files: number;
  bytes: number;
  failures: number;
  reliability: number | null;
  speedBytesPerSecond: number | null;
};

export type StatisticsSnapshot = {
  trackedSince: string | null;
  totals: StatCounts;
  daily: StatDay[];
  topSources: StatSource[];
};

export const emptyCounts: StatCounts = {
  downBytes: 0,
  downFiles: 0,
  upBytes: 0,
  upFiles: 0,
  downFailures: 0,
  wantedAdded: 0,
  wantedChecks: 0,
  wantedHits: 0,
  wantedFulfilled: 0,
  foundAfterMsTotal: 0,
  soundcheckPassed: 0,
  soundcheckReview: 0,
  soundcheckFailed: 0,
  reachableChecks: 0,
  blockedChecks: 0,
};

export const emptySnapshot: StatisticsSnapshot = {
  trackedSince: null,
  totals: emptyCounts,
  daily: [],
  topSources: [],
};

export const formatStatSpeed = (bytesPerSecond: number) => `${formatStatBytes(bytesPerSecond)}/s`;

export const formatStatBytes = (bytes: number) => {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_000;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_000; index += 1) {
    value /= 1_000;
    unit = units[index];
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};

export const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
};

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export type Insights = {
  hasActivity: boolean;
  /** Uploaded over downloaded bytes; null until something has been downloaded. */
  shareRatio: number | null;
  wantedHitRate: number | null;
  averageTimeToFindMs: number | null;
  soundcheckPassRate: number | null;
  soundcheckTotal: number;
  reachableShare: number | null;
  /** Downloads that finished over finished plus failed attempts. */
  downloadSuccessRate: number | null;
};

export const deriveInsights = (snapshot: StatisticsSnapshot): Insights => {
  const t = snapshot.totals;
  const soundcheckTotal = t.soundcheckPassed + t.soundcheckReview + t.soundcheckFailed;
  return {
    hasActivity:
      t.downFiles + t.upFiles + t.downFailures + t.wantedAdded + t.wantedChecks + soundcheckTotal + t.reachableChecks + t.blockedChecks > 0,
    shareRatio: t.downBytes > 0 ? t.upBytes / t.downBytes : null,
    wantedHitRate: rate(t.wantedHits, t.wantedChecks),
    averageTimeToFindMs: t.wantedFulfilled > 0 ? t.foundAfterMsTotal / t.wantedFulfilled : null,
    soundcheckPassRate: rate(t.soundcheckPassed, soundcheckTotal),
    soundcheckTotal,
    reachableShare: rate(t.reachableChecks, t.reachableChecks + t.blockedChecks),
    downloadSuccessRate: rate(t.downFiles, t.downFiles + t.downFailures),
  };
};

/** Running total of Wanted albums fulfilled by day, for the collection line. */
export const cumulativeFulfilled = (daily: StatDay[]) => {
  let running = 0;
  return daily.map((day) => {
    running += day.wantedFulfilled;
    return { day: day.day, value: running };
  });
};

export const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
