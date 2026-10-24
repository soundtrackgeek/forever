import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type BandwidthLimits = { totalKib: number; downloadKib: number; uploadKib: number };
export type BandwidthSettings = { manualPaused: boolean; normal: BandwidthLimits; alternate: BandwidthLimits; scheduleEnabled: boolean; startMinute: number; endMinute: number; pauseOnMetered: boolean };
export type BandwidthSnapshot = { manualPaused?: boolean; revision: number; alternateActive: boolean; limits: BandwidthLimits; networkCost: "unknown" | "unmetered" | "metered"; paused: boolean };
export const defaultBandwidth = (): BandwidthSettings => ({ manualPaused: false, normal: { totalKib: 0, downloadKib: 0, uploadKib: 0 }, alternate: { totalKib: 0, downloadKib: 0, uploadKib: 0 }, scheduleEnabled: false, startMinute: 1380, endMinute: 420, pauseOnMetered: false });

export function validateBandwidth(value: BandwidthSettings) {
  if ([value.normal, value.alternate].some((limits) => Object.values(limits).some((v) => !Number.isInteger(v) || v < 0 || v > 1_000_000))) return "Bandwidth limits must be whole numbers from 0 to 1,000,000 KiB/s.";
  if ([value.startMinute, value.endMinute].some((v) => !Number.isInteger(v) || v < 0 || v >= 1440) || (value.scheduleEnabled && value.startMinute === value.endMinute)) return "Choose distinct schedule start and end times within one day.";
  return null;
}

export function useBandwidthStatus() {
  const [snapshot, setSnapshot] = useState<BandwidthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const accept = (next: BandwidthSnapshot) => {
      if (!disposed) setSnapshot((current) => current && current.revision > next.revision ? current : next);
    };
    void (async () => {
      const off = await listen<BandwidthSnapshot>("forever://bandwidth", (event) => accept(event.payload));
      if (disposed) { off(); return; }
      cleanup = off;
      accept(await invoke<BandwidthSnapshot>("bandwidth_snapshot"));
    })().catch((cause) => { if (!disposed) setError(String(cause)); });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  return { snapshot, error };
}

export function bandwidthSummary(snapshot: BandwidthSnapshot) {
  if (snapshot.manualPaused) return "All transfers paused - resume from the tray or Settings";
  if (snapshot.paused) return snapshot.networkCost === "metered" ? "Transfers held · metered network" : "Transfers held · network cost unknown";
  const limit = (n: number) => n ? `${n.toLocaleString()} KiB/s` : "unlimited";
  return `${snapshot.alternateActive ? "Alternate" : "Normal"} limits · combined ${limit(snapshot.limits.totalKib)} · download ${limit(snapshot.limits.downloadKib)} · upload ${limit(snapshot.limits.uploadKib)}`;
}
