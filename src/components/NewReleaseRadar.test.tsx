import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewReleaseRadar } from "./NewReleaseRadar";
import { useReleaseRadar } from "../hooks/useReleaseRadar";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke }));
function Fixture({ add = vi.fn().mockResolvedValue(undefined) }: { add?: (artist: string, album: unknown) => Promise<unknown> }) {
  const radar = useReleaseRadar();
  return <NewReleaseRadar radar={radar} sourceKey="archive" archiveConnected wanted={[]} wantedReady onAddWanted={add} onSearchArtists={vi.fn()} />;
}
describe("new release radar", () => {
  it("persists dismissal through remount and restores the release", async () => {
    const view = render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Signals at Dawn" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Recent releases" })).not.toBeInTheDocument());
    view.unmount(); render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Dismissed 1" }));
    expect(screen.getByText("Signals at Dawn")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore Signals at Dawn" }));
    fireEvent.click(screen.getByRole("button", { name: "Inbox 1" }));
    expect(screen.getByText("Signals at Dawn")).toBeInTheDocument();
  });
  it("adds to Wanted once and retains a visible failure for retry", async () => {
    const add = vi.fn().mockRejectedValueOnce("Wanted is full").mockResolvedValue(undefined);
    render(<Fixture add={add} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Wanted" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Wanted is full");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Wanted" })));
    expect(screen.getByRole("button", { name: "Added to Wanted" })).toBeDisabled();
    expect(add).toHaveBeenCalledWith("The Paper Satellites", expect.objectContaining({ title: "Signals at Dawn" }));
  });
  it("suggests Archive artists only on request and follows without automatic additions", async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Following 1" }));
    expect(screen.queryByText("Queen")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Suggest from Archive" }));
    const row = screen.getByText("Queen").closest("li")!;
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Follow artist" })));
    expect(screen.getByRole("button", { name: "Following 2" })).toBeInTheDocument();
    const followed = screen.getByRole("list", { name: "Followed artists" });
    expect(within(followed).getAllByRole("checkbox").every((input) => !(input as HTMLInputElement).checked)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});
