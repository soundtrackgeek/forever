import { describe, expect, it } from "vitest";
import {
  cumulativeFulfilled,
  deriveInsights,
  emptyCounts,
  emptySnapshot,
  formatDuration,
  formatStatBytes,
  percent,
  type StatisticsSnapshot,
} from "./statistics";

const snapshot = (totals: Partial<typeof emptyCounts>): StatisticsSnapshot => ({
  ...emptySnapshot,
  totals: { ...emptyCounts, ...totals },
});

describe("statistics insights", () => {
  it("reports no ratios before there is anything to divide", () => {
    const insights = deriveInsights(emptySnapshot);
    expect(insights.hasActivity).toBe(false);
    expect(insights.shareRatio).toBeNull();
    expect(insights.wantedHitRate).toBeNull();
    expect(insights.averageTimeToFindMs).toBeNull();
    expect(insights.soundcheckPassRate).toBeNull();
    expect(insights.reachableShare).toBeNull();
    expect(insights.downloadSuccessRate).toBeNull();
  });

  it("derives ratios and rates from the totals", () => {
    const insights = deriveInsights(
      snapshot({
        downBytes: 4_000,
        upBytes: 1_000,
        downFiles: 3,
        downFailures: 1,
        wantedChecks: 10,
        wantedHits: 4,
        wantedFulfilled: 2,
        foundAfterMsTotal: 7_200_000,
        soundcheckPassed: 3,
        soundcheckReview: 1,
        soundcheckFailed: 0,
        reachableChecks: 3,
        blockedChecks: 1,
      }),
    );
    expect(insights.hasActivity).toBe(true);
    expect(insights.shareRatio).toBe(0.25);
    expect(insights.downloadSuccessRate).toBe(0.75);
    expect(insights.wantedHitRate).toBe(0.4);
    expect(insights.averageTimeToFindMs).toBe(3_600_000);
    expect(insights.soundcheckPassRate).toBe(0.75);
    expect(insights.soundcheckTotal).toBe(4);
    expect(insights.reachableShare).toBe(0.75);
  });

  it("accumulates fulfilled albums across the chart window", () => {
    const day = (name: string, wantedFulfilled: number) => ({ ...emptyCounts, day: name, wantedFulfilled });
    expect(cumulativeFulfilled([day("a", 1), day("b", 0), day("c", 2)]).map((point) => point.value)).toEqual([1, 1, 3]);
  });

  it("formats sizes, durations and percentages", () => {
    expect(formatStatBytes(999)).toBe("999 B");
    expect(formatStatBytes(1_500)).toBe("1.50 KB");
    expect(formatStatBytes(12_300_000_000)).toBe("12.3 GB");
    expect(formatDuration(10_000)).toBe("under a minute");
    expect(formatDuration(90 * 60_000)).toBe("2 h");
    expect(formatDuration(5 * 24 * 3_600_000)).toBe("5 days");
    expect(percent(0.456)).toBe("46%");
    expect(percent(null)).toBe("—");
  });
});
