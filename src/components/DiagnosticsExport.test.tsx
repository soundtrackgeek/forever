import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DiagnosticsExport } from "./DiagnosticsExport";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), native: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => mocks.native }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
beforeEach(() => { mocks.native = true; mocks.invoke.mockReset(); mocks.save.mockReset(); });

it("waits for the native save and export, prevents duplicate clicks, and reports success", async () => {
  let finish!: () => void;
  mocks.save.mockResolvedValue("C:\\Reports\\diagnostics.zip");
  mocks.invoke.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<DiagnosticsExport />);
  fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
  expect(screen.getByRole("button", { name: "Exporting diagnostics…" })).toBeDisabled();
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("diagnostics_export", { path: "C:\\Reports\\diagnostics.zip" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Exporting diagnostics…" }));
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole("status")).toHaveTextContent("Diagnostics saved. Nothing was uploaded.");
});

it("cancels without invoking the backend or claiming a saved file", async () => {
  mocks.save.mockResolvedValue(null); render(<DiagnosticsExport />);
  fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Export diagnostics" })).toBeEnabled());
  expect(mocks.invoke).not.toHaveBeenCalled(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows failures and allows retry", async () => {
  mocks.save.mockResolvedValue("C:\\Reports\\diagnostics.zip");
  mocks.invoke.mockRejectedValueOnce("Could not write diagnostics.").mockResolvedValueOnce(undefined);
  render(<DiagnosticsExport />); fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not write diagnostics.");
  fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
  await screen.findByRole("status"); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not offer a fabricated export in browser preview", () => {
  mocks.native = false; render(<DiagnosticsExport />);
  expect(screen.getByRole("button", { name: "Export diagnostics" })).toBeDisabled();
  expect(screen.getByText(/available in the desktop app/)).toBeInTheDocument();
});
