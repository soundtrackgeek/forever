import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsPortability } from "./SettingsPortability";
import { acceptSettings, defaultSettings, getSettingsState } from "../settings";

it("reviews an import before applying it and rejects an unsupported version without changing settings", async () => {
  const onApplied = vi.fn(); render(<SettingsPortability onApplied={onApplied} />);
  const settings = defaultSettings(); settings.preferences.musicBrainzFallbackTrackCount = 24;
  const upload = (value: unknown) => fireEvent.change(screen.getByLabelText("Settings file to import"), { target: { files: [{ size: 100, text: async () => JSON.stringify(value) }] } });
  upload(settings);
  await screen.findByRole("region", { name: "Review settings import" });
  expect(getSettingsState().settings.preferences.musicBrainzFallbackTrackCount).toBe(10);
  fireEvent.click(screen.getByRole("button", { name: "Apply imported settings" }));
  await screen.findByText(/Settings imported/); expect(getSettingsState().settings.preferences.musicBrainzFallbackTrackCount).toBe(24);
  expect(onApplied).toHaveBeenCalledOnce();
  upload({ ...settings, version: 99 });
  await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "Apply imported settings" })).not.toBeInTheDocument();
  expect(getSettingsState().settings.preferences.musicBrainzFallbackTrackCount).toBe(24);
  upload({ ...settings, sharing: { ...settings.sharing, roots: [null] } });
  await screen.findByRole("alert");
  expect(screen.queryByRole("region", { name: "Review settings import" })).not.toBeInTheDocument();
});

it("resets only the chosen section after showing its effect", async () => {
  const settings = defaultSettings(); settings.preferences.messageNotificationsEnabled = false; settings.transfers.maxConcurrentDownloads = 6;
  act(() => acceptSettings(settings)); render(<SettingsPortability />);
  fireEvent.change(screen.getByLabelText("Reset section to defaults"), { target: { value: "transfers" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset selected section" }));
  expect(screen.getByText(/Transfer history is kept/)).toBeInTheDocument(); expect(getSettingsState().settings.transfers.maxConcurrentDownloads).toBe(6);
  fireEvent.click(screen.getByRole("button", { name: "Confirm section reset" }));
  await waitFor(() => expect(getSettingsState().settings.transfers.maxConcurrentDownloads).toBe(3));
  expect(getSettingsState().settings.preferences.messageNotificationsEnabled).toBe(false);
});
