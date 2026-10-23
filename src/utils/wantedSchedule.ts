import type { WantedSnapshot } from "../types";

export const wantedScheduleStatus = (wanted: WantedSnapshot, online: boolean) => {
  if (!online) return "Paused";
  if (!wanted.intervalMinutes) return "Manual";
  if (wanted.wishlistIntervalSeconds == null) return "Waiting";
  if (!wanted.wishlistIntervalSeconds) return "Disabled";
  return "Live";
};

const duration = (minutes: number) => minutes >= 60
  ? `${Math.ceil(minutes / 6) / 10} h`
  : `${Math.ceil(minutes)} min`;

export const wantedScheduleLabel = (wanted: WantedSnapshot, online: boolean) => {
  if (!wanted.intervalMinutes) return "Automatic checks are off. Manual checks share the search budget.";
  if (!online) return "Background checks resume after reconnecting and receiving the server’s wishlist interval.";
  if (wanted.wishlistIntervalSeconds == null) return "Waiting for the server’s wishlist interval before checking automatically.";
  if (!wanted.wishlistIntervalSeconds) return "The server has disabled wishlist checks. Manual checks remain available.";
  if (wanted.effectiveCadenceMinutes == null) return "No active albums to check. Paused and fulfilled albums do not use wishlist slots.";
  const next = wanted.nextCheckAtMs == null ? "" : ` Next slot no earlier than ${new Date(wanted.nextCheckAtMs).toLocaleString()}.`;
  return `Capacity: ≈ every ${duration(wanted.effectiveCadenceMinutes)} at current list size. One query per ${duration(wanted.wishlistIntervalSeconds / 60)} server slot; empty albums can need up to three slots. Quiet albums back off to 1 h, 6 h, then 24 h.${next} Other searches can delay checks.`;
};
