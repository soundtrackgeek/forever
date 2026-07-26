import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { UPDATE_CHECK_INTERVAL_STORAGE_KEY } from "./hooks/useAppUpdater";
import { MESSAGE_NOTIFICATION_STORAGE_KEY } from "./hooks/usePrivateMessages";
import { MESSAGE_DRAFTS_STORAGE_KEY } from "./components/MessagesWorkspace";

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

  it("keeps the transfer shelf collapsed by default and toggles it on demand", () => {
    render(<App />);

    const transferPanel = screen
      .getByRole("region", { name: "Transfer activity" })
      .querySelector("#transfer-shelf-panel") as HTMLElement;
    const expand = screen.getByRole("button", {
      name: "Expand transfer activity",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(transferPanel).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Pause Night Geometry" }),
    ).not.toBeInTheDocument();

    fireEvent.click(expand);

    expect(transferPanel).toBeVisible();
    expect(screen.getByText("Release queue")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pause Night Geometry" }),
    ).toBeInTheDocument();
    const collapse = screen.getByRole("button", {
      name: "Collapse transfer activity",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    ).toBeInTheDocument();
    expect(transferPanel).not.toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "View all transfers" }));
    expect(
      screen.getByRole("heading", { name: "Transfers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    ).toBeInTheDocument();
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

  it("discovers an artist's albums and hands a release into Soulseek search", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Albums" }));
    expect(
      screen.getByRole("heading", { name: "Find the record. Then find the files." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Def Leppard/ })).toBeInTheDocument();

    const hysteria = screen
      .getByRole("heading", { name: "Hysteria" })
      .closest("article") as HTMLElement;
    fireEvent.click(
      within(hysteria).getByRole("button", { name: "Search Soulseek for Hysteria" }),
    );

    expect(
      screen.getByDisplayValue("Def Leppard Hysteria"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens Browse as a dedicated workspace before requesting a user's shares", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(
      screen.getByRole("heading", { name: "Browse a listener’s shelves." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Soulseek username to browse" }),
      { target: { value: "audiophile92" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse shares" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /audiophile92’s shares/ }),
      ).toBeInTheDocument(),
    );
  });

  it("browses a folder, selects files, and queues a complete release", async () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    );
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
        screen.getByRole("heading", { name: /audiophile92’s shares/ }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Select folder" }));
    expect(screen.getByText("14 files selected")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Deselect 01 - Thresholds.flac" }),
    );
    expect(screen.getByText("13 files selected")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /lowlight.fm/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel upload 04 Endorphin.flac" })).toBeInTheDocument();
  });

  it("opens a source's shares from transfer history", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    fireEvent.click(screen.getAllByRole("button", { name: /audiophile92/ })[0]);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Your corner of the network" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "audiophile92" })).toBeInTheDocument();
  });

  it("opens People with live presence, country flags, favorites, and profile details", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "People" }));

    expect(
      screen.getByRole("heading", { name: "Your corner of the network" }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("Netherlands").length).toBeGreaterThan(0);
    expect(screen.getByText("24K")).toBeInTheDocument();
    expect(screen.getByText("8.2 MB/s")).toBeInTheDocument();
    expect(screen.getByText("field recordings")).toBeInTheDocument();

    const saved = screen.getByRole("button", { name: "Saved" });
    fireEvent.click(saved);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opens the Midnight Inbox from a person profile and sends a message", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    fireEvent.click(screen.getByRole("button", { name: "Message" }));

    const inbox = screen.getByRole("region", { name: "Midnight Inbox" });
    expect(within(inbox).getByRole("heading", { name: "Midnight Inbox" })).toBeInTheDocument();
    expect(within(inbox).getByText(/late-night radio session/)).toBeInTheDocument();
    const composer = within(inbox).getByRole("textbox", { name: "Message audiophile92" });
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: "That would be wonderful." } });
    fireEvent.click(within(inbox).getByRole("button", { name: "Send" }));
    expect(await within(inbox).findByText("That would be wonderful.")).toBeInTheDocument();
  });

  it("searches message history and retries a failed transmission", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    const inbox = screen.getByRole("region", { name: "Midnight Inbox" });
    fireEvent.change(
      within(inbox).getByRole("textbox", { name: "Search conversations and messages" }),
      { target: { value: "cue-sheet" } },
    );
    const vinylConversation = await within(inbox).findByRole("button", {
      name: /vinyljunkie/,
    });
    fireEvent.click(vinylConversation);
    expect(within(inbox).getByText("Failed")).toBeInTheDocument();
    fireEvent.click(within(inbox).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(within(inbox).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument(),
    );
  });

  it("starts a new exact-username conversation and preserves its draft", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    fireEvent.change(screen.getByLabelText("Exact Soulseek username"), {
      target: { value: "fieldrecorder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open new conversation" }));

    const composer = await screen.findByRole("textbox", { name: "Message fieldrecorder" });
    fireEvent.change(composer, { target: { value: "Holding this thought for later." } });
    expect(window.localStorage.getItem(MESSAGE_DRAFTS_STORAGE_KEY)).toContain(
      "Holding this thought for later.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(screen.getByRole("textbox", { name: "Message fieldrecorder" })).toHaveValue(
      "Holding this thought for later.",
    );
  });

  it("opens a user profile directly from a search result", () => {
    render(<App />);

    fireEvent.click(
      screen.getAllByRole("button", { name: "View audiophile92's profile" })[0],
    );

    expect(
      screen.getByRole("heading", { name: "Your corner of the network" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "audiophile92" })).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Your shared releases" })).toBeInTheDocument();
    expect(screen.getByText("Midnight Archive")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Upload slots" })).toHaveValue("1");
    const notifications = screen.getByRole("checkbox", {
      name: /Private-message alerts/,
    });
    expect(notifications).toBeChecked();
    fireEvent.click(notifications);
    expect(window.localStorage.getItem(MESSAGE_NOTIFICATION_STORAGE_KEY)).toBe("false");
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
      screen.getByRole("heading", { name: "Forever 0.0.19 is ready." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The bottom transfer queue now has explicit Expand and Collapse controls with accessible state.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sidebar navigation rows and spacing are tighter, leaving more room for the signed-in profile.",
      ),
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

    await screen.findByRole(
      "button",
      { name: "Connecting to the Soulseek network…" },
      { timeout: 2_000 },
    );
    expect(
      screen.getByRole("heading", { name: "Tune into Soulseek" }),
    ).toBeInTheDocument();

    await waitFor(
      () =>
        expect(
          screen.queryByRole("heading", { name: "Tune into Soulseek" }),
        ).not.toBeInTheDocument(),
      { timeout: 3_000 },
    );
    expect(
      screen.getByRole("button", {
        name: "MidnightListener profile. Online. Open connection settings.",
      }),
    ).toBeInTheDocument();
  });
});
