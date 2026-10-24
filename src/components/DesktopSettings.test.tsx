import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DesktopSettings } from "./DesktopSettings";
import { defaultSettings, resetSettingsState } from "../settings";

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
beforeEach(() => {
  resetSettingsState(); isTauri.mockReturnValue(true);
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "desktop_status") return { trayAvailable: true, autostartEnabled: false };
    if (command === "desktop_set_autostart") return { trayAvailable: true, autostartEnabled: args.enabled };
    if (command === "settings_patch") return { ...defaultSettings(), revision: 1, desktop: { ...defaultSettings().desktop, ...args.patch } };
  });
});

it("reads OS startup status without enabling it, and applies explicit changes", async () => {
  render(<DesktopSettings />);
  const startup = screen.getByLabelText("Start Forever when I sign in");
  await waitFor(() => expect(startup).toBeEnabled());
  expect(startup).not.toBeChecked(); expect(invoke).not.toHaveBeenCalledWith("desktop_set_autostart", expect.anything());
  fireEvent.click(startup);
  await waitFor(() => expect(startup).toBeChecked());
  expect(invoke).toHaveBeenCalledWith("desktop_set_autostart", { enabled: true });
  fireEvent.click(screen.getByLabelText("Keep Forever running in the tray when I close the window"));
  await waitFor(() => expect(screen.getByLabelText("Keep Forever running in the tray when I close the window")).not.toBeChecked());
  fireEvent.click(screen.getByRole("button", { name: "Quit Forever…" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("desktop_request_quit"));
});

it("retains actual startup state and reports registration failures", async () => {
  render(<DesktopSettings />);
  const startup = screen.getByLabelText("Start Forever when I sign in");
  await waitFor(() => expect(startup).toBeEnabled());
  invoke.mockRejectedValueOnce(new Error("Access denied")); fireEvent.click(startup);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Access denied"));
  expect(startup).not.toBeChecked();
});

it("explains the safe fallback when there is no tray and disables native actions in preview", async () => {
  invoke.mockResolvedValueOnce({ trayAvailable: false, autostartEnabled: false });
  const view = render(<DesktopSettings />);
  await screen.findByText(/tray is unavailable/); view.unmount();
  isTauri.mockReturnValue(false); render(<DesktopSettings />);
  expect(screen.getByLabelText("Start Forever when I sign in")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Quit Forever…" })).toBeDisabled();
});
