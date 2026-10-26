import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDiscoveryShelf } from "../hooks/useDiscoveryShelf";
import { DiscoveryShelfWorkspace } from "./DiscoveryShelfWorkspace";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
function Harness({ online = true, add = vi.fn(), search = vi.fn().mockImplementation((_artist: string, albums: unknown[]) => albums.length) }) {
  const discovery = useDiscoveryShelf("source");
  return <DiscoveryShelfWorkspace discovery={discovery} online={online} connected wantedReady wantedAlbums={[]} onAddWanted={add} onSearchAlbums={search} />;
}
async function openPicks() {
  fireEvent.click(screen.getByRole("button", { name: "Discover from my top artists" }));
  fireEvent.click(await screen.findByRole("button", { name: /David Bowie/ }));
  await screen.findByRole("checkbox", { name: "Select Hunky Dory" });
}
describe("discovery shelf interactions", () => {
  it("shows why and from which source an artist is suggested, and checks both catalogs", async () => {
    render(<Harness />);
    await openPicks();
    expect(screen.getAllByText("Because you own Queen")).toHaveLength(3);
    expect(screen.getByText("Last.fm · ListenBrainz")).toBeInTheDocument();
    const checks = within(screen.getByRole("list", { name: "Album checks" }));
    expect(checks.getByText("MusicBrainz: 3 studio albums")).toBeInTheDocument();
    expect(checks.getByText("Discogs: 3 studio albums")).toBeInTheDocument();
  });
  it("sorts an artist's albums oldest first by default and lets the order change", async () => {
    render(<Harness />);
    await openPicks();
    const titles = () => screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label")?.replace("Select ", ""));
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("oldest");
    expect(titles().slice(-3)).toEqual(["Hunky Dory", "Low", "Heroes"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "newest" } });
    expect(titles().slice(-3)).toEqual(["Heroes", "Low", "Hunky Dory"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "alphabetical" } });
    expect(titles().slice(-3)).toEqual(["Heroes", "Hunky Dory", "Low"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "listened" } });
    expect(titles().slice(-3)).toEqual(["Hunky Dory", "Low", "Heroes"]);
  });
  it("opens one search per selected album and reports a partial batch", async () => {
    const search = vi.fn().mockReturnValueOnce(2).mockReturnValueOnce(1);
    render(<Harness search={search} />);
    await openPicks();
    expect(screen.getByRole("button", { name: /^Search Soulseek/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Hunky Dory" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Heroes" }));
    fireEvent.click(screen.getByRole("button", { name: "Search Soulseek (2)" }));
    expect(search).toHaveBeenCalledWith("David Bowie", [expect.objectContaining({ title: "Hunky Dory" }), expect.objectContaining({ title: "Heroes" })]);
    expect(screen.getByText("Opened 2 searches in Search.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Search Soulseek (3)" }));
    expect(screen.getByText("Opened 1 of 3 searches. Close some search tabs to open the rest.")).toBeInTheDocument();
    // Albums that did not get a tab stay selected for a retry.
    expect(screen.getByRole("button", { name: "Search Soulseek (2)" })).toBeEnabled();
  });
  it("hands a real album to Wanted, keeps it usable offline and exposes failed saves", async () => {
    const add = vi.fn().mockRejectedValueOnce("Wanted store unavailable").mockResolvedValue(undefined);
    render(<Harness online={false} add={add} />);
    await openPicks();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Low" }));
    expect(screen.getByRole("button", { name: "Search Soulseek (1)" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Wanted" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Wanted store unavailable");
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Wanted" })[0]);
    await waitFor(() => expect(add).toHaveBeenLastCalledWith("David Bowie", expect.objectContaining({ title: "Hunky Dory", primaryType: "Album" })));
  });
  it("starts from an artist searched in the Archive", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "richard" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Richard Marx" }));
    expect(within(screen.getByRole("list", { name: "Chosen artists" })).getByText("Richard Marx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discover new artists" }));
    expect(await screen.findByText("Inspired by")).toBeInTheDocument();
    expect(screen.getAllByText(/Richard Marx/).length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Richard Marx" }));
    expect(screen.queryByRole("list", { name: "Chosen artists" })).toBeNull();
  });
  it("shows which sources are connected and lets a key be removed", async () => {
    render(<Harness />);
    expect(screen.getByText("Sources · 2 of 4 connected")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Sources/));
    fireEvent.click(within(screen.getByText("Last.fm").closest("li")!).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Sources · 1 of 4 connected")).toBeInTheDocument();
    expect(screen.getByLabelText("Discogs consumer key")).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button", { name: "Save" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});
