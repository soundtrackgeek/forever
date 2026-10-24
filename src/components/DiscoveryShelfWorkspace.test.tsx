import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDiscoveryShelf } from "../hooks/useDiscoveryShelf";
import { DiscoveryShelfWorkspace } from "./DiscoveryShelfWorkspace";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
function Harness({ online = true, add = vi.fn(), match = vi.fn() }) {
  const discovery = useDiscoveryShelf("source");
  return <DiscoveryShelfWorkspace discovery={discovery} online={online} connected wantedReady wantedAlbums={[]} onAddWanted={add} onSmartMatch={match} />;
}
async function openPicks() {
  fireEvent.click(screen.getByRole("button", { name: "Discover artists" }));
  fireEvent.click(await screen.findByRole("button", { name: /David Bowie/ }));
  await screen.findByRole("heading", { name: "Hunky Dory" });
}
describe("discovery shelf interactions", () => {
  it("shows why an artist is recommended and hands a real album context to Smart Match and Wanted", async () => {
    const add = vi.fn().mockResolvedValue(undefined), match = vi.fn();
    render(<Harness add={add} match={match} />);
    await openPicks();
    expect(screen.getAllByText("Because you own Queen")).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Smart Match" })[0]);
    expect(match).toHaveBeenCalledWith("David Bowie", expect.objectContaining({ title: "Hunky Dory" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Wanted" })[0]);
    await waitFor(() => expect(add).toHaveBeenCalledWith("David Bowie", expect.objectContaining({ title: "Hunky Dory" })));
  });
  it("keeps Wanted usable offline and exposes failed saves", async () => {
    render(<Harness online={false} add={vi.fn().mockRejectedValue("Wanted store unavailable")} />);
    await openPicks();
    expect(screen.getAllByRole("button", { name: "Smart Match" })[0]).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Wanted" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Wanted store unavailable");
    expect(screen.getAllByRole("button", { name: "Add to Wanted" })[0]).toBeEnabled();
  });
});
