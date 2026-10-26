import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { emptyCounts, emptySnapshot, type StatisticsSnapshot } from "../utils/statistics";

const REFRESH_MS = 60_000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The browser preview has no database, so it shows a believable month.
const previewSnapshot = (): StatisticsSnapshot => {
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - index));
    const wave = Math.abs(Math.sin(index * 1.7));
    return {
      ...emptyCounts,
      day: date.toISOString().slice(0, 10),
      downBytes: Math.round(wave * 900_000_000),
      downFiles: Math.round(wave * 24),
      upBytes: Math.round(Math.abs(Math.cos(index * 1.1)) * 260_000_000),
      wantedFulfilled: index % 6 === 0 ? 1 : 0,
    };
  });
  const sum = (key: "downBytes" | "downFiles" | "upBytes" | "wantedFulfilled") =>
    daily.reduce((total, day) => total + day[key], 0);
  return {
    trackedSince: daily[0].day,
    totals: {
      ...emptyCounts,
      downBytes: sum("downBytes"),
      downFiles: sum("downFiles"),
      upBytes: sum("upBytes"),
      upFiles: 112,
      downFailures: 19,
      wantedAdded: 14,
      wantedChecks: 260,
      wantedHits: 71,
      wantedFulfilled: sum("wantedFulfilled"),
      foundAfterMsTotal: sum("wantedFulfilled") * 36 * 3_600_000,
      soundcheckPassed: 61,
      soundcheckReview: 7,
      soundcheckFailed: 2,
      reachableChecks: 5,
      blockedChecks: 1,
    },
    daily,
    topSources: [
      { username: "vinylhoarder", files: 88, bytes: 3_400_000_000, failures: 4, reliability: 88 / 92, speedBytesPerSecond: 1_850_000 },
      { username: "nightshift_fm", files: 41, bytes: 1_700_000_000, failures: 9, reliability: 41 / 50, speedBytesPerSecond: 420_000 },
      { username: "quietroom", files: 17, bytes: 640_000_000, failures: 0, reliability: 1, speedBytesPerSecond: null },
    ],
  };
};

export function useStatistics() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot>(() => (native ? emptySnapshot : previewSnapshot()));
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((value) => value + 1), []);

  useEffect(() => {
    if (!native) return;
    let active = true;
    const load = async () => {
      try {
        const next = await invoke<StatisticsSnapshot>("stats_snapshot");
        if (!active) return;
        setSnapshot(next);
        setError(null);
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        if (active) setReady(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [native, reload]);

  return { snapshot, ready, error, preview: !native, refresh };
}
