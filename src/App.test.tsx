import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { UPDATE_CHECK_INTERVAL_STORAGE_KEY } from "./hooks/useAppUpdater";

describe("Forever shell", () => {
  it("renders the Midnight Radio search workspace", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Across the network" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("night geometry")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Night Geometry" }),
    ).toHaveLength(2);
  });

  it("navigates to a staged view and back to search", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
    expect(
      screen.getByRole("heading", { name: "Rooms are tuned for later" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Return to search" }),
    );
    expect(
      screen.getByRole("heading", { name: "Across the network" }),
    ).toBeInTheDocument();
  });

  it("streams a search and shows an empty state when no responses match", async () => {
    render(<App />);

    const search = screen.getByRole("textbox", { name: "Search the network" });
    fireEvent.change(search, { target: { value: "unfindable transmission" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(
      screen.getByRole("heading", { name: "Listening for responses" }),
    ).toBeInTheDocument();

    await waitFor(
      () =>
        expect(
          screen.getByRole("heading", { name: "No signals found" }),
        ).toBeInTheDocument(),
      { timeout: 1_500 },
    );
  });

  it("filters preview results by real audio type counts", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "All types" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Compressed audio 1" }));

    expect(
      screen.getByText("1 result"),
    ).toBeInTheDocument();
    expect(screen.getByText("320 kbps")).toBeInTheDocument();
  });

  it("browses a folder, selects files, and queues a complete release", async () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Pause Night Geometry" }),
    );
    expect(
      screen.getByRole("button", { name: "Resume Night Geometry" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Resume Night Geometry" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse folder" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download 10 files" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Deselect 01 - Thresholds.flac" }),
    );
    expect(
      screen.getByRole("button", { name: "Download 9 files" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download 9 files" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Transfers" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Night Geometry").length).toBeGreaterThan(0);
  });

  it("explores a user's complete shares and downloads a selection", async () => {
    render(<App />);

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Browse files shared by audiophile92",
      })[0],
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "audiophile92’s shares" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Select folder" }));
    expect(screen.getByText("10 files selected")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Deselect 01 - Thresholds.flac" }),
    );
    expect(screen.getByText("9 files selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download selection" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument(),
    );
    expect(screen.getAllByText("audiophile92 selection").length).toBeGreaterThan(0);
  });

  it("searches folders and expands or collapses the share hierarchy", async () => {
    render(<App />);

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Browse files shared by audiophile92",
      })[0],
    );
    const shares = await screen.findByRole("region", {
      name: "audiophile92's shared files",
    });
    expect(within(shares).getByRole("button", { name: "Collapse Music" })).toBeInTheDocument();
    expect(within(shares).getByRole("button", { name: "Collapse Liminal Structures" })).toBeInTheDocument();

    fireEvent.click(within(shares).getByRole("button", { name: "Collapse Liminal Structures" }));
    expect(
      within(shares).queryByRole("button", { name: /^Night Geometry/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(shares).getByRole("button", { name: "Expand Liminal Structures" }));
    expect(
      within(shares).getByRole("button", { name: /^Night Geometry/ }),
    ).toBeInTheDocument();

    fireEvent.change(within(shares).getByRole("textbox", { name: "Search this user's shares" }), {
      target: { value: "Signal Bloom" },
    });
    fireEvent.click(within(shares).getByRole("button", { name: "Search" }));
    expect(
      within(shares).getByRole("button", {
        name: "Open folder Music\\Electronic\\Liminal Structures\\Signal Bloom",
      }),
    ).toBeInTheDocument();
    expect(within(shares).getByText("1 folder · 3 files for “Signal Bloom”")).toBeInTheDocument();
  });

  it("opens the release-grouped Transfers workspace and filters completed releases", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    const workspace = screen
      .getByRole("heading", { name: "Transfers" })
      .closest("section") as HTMLElement;
    expect(
      screen.getByRole("button", { name: "Pause 04 - Night Geometry.flac" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Completed 1" }));
    expect(within(workspace).getByText("Apex Horizon (Deluxe)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Spheric Dusk")).not.toBeInTheDocument();
  });

  it("shows outgoing uploads with live progress in Transfers", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    fireEvent.click(screen.getByRole("tab", { name: "Uploads 1" }));

    expect(screen.getByText("04 Endorphin.flac")).toBeInTheDocument();
    expect(screen.getByText(/to lowlight.fm/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel upload 04 Endorphin.flac" })).toBeInTheDocument();
  });

  it("opens a source's shares from transfer history", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    fireEvent.click(screen.getAllByRole("button", { name: "audiophile92" })[0]);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "audiophile92’s shares" }),
      ).toBeInTheDocument(),
    );
  });

  it("opens the live connection settings from the sidebar", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(
      screen.getByRole("heading", { name: "Connection" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Network online")).not.toHaveLength(0);
    expect(screen.getByText("Global search connected")).toBeInTheDocument();
    expect(screen.getByText("128 received · 7 answered")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SignalLevel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your shared music" })).toBeInTheDocument();
    expect(screen.getByText("Midnight Archive")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Upload slots" })).toHaveValue("1");
  });

  it("checks for updates every five minutes by default and saves a new cadence", () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const view = render(<App />);

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const interval = screen.getByRole("combobox", {
      name: /Automatic update checks/,
    });
    expect(interval).toHaveValue("5");
    fireEvent.change(interval, { target: { value: "15" } });
    expect(window.localStorage.getItem(UPDATE_CHECK_INTERVAL_STORAGE_KEY)).toBe(
      "15",
    );

    view.unmount();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("combobox", { name: /Automatic update checks/ }),
    ).toHaveValue("15");
  });

  it("shows the release changelog in the update prompt", async () => {
    window.history.replaceState({}, "", "/?update=available");
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Update" }, { timeout: 2_000 }),
    );
    expect(
      screen.getByRole("heading", { name: "Forever 0.0.12 is ready." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Full participation in Soulseek’s distributed search network, including relay discovery and branch-root delivery.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Locally shared files can now appear in ordinary global searches from other Soulseek clients."),
    ).toBeInTheDocument();
  });

  it("guides a fresh profile through its first connection", async () => {
    window.history.replaceState({}, "", "/?onboarding=1");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Tune into Soulseek" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Why almost any login works")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "MidnightListener" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "not-logged-or-persisted-by-the-preview" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect to Soulseek" }),
    );

    await waitFor(
      () =>
        expect(
          screen.queryByRole("heading", { name: "Tune into Soulseek" }),
        ).not.toBeInTheDocument(),
      { timeout: 3_000 },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "MidnightListener profile. Online. Open connection settings.",
        }),
      ).toBeInTheDocument(),
    );
  });
});
