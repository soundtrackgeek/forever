import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptSettings, defaultSettings, getSettingsState, resetSettingsState } from "../settings";
import { SmartDownloadsPanel } from "./SmartDownloadsPanel";

beforeEach(() => { resetSettingsState(); acceptSettings(defaultSettings()); });

const smart = () => getSettingsState().settings.wanted.smart;

describe("Smart downloads settings", () => {
  it("ships switched off with a 20 minute patience and the strict length window", () => {
    render(<SmartDownloadsPanel />);
    expect(screen.getByRole("checkbox", { name: "Download Wanted albums automatically" })).not.toBeChecked();
    expect(screen.getByLabelText("Stall timeout")).toHaveValue("20");
    expect(screen.getByLabelText("Track length tolerance in seconds")).toHaveValue("3");
    expect(screen.getByLabelText("Tracks allowed to differ")).toHaveValue("0");
    expect(screen.getByLabelText("Sources to try per album")).toHaveValue("5");
  });

  it("saves each control without disturbing the others", async () => {
    render(<SmartDownloadsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Download Wanted albums automatically" }));
    fireEvent.change(screen.getByLabelText("Stall timeout"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Track length tolerance in seconds"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Tracks allowed to differ"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Sources to try per album"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Albums downloading at once"), { target: { value: "4" } });
    await waitFor(() => expect(smart()).toEqual({
      enabled: true, stallMinutes: 45, maxAttempts: 8, maxActiveAlbums: 4, durationToleranceSeconds: 8, allowedLengthMismatches: 2,
    }));
  });

  it("saves the preferred format and lossy fallback as the default Wanted profile", async () => {
    render(<SmartDownloadsPanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Lossless only/ }));
    await waitFor(() => expect(getSettingsState().settings.wanted.defaultPreferences.formatPreference).toBe("losslessOnly"));
    expect(screen.getByLabelText("Lossy fallback bitrate")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Prefer FLAC/ }));
    fireEvent.change(screen.getByLabelText("Lossy fallback bitrate"), { target: { value: "256" } });
    await waitFor(() => expect(getSettingsState().settings.wanted.defaultPreferences).toMatchObject({ formatPreference: "preferLossless", minimumBitrateKbps: 256 }));
  });

  it("keeps an unusual imported value selectable instead of silently changing it", () => {
    const settings = defaultSettings();
    settings.wanted.smart = { ...settings.wanted.smart, stallMinutes: 37 };
    acceptSettings({ ...settings, revision: 1 });
    render(<SmartDownloadsPanel />);
    expect(screen.getByLabelText("Stall timeout")).toHaveValue("37");
  });

  it("toggles the completion notification preference", async () => {
    render(<SmartDownloadsPanel />);
    const box = screen.getByRole("checkbox", { name: "Notify when a download is verified" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(getSettingsState().settings.preferences.downloadNotificationsEnabled).toBe(false));
  });

  it("copies the profile onto albums that are already wanted", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<SmartDownloadsPanel waitingAlbums={3} onApplyProfile={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to the 3 albums still wanted" }));
    expect(apply).toHaveBeenCalledWith(defaultSettings().wanted.defaultPreferences);
    expect(await screen.findByRole("status")).toHaveTextContent("Applied to 3 albums.");
  });

  it("offers no bulk apply when nothing is waiting, and shows a failure", async () => {
    const { rerender } = render(<SmartDownloadsPanel waitingAlbums={0} onApplyProfile={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Apply to the/ })).toBeNull();
    rerender(<SmartDownloadsPanel waitingAlbums={1} onApplyProfile={vi.fn().mockRejectedValue(new Error("Backend is busy"))} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to the 1 album still wanted" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend is busy");
  });
});
