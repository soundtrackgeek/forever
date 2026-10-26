import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatisticsPanel } from "./StatisticsPanel";
import { emptyCounts, emptySnapshot } from "../utils/statistics";

const native = vi.hoisted(() => ({ isTauri: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.isTauri, invoke: native.invoke }));

describe("statistics panel", () => {
  it("shows sample insights in the browser preview", () => {
    native.isTauri = false;
    render(<StatisticsPanel />);
    expect(screen.getByText("Sample data in the browser preview")).toBeInTheDocument();
    expect(screen.getByText("Share ratio")).toBeInTheDocument();
    const sources = screen.getByRole("region", { name: "Top sources" });
    expect(within(sources).getByText("vinylhoarder")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Daily received and shared bytes/ })).toBeInTheDocument();
  });

  it("opens a source's profile or shares from Top sources", () => {
    native.isTauri = false;
    const onOpenProfile = vi.fn();
    const onBrowseUser = vi.fn();
    render(<StatisticsPanel onOpenProfile={onOpenProfile} onBrowseUser={onBrowseUser} />);
    const sources = screen.getByRole("region", { name: "Top sources" });
    fireEvent.click(within(sources).getByRole("button", { name: "vinylhoarder" }));
    expect(onOpenProfile).toHaveBeenCalledWith("vinylhoarder");
    fireEvent.click(within(sources).getByRole("button", { name: "Browse vinylhoarder's shares" }));
    expect(onBrowseUser).toHaveBeenCalledWith("vinylhoarder");
  });

  it("explains an empty database instead of showing zeroed charts", async () => {
    native.isTauri = true;
    native.invoke.mockResolvedValue(emptySnapshot);
    render(<StatisticsPanel />);
    await waitFor(() => expect(screen.getByText(/Nothing has been counted yet/)).toBeInTheDocument());
    expect(native.invoke).toHaveBeenCalledWith("stats_snapshot");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders native totals and surfaces a read failure", async () => {
    native.isTauri = true;
    native.invoke.mockResolvedValueOnce({
      ...emptySnapshot,
      trackedSince: "2026-10-01",
      totals: { ...emptyCounts, downBytes: 2_000_000_000, downFiles: 12, upBytes: 1_000_000_000, upFiles: 5 },
    });
    const view = render(<StatisticsPanel />);
    await waitFor(() => expect(screen.getByText("2.00 GB")).toBeInTheDocument());
    expect(screen.getByText("0.50")).toBeInTheDocument();
    view.unmount();

    native.invoke.mockRejectedValueOnce("database locked");
    render(<StatisticsPanel />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("database locked"));
  });
});
