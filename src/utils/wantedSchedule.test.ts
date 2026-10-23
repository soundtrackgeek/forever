import { describe, expect, it } from "vitest";
import type { WantedSnapshot } from "../types";
import { wantedScheduleLabel, wantedScheduleStatus } from "./wantedSchedule";

const snapshot: WantedSnapshot = {
  albums: [], defaultPreferences: { formatPreference: "any", minimumBitrateKbps: null, minimumTrackCount: null },
  intervalMinutes: 30, activeAlbumId: null, nextCheckAtMs: null, updatedAtMs: 0,
  wishlistIntervalSeconds: 720, effectiveCadenceMinutes: 6_000, checkQueued: false,
};

describe("Wanted schedule promises", () => {
  it("reports a 500-album server-paced rotation, not the preferred 30 minutes", () => {
    expect(wantedScheduleLabel(snapshot, true)).toContain("≈ every 100 h");
    expect(wantedScheduleLabel(snapshot, true)).toContain("One album per 12 min server slot");
    expect(wantedScheduleLabel(snapshot, true)).toContain("Other searches can delay checks");
  });

  it("distinguishes offline, unannounced, disabled and manual scheduling", () => {
    expect(wantedScheduleStatus(snapshot, false)).toBe("Paused");
    const waiting = { ...snapshot, wishlistIntervalSeconds: null };
    expect(wantedScheduleStatus(waiting, true)).toBe("Waiting");
    expect(wantedScheduleLabel(waiting, true)).toContain("Waiting for the server");
    const disabled = { ...snapshot, wishlistIntervalSeconds: 0 };
    expect(wantedScheduleStatus(disabled, true)).toBe("Disabled");
    expect(wantedScheduleLabel(disabled, true)).toContain("Manual checks remain available");
    const manual = { ...snapshot, intervalMinutes: 0 as const };
    expect(wantedScheduleStatus(manual, true)).toBe("Manual");
    expect(wantedScheduleLabel(manual, true)).toContain("Automatic checks are off");
    expect(wantedScheduleLabel({ ...snapshot, effectiveCadenceMinutes: null }, true)).toContain("No active albums");
  });
});
