import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import type { ArchiveStatus } from "../types";
import { ArchiveSourceControls } from "./ArchiveSourceControls";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const status: ArchiveStatus = {
  path: "C:\\Music\\catalog.sqlite3", pathSource: "automatic", settingsNotice: null,
  connected: true, readOnly: true, albumCount: 12, trackCount: 100,
  lastImportedAt: null, lastModifiedAtMs: null, error: null,
};

describe("Archive database selection", () => {
  beforeEach(() => { vi.mocked(open).mockReset(); });

  it("keeps the current source when the picker is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const select = vi.fn();
    render(<ArchiveSourceControls status={status} loading={false} onSelectDatabase={select} />);
    expect(screen.getByText("Detected automatically")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Choose database/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Choose database/ })).toBeEnabled());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: false, multiple: false }));
    expect(select).not.toHaveBeenCalled();
  });

  it("chooses a custom source and can return to automatic detection", async () => {
    vi.mocked(open).mockResolvedValue("D:\\Library\\music.sqlite3");
    const select = vi.fn(async () => status);
    const { rerender } = render(<ArchiveSourceControls status={status} loading={false} onSelectDatabase={select} />);
    fireEvent.click(screen.getByRole("button", { name: /Choose database/ }));
    await waitFor(() => expect(select).toHaveBeenCalledWith("D:\\Library\\music.sqlite3"));
    rerender(<ArchiveSourceControls status={{ ...status, pathSource: "custom" }} loading={false} onSelectDatabase={select} />);
    expect(screen.getByText("Custom database")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Use automatic location/ }));
    await waitFor(() => expect(select).toHaveBeenLastCalledWith(null));
  });

  it("shows rejected selections and recovery notices without changing the badge", async () => {
    vi.mocked(open).mockResolvedValue("C:\\bad.db");
    render(<ArchiveSourceControls status={{ ...status, settingsNotice: "Settings recovered from backup." }} loading={false} onSelectDatabase={async () => { throw new Error("Incompatible database"); }} />);
    fireEvent.click(screen.getByRole("button", { name: /Choose database/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incompatible database");
    expect(screen.getByText("Detected automatically")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Settings recovered from backup.");
  });
});
