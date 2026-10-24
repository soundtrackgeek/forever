import { act, fireEvent, render, screen } from "@testing-library/react";
import { lazy, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceBoundary } from "./WorkspaceBoundary";

describe("lazy workspace boundary", () => {
  it("keeps the shell available while loading and ignores a late route resolution", async () => {
    let resolve!: (value: { default: () => React.JSX.Element }) => void;
    const Slow = lazy(
      () =>
        new Promise<{ default: () => React.JSX.Element }>((done) => {
          resolve = done;
        }),
    );
    function Shell() {
      const [slow, setSlow] = useState(true);
      return (
        <>
          <button onClick={() => setSlow(false)}>Messages</button>
          <footer>Transfers running</footer>
          <WorkspaceBoundary
            key={String(slow)}
            label={slow ? "Search" : "Messages"}
          >
            {slow ? <Slow /> : <h1>Inbox</h1>}
          </WorkspaceBoundary>
        </>
      );
    }
    render(<Shell />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Search");
    expect(screen.getByText("Transfers running")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await act(async () => resolve({ default: () => <h1>Search results</h1> }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeVisible();
    expect(screen.queryByText("Search results")).not.toBeInTheDocument();
  });

  it("contains failed chunks and recovers when navigating to another workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error("Chunk unavailable")));
    const view = render(
      <WorkspaceBoundary key="broken" label="Search">
        <Broken />
      </WorkspaceBoundary>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search could not open",
    );
    view.rerender(
      <WorkspaceBoundary key="healthy" label="Home">
        <h1>Home</h1>
      </WorkspaceBoundary>,
    );
    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
  });
});
