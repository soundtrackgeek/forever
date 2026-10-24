import { getSettingsState, initializeSettings } from "./settings";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MESSAGE_DRAFTS_STORAGE_KEY } from "./components/MessagesWorkspace";

// Rendered flows execute the same Rust policy as the native IPC commands.
vi.mock("./utils/matchingClient", async () => {
  const { runMatching } = await import("../scripts/matching-runtime.mjs");
  return { matchingCommand: runMatching };
});
beforeAll(async () => {
  const { prepareMatchingRuntime } = await import("../scripts/matching-runtime.mjs");
  await prepareMatchingRuntime();
}, 120_000);

// Workspace imports resolve asynchronously; exercise real lazy routes in these flows.
async function waitForWorkspace() {
  await waitFor(() => expect(document.querySelector('.workspace-status[role="status"]')).toBeNull(), { timeout: 10000 });
}
async function renderApp() {
  // Match main.tsx: the app starts only after settings initialization.
  await initializeSettings();
  const view = render(<App />);
  await waitForWorkspace();
  return view;
}
async function click(element: Element) {
  await act(async () => { fireEvent.click(element); });
  if (!vi.isFakeTimers()) await waitForWorkspace();
}

describe("Forever shell", () => {
  it("opens real Settings after a fresh profile chooses to explore offline", async () => {
    window.history.replaceState({}, "", "/?onboarding=1");
    await renderApp();
    await click(screen.getByRole("button", { name: /Explore offline/ }));
    await click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("spinbutton", { name: /Listening port/ })).toBeInTheDocument();
    expect(screen.queryByText(/will live here|will arrive after/)).not.toBeInTheDocument();
  });

  it("remembers a review edition and checks its bonus tracks before recommending the folder", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Archive" }));
    await click(screen.getByRole("tab", { name: "Wanted 3" }));
    await click(screen.getByRole("button", { name: "Check A Sonic Holiday now" }));
    await click(await screen.findByRole("button", { name: "Review match" }, { timeout: 10_000 }));
    await screen.findByText("Exact tracklist", {}, { timeout: 10000 });
    fireEvent.change(screen.getByRole("combobox", { name: "MusicBrainz edition" }), {
      target: { value: "preview-deluxe" },
    });
    await screen.findByText("1 missing", {}, { timeout: 10000 });
    expect(screen.queryByRole("button", { name: "Queue complete album" })).not.toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Close Smart Match review" }));
    await click(screen.getByRole("button", { name: "Edit A Sonic Holiday Smart Match profile" }));
    expect(await screen.findByRole("combobox", { name: "MusicBrainz edition" })).toHaveValue("preview-deluxe");
  });
  it("saves the listening port and network preferences before reconnecting", async () => {
    const { unmount } = await renderApp();
    try {
      await click(screen.getByRole("button", { name: "Settings" }));
      vi.useFakeTimers();
      fireEvent.change(screen.getByRole("spinbutton", { name: /Listening port/ }), { target: { value: "2240" } });
      await click(screen.getByRole("checkbox", { name: /Automatic router mapping/ }));
      await click(screen.getByRole("checkbox", { name: /Help relay global searches/ }));
      await act(async () => {
        await click(screen.getByRole("button", { name: "Save changes" }));
        await vi.advanceTimersByTimeAsync(240);
      });
      expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Test direct connections" })).toBeDisabled();
      await act(async () => {
        await click(screen.getByRole("button", { name: "Connect now" }));
        await vi.advanceTimersByTimeAsync(780);
      });
      expect(screen.getByRole("button", { name: "Test direct connections" })).toBeEnabled();
      expect(screen.getByText("2240 / 2240")).toBeInTheDocument();
      await click(screen.getByRole("button", { name: "Home" }));
      await click(screen.getByRole("button", { name: "Settings" }));
      expect(screen.getByRole("spinbutton", { name: /Listening port/ })).toHaveValue(2240);
      expect(screen.getByRole("checkbox", { name: /Automatic router mapping/ })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Help relay global searches/ })).not.toBeChecked();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it("keeps navigation usable after storage recovery and lets the notice be dismissed", async () => {
    window.history.replaceState({}, "", "/?storageRecovery=1");
    await renderApp();
    expect(screen.getByRole("status", { name: "Saved data notice" })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("heading", { name: "Across the network" })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status", { name: "Saved data notice" })).not.toBeInTheDocument();
  });

  it("opens The Listening Post first and routes every live signal to its exact workspace", async () => {
    await renderApp();

    expect(screen.getByRole("heading", { name: "The Listening Post" })).toBeInTheDocument();
    expect(screen.getByText("Everything worth hearing, waiting in one place.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("2 new Wanted matches")).toBeInTheDocument();
    expect(screen.getByText("1 unread message")).toBeInTheDocument();
    expect(screen.getByText("1 room mention")).toBeInTheDocument();
    expect(screen.getByText("72,366")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: /Open transfer/ }));
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toHaveTextContent("Night Geometry");

    await click(screen.getByRole("button", { name: "Home" }));
    await click(screen.getByRole("button", { name: /2 new Wanted matches/ }));
    expect(screen.getByRole("tab", { name: "Wanted 3" })).toHaveAttribute("aria-selected", "true");

    await click(screen.getByRole("button", { name: "Home" }));
    await click(screen.getByRole("button", { name: /1 room mention/ }));
    expect(screen.getByRole("heading", { name: "Lossless Listening" })).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Home" }));
    await click(screen.getByRole("button", { name: /1 unread message/ }));
    expect(screen.getByRole("region", { name: "Midnight Inbox" })).toBeInTheDocument();
    expect(screen.getByText(/late-night radio session/)).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Home" }));
    await click(screen.getByRole("button", { name: "Open Missing Shelf" }));
    expect(screen.getByRole("tab", { name: "Missing shelf" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders the Midnight Radio search workspace", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("heading", { name: "Across the network" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("night geometry")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Night Geometry" })).toHaveLength(2);
  });

  it("keeps independent Dial Memory searches and reopens a recently closed preset", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("tab", { name: /night geometryFiles 6 results/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Def LeppardAlbums 8 albums/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /rare Bowie demosFiles/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Kate Bush" })).toBeInTheDocument();

    await click(screen.getByTitle("New search (Ctrl+T)"));
    const input = screen.getByRole("textbox", { name: "Search the network" });
    fireEvent.change(input, { target: { value: "Def Leppard Hysteria" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await click(screen.getByRole("tab", { name: /night geometryFiles 6 results/ }));
    expect(screen.getAllByRole("heading", { name: "Night Geometry" })).toHaveLength(2);
    const background = await screen.findByRole(
      "tab",
      { name: /Def Leppard HysteriaFiles 39 new/ },
      { timeout: 1_800 },
    );

    await click(background);
    expect(screen.getByDisplayValue("Def Leppard Hysteria")).toBeInTheDocument();
    expect(screen.getAllByText(/1987 - Hysteria \[FLAC\]/).length).toBeGreaterThan(0);

    await click(screen.getByRole("button", { name: "Pin Def Leppard Hysteria" }));
    expect(screen.getByRole("button", { name: "Unpin Def Leppard Hysteria" })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Close Def Leppard Hysteria" }));
    expect(screen.queryByDisplayValue("Def Leppard Hysteria")).not.toBeInTheDocument();

    await click(screen.getByRole("button", { name: /Recently closed/ }));
    await click(screen.getByRole("menuitem", { name: /Def Leppard Hysteria/ }));
    expect(screen.getByDisplayValue("Def Leppard Hysteria")).toBeInTheDocument();
    expect(screen.getByText("No signals found")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.getByRole("textbox", { name: "Search the network" })).toHaveValue("");
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.getByDisplayValue("Def Leppard Hysteria")).toBeInTheDocument();
    const selected = screen.getByRole("tab", { name: /Def Leppard HysteriaFiles Ready/ });
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(selected).toHaveAttribute("aria-selected", "false");
  });

  it("keeps the transfer shelf collapsed by default and toggles it on demand", async () => {
    await renderApp();

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

    await click(expand);

    expect(transferPanel).toBeVisible();
    expect(screen.getByText("Release queue")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pause Night Geometry" }),
    ).toBeInTheDocument();
    const collapse = screen.getByRole("button", {
      name: "Collapse transfer activity",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    await click(collapse);
    expect(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    ).toBeInTheDocument();
    expect(transferPanel).not.toBeVisible();

    await click(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    );
    await click(screen.getByRole("button", { name: "View all transfers" }));
    expect(
      screen.getByRole("heading", { name: "Transfers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    ).toBeInTheDocument();
  });

  it("joins, reads, and writes in the public Rooms workspace", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Rooms" }));
    expect(screen.getByRole("heading", { name: "Rooms" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lossless Listening" })).toBeInTheDocument();
    expect(screen.getByText(/Japanese pressing/)).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "All" }));
    await click(screen.getByRole("button", { name: /Post-Punk/ }));
    expect(screen.getByText(/previewing directory/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Join" }));

    const composer = await screen.findByRole("textbox", { name: "Message Post-Punk" });
    fireEvent.change(composer, { target: { value: "The signal is clear." } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(await screen.findByText("The signal is clear.")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Search" }));
    expect(
      screen.getByRole("heading", { name: "Across the network" }),
    ).toBeInTheDocument();
  });

  it("streams a search and shows an empty state when no responses match", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

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

  it("filters preview results by real audio type counts", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(screen.getByRole("button", { name: "All types" }));
    await click(screen.getByRole("menuitem", { name: "Compressed audio 1" }));

    expect(
      screen.getByText("1 result"),
    ).toBeInTheDocument();
    expect(screen.getByText("320 kbps")).toBeInTheDocument();
  });

  it("discovers an artist's albums and groups Soulseek files into downloadable sources", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(screen.getByRole("tab", { name: "Albums" }));
    expect(
      screen.getByRole("heading", { name: "Find the record. Then find the files." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Def Leppard/ })).toBeInTheDocument();

    const hysteria = screen
      .getByRole("heading", { name: "Hysteria" })
      .closest("article") as HTMLElement;
    expect(await within(hysteria).findByText("Owned")).toBeInTheDocument();
    const slang = screen
      .getByRole("heading", { name: "Slang" })
      .closest("article") as HTMLElement;
    expect(await within(slang).findByText("Don’t own")).toBeInTheDocument();
    await click(
      within(hysteria).getByRole("button", { name: "Search Soulseek for Hysteria" }),
    );

    expect(
      screen.getByDisplayValue("Def Leppard Hysteria"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await waitFor(
      () => expect(screen.getByText("3 album sources")).toBeInTheDocument(),
      { timeout: 1_500 },
    );
    await screen.findByText("Found 39 files from 3 people.", {}, { timeout: 1_500 });
    const albumReport = screen
      .getByRole("heading", { name: "Hysteria — Def Leppard" })
      .closest("article") as HTMLElement;
    expect(within(albumReport).getAllByText("3")).toHaveLength(2);
    expect(within(albumReport).getByText("Owned")).toBeInTheDocument();
    expect(screen.getByText("1987 - Hysteria [FLAC]")).toBeInTheDocument();
    expect((await screen.findAllByText("12 / 12")).length).toBeGreaterThan(0);

    const previewTracks = screen.getAllByRole("button", {
      name: /Preview tracks in/,
    })[0];
    fireEvent.mouseEnter(previewTracks);
    const trackPreview = screen.getByRole("tooltip");
    expect(within(trackPreview).getByText("01 - Women.flac")).toBeInTheDocument();
    expect(within(trackPreview).getByText("12")).toBeInTheDocument();
    fireEvent.mouseLeave(previewTracks);

    await click(screen.getByRole("button", { name: "Transfers" }));
    await click(screen.getByRole("button", { name: "Cancel Night Geometry" }));
    await click(screen.getByRole("button", { name: "Cancel Spheric Dusk" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Cancel Night Geometry" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Cancel Spheric Dusk" }),
      ).not.toBeInTheDocument();
    });
    await click(screen.getByRole("button", { name: "Search" }));

    const readyDownloadButtons = await screen.findAllByRole("button", { name: "Download album" }, { timeout: 5_000 });
    await click(readyDownloadButtons[0]);
    const downloading = await screen.findByRole(
      "button",
      { name: /Downloading · \d+%/ },
      { timeout: 1_500 },
    );
    expect(downloading).toHaveClass("is-downloading");
    expect(
      screen.getByRole("heading", { name: "Hysteria — Def Leppard" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Transfers" }),
    ).not.toBeInTheDocument();

    await click(screen.getAllByRole("button", { name: "Download album" })[0]);
    const queued = await screen.findByRole(
      "button",
      { name: "Queued #1" },
      { timeout: 1_500 },
    );
    expect(queued).toHaveClass("is-queued");
    expect(queued).toBeEnabled();
    expect(await screen.findByText("Release queued")).toBeInTheDocument();
    await click(queued);
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toBeInTheDocument();
    expect(
      screen.getAllByText("Def Leppard - Hysteria (1987)").length,
    ).toBeGreaterThan(0);
  });

  it("uses Music Library as a read-only Archive without adopting downloads", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Archive" }));

    expect(
      screen.getByRole("heading", { name: "Your collection, without touching it." }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Archive connected")).toBeInTheDocument();
    expect(
      screen.getByText(/com\.local\.musiclibrary\\music-library\.sqlite3/),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-only by construction")).toBeInTheDocument();
    expect(
      screen.getByText(/verified Wanted download moves to the Fulfilled Shelf/),
    ).toBeInTheDocument();
    expect(screen.getByText("72,366")).toBeInTheDocument();
    expect(screen.getByText("1,101,878")).toBeInTheDocument();
  });

  it("reconciles completed downloads at the Arrival Desk without writing to Music Library", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Open Arrival Desk" }));

    expect(screen.getByRole("tab", { name: "Arrivals 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "Downloads, on their way home." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Music Library · read-only")).toBeInTheDocument();

    const afterMidnight = screen.getByText("After Midnight").closest("article") as HTMLElement;
    expect(within(afterMidnight).getByText("Ready to file")).toBeInTheDocument();
    await click(within(afterMidnight).getByRole("button", { name: "Mark as filed" }));

    await waitFor(() => {
      expect(within(afterMidnight).getByText("Filed away")).toBeInTheDocument();
      expect(within(afterMidnight).getByText("Confirmed by you")).toBeInTheDocument();
    });
    expect(within(afterMidnight).getByText(/completed 1h ago/)).toBeInTheDocument();
    expect(within(afterMidnight).getByRole("button", { name: "Undo filed" })).toBeEnabled();

    const arrivalList = document.querySelector(".arrival-list") as HTMLElement;
    const apex = within(arrivalList).getByText("Apex Horizon (Deluxe)").closest("article") as HTMLElement;
    expect(within(apex).getByText("Matched in Music Library")).toBeInTheDocument();
    expect(within(apex).queryByRole("button", { name: "Undo filed" })).not.toBeInTheDocument();
  });

  it("finds collection gaps and adds a batch to Wanted with one Smart Match profile", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Archive" }));
    await click(screen.getByRole("tab", { name: "Missing shelf" }));

    expect(screen.getByRole("heading", { name: "Def Leppard" })).toBeInTheDocument();
    expect(screen.getByText("3/10")).toBeInTheDocument();
    expect(screen.getByText(/Music Library cache/)).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Select Adrenalize" }));
    await click(screen.getByRole("button", { name: "Select Slang" }));
    expect(screen.getByText("2 missing selected")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Bulk format preference" }), {
      target: { value: "losslessOnly" },
    });
    const trackMode = screen.getByRole("combobox", { name: "Bulk track count mode" });
    expect(trackMode).toHaveValue("any");
    fireEvent.change(trackMode, { target: { value: "custom" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bulk custom track count" }), {
      target: { value: "9" },
    });
    fireEvent.change(trackMode, { target: { value: "musicbrainz" } });
    expect(screen.queryByRole("spinbutton", { name: "Bulk custom track count" })).not.toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Add 2 to Wanted" }));
    expect(await screen.findByText("2 added to Wanted")).toBeInTheDocument();

    await click(screen.getByRole("tab", { name: "Live" }));
    expect(screen.getByText("Viva! Hysteria")).toBeInTheDocument();
    await click(screen.getByRole("tab", { name: "Wanted 5" }));
    const adrenalize = screen.getByText("Adrenalize").closest("article") as HTMLElement;
    const slang = screen.getByText("Slang").closest("article") as HTMLElement;
    expect(within(adrenalize).getByText("Lossless only · 10+ tracks")).toBeInTheDocument();
    expect(within(slang).getByText("Lossless only · 11+ tracks")).toBeInTheDocument();
  });

  it("uses the persisted Settings fallback when a MusicBrainz count is unavailable", async () => {
    const view = await renderApp();

    await click(screen.getByRole("button", { name: "Settings" }));
    const fallback = screen.getByRole("spinbutton", {
      name: "MusicBrainz fallback track count",
    });
    expect(fallback).toHaveValue(10);
    fireEvent.change(fallback, { target: { value: "6" } });
    expect(getSettingsState().settings.preferences.musicBrainzFallbackTrackCount).toBe(6);

    view.unmount();
    await renderApp();
    await click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("spinbutton", {
      name: "MusicBrainz fallback track count",
    })).toHaveValue(6);

    await click(screen.getByRole("button", { name: "Archive" }));
    await click(screen.getByRole("tab", { name: "Missing shelf" }));
    await click(screen.getByRole("button", { name: "Select Songs From the Sparkle Lounge" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Bulk track count mode" }), {
      target: { value: "musicbrainz" },
    });
    await click(screen.getByRole("button", { name: "Add 1 to Wanted" }));

    expect(await screen.findByText("1 added to Wanted")).toBeInTheDocument();
    expect(
      screen.getByText(
        "MusicBrainz has no official track count for Songs From the Sparkle Lounge. Added it with your 6-track fallback.",
      ),
    ).toBeInTheDocument();

    await click(screen.getByRole("tab", { name: "Wanted 4" }));
    const fallbackAlbum = screen.getByText("Songs From the Sparkle Lounge").closest("article") as HTMLElement;
    expect(within(fallbackAlbum).getByText("Prefer FLAC · 320+ kbps · 6+ tracks")).toBeInTheDocument();
  });

  it("scans one missing album, previews sources, downloads the best copy, and starts a watch", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Archive" }));
    await click(screen.getByRole("tab", { name: "Missing shelf" }));

    const adrenalize = screen.getByText("Adrenalize").closest("article") as HTMLElement;
    await click(within(adrenalize).getByRole("button", { name: /Not scanned/ }));
    expect(screen.getByText(/Shelf Radar · 0\/1/)).toBeInTheDocument();

    const lossless = await within(adrenalize).findByRole(
      "button",
      { name: /Lossless found/ },
      { timeout: 1_800 },
    );
    await click(lossless);

    expect(screen.getByText("2 sources on radar")).toBeInTheDocument();
    expect(screen.getByText("rockvault")).toBeInTheDocument();
    const trackDetails = screen.getAllByText("Tracks")[0].closest("details") as HTMLDetailsElement;
    await click(within(trackDetails).getByText("Tracks"));
    expect(within(trackDetails).getByText(/01 - Let’s Get Rocked\.flac/)).toBeInTheDocument();

    await click(await screen.findByRole("button", { name: "Download best" }, { timeout: 5_000 }));
    const queuedBest = await screen.findByRole("button", { name: "Queued #2" });
    expect(queuedBest).toBeEnabled();
    expect(screen.getByRole("button", { name: /Queued.*Adrenalize from rockvault/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download best" })).not.toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Watch for better" }));
    await waitFor(() => expect(within(adrenalize).getAllByText("Wanted").length).toBeGreaterThan(0));
    await click(queuedBest);
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toHaveTextContent("Def Leppard - Adrenalize (1992)");
  });

  it("watches missing albums and opens newly available sources without changing Archive", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(screen.getByRole("tab", { name: "Albums" }));
    const adrenalize = screen
      .getByRole("heading", { name: "Adrenalize" })
      .closest("article") as HTMLElement;
    await click(
      within(adrenalize).getByRole("button", { name: "Add Adrenalize to Wanted" }),
    );
    expect(
      within(adrenalize).getByRole("button", { name: "Remove Adrenalize from Wanted" }),
    ).toHaveAttribute("aria-pressed", "true");

    await click(screen.getByRole("button", { name: "Archive" }));
    await click(screen.getByRole("tab", { name: "Wanted 4" }));
    expect(screen.getByText("High ’n’ Dry")).toBeInTheDocument();
    expect(screen.getByText("4 matching")).toBeInTheDocument();

    const highAndDry = screen.getByText("High ’n’ Dry").closest("article") as HTMLElement;
    await click(within(highAndDry).getByRole("button", { name: "Edit High ’n’ Dry Smart Match profile" }));
    await click(screen.getByRole("radio", { name: /Lossless only/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Minimum track count/ }), {
      target: { value: "10" },
    });
    await click(screen.getByRole("button", { name: "Save match profile" }));
    expect(await screen.findByText("Lossless only · 10+ tracks")).toBeInTheDocument();

    const rhythm = screen.getByRole("combobox", { name: "Preferred rhythm" });
    fireEvent.change(rhythm, { target: { value: "15" } });
    await waitFor(() => expect(rhythm).toHaveValue("15"));
    expect(await screen.findByText(/Capacity: .*every 36 min at current list size/)).toBeInTheDocument();

    await click(screen.getByRole("tab", { name: /Waiting/ }));
    const sonicHoliday = screen.getByText("A Sonic Holiday").closest("article") as HTMLElement;
    await click(within(sonicHoliday).getByRole("button", { name: "Check A Sonic Holiday now" }));
    expect(within(sonicHoliday).getByText("Checking")).toBeInTheDocument();

    expect(
      await screen.findByText(/FLAC · 11 tracks · free slot for Engine Alley/, {}, { timeout: 1_500 }),
    ).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Review match" }));
    expect(screen.getByRole("heading", { name: "Review the best transmission." })).toBeInTheDocument();
    expect(await screen.findByText("Folder verified")).toBeInTheDocument();
    expect(screen.getByText("Companion")).toBeInTheDocument();
    expect(await screen.findByText("Exact tracklist")).toBeInTheDocument();
    expect(screen.getByText(/11\/11 titles matched/)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Compare alternatives" }));
    expect(
      screen.getByRole("heading", { name: "A Sonic Holiday — Engine Alley" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Engine Alley A Sonic Holiday")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove A Sonic Holiday from Wanted" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(
      () => expect(screen.getByText("2 album sources")).toBeInTheDocument(),
      { timeout: 1_500 },
    );
    const exactSource = screen.getByText("1992 - A Sonic Holiday [FLAC]").closest("article") as HTMLElement;
    expect(await within(exactSource).findByText("11 / 11")).toBeInTheDocument();
    expect(within(exactSource).getByText("Exact tracklist")).toBeInTheDocument();
    expect(within(exactSource).getByText("Smart Match")).toBeInTheDocument();
    const unclearSource = screen.getByText("A Sonic Holiday [Mislabeled]").closest("article") as HTMLElement;
    expect(within(unclearSource).getByText("1 / 11")).toBeInTheDocument();
    expect(within(unclearSource).getByText("Unclear match")).toBeInTheDocument();
    expect(within(unclearSource).queryByText("Smart Match")).not.toBeInTheDocument();
    await click(within(unclearSource).getByRole("button", { name: /Show tracklist confidence/ }));
    expect(within(unclearSource).getByText("Infamy")).toBeInTheDocument();
    expect(within(unclearSource).getByText(/Thresholds\.mp3/)).toBeInTheDocument();
    await click(within(unclearSource).getByRole("button", { name: "Download album" }));
    expect(screen.getByText("Tracklist needs a closer look.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download anyway from signalnoise" })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("A Sonic Holiday - Sampler")).not.toBeInTheDocument();
    const sonicReport = screen
      .getByRole("heading", { name: "A Sonic Holiday — Engine Alley" })
      .closest("article") as HTMLElement;
    expect(within(sonicReport).getByText("24")).toBeInTheDocument();
    expect(within(sonicReport).getAllByText("2")).toHaveLength(2);

    await click(screen.getByRole("tab", { name: "Individual files" }));
    expect(await screen.findByText("26 files")).toBeInTheDocument();
    expect(screen.getAllByText(/A Sonic Holiday/).length).toBeGreaterThan(1);
  });

  it("reviews and queues the best matching source while preserving companion files", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Archive" }));
    await click(screen.getByRole("tab", { name: "Wanted 3" }));

    const highAndDry = screen.getByText("High ’n’ Dry").closest("article") as HTMLElement;
    await click(within(highAndDry).getByRole("button", { name: "Download best" }));
    expect(screen.getByRole("heading", { name: "Review the best transmission." })).toBeInTheDocument();
    expect(await screen.findByText("Folder verified")).toBeInTheDocument();
    expect(screen.getByText("Companion")).toBeInTheDocument();
    const queueComplete = await screen.findByRole("button", { name: "Queue complete album" });
    await waitFor(() => expect(queueComplete).toBeEnabled());
    await click(queueComplete);

    expect(await within(screen.getByRole("dialog")).findByRole("button", { name: "Queued" })).toBeDisabled();
    await click(screen.getByRole("button", { name: "Close Smart Match review" }));
    expect(within(highAndDry).getByRole("button", { name: /Queued #\d+/ })).toBeEnabled();

    await click(screen.getByRole("tab", { name: /Fulfilled/ }));
    expect(screen.getByText("Hysteria")).toBeInTheDocument();
    expect(screen.getByText(/Fulfilled by Forever/)).toBeInTheDocument();
    expect(screen.getByText("Verified download")).toBeInTheDocument();
    expect(screen.getByText("105.0 MB · from signalsource")).toBeInTheDocument();
  });

  it("opens Browse as a dedicated workspace before requesting a user's shares", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Browse" }));
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
    await click(screen.getByRole("button", { name: "Browse shares" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /audiophile92’s shares/ }),
      ).toBeInTheDocument(),
    );
  });

  it("browses a folder, selects files, and queues a complete release", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(
      screen.getByRole("button", { name: "Expand transfer activity" }),
    );
    await click(
      screen.getByRole("button", { name: "Pause Night Geometry" }),
    );
    expect(
      screen.getByRole("button", { name: "Resume Night Geometry" }),
    ).toBeInTheDocument();

    await click(
      screen.getByRole("button", { name: "Resume Night Geometry" }),
    );
    await click(
      screen.getByRole("button", { name: "Cancel Night Geometry" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel Night Geometry" }),
      ).not.toBeInTheDocument(),
    );
    await click(screen.getByRole("button", { name: "Browse folder" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download 12 files" }),
      ).toBeInTheDocument(),
    );
    await click(
      screen.getByRole("button", { name: "Deselect 01 - Thresholds.flac" }),
    );
    expect(
      screen.getByRole("button", { name: "Download 11 files" }),
    ).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Download 11 files" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Transfers" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Night Geometry").length).toBeGreaterThan(0);
  });

  it("explores a user's complete shares and downloads a selection", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(
      screen.getAllByRole("button", {
        name: "Browse files shared by audiophile92",
      })[0],
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /audiophile92’s shares/ }),
      ).toBeInTheDocument(),
    );

    await click(screen.getByRole("button", { name: "Select folder" }));
    expect(screen.getByText("14 files selected")).toBeInTheDocument();
    await click(
      screen.getByRole("button", { name: "Deselect 01 - Thresholds.flac" }),
    );
    expect(screen.getByText("13 files selected")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Download selection" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Downloading · \d+%|Queued #\d+/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: /audiophile92’s shares/ })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: /Downloading · \d+%|Queued #\d+/ }));
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toHaveTextContent("audiophile92 selection");
  });

  it("searches folders and expands or collapses the share hierarchy", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(
      screen.getAllByRole("button", {
        name: "Browse files shared by audiophile92",
      })[0],
    );
    const shares = await screen.findByRole("region", {
      name: "audiophile92's shared files",
    });
    expect(within(shares).getByRole("button", { name: "Collapse Music" })).toBeInTheDocument();
    expect(within(shares).getByRole("button", { name: "Collapse Liminal Structures" })).toBeInTheDocument();

    await click(within(shares).getByRole("button", { name: "Collapse Liminal Structures" }));
    expect(
      within(shares).queryByRole("button", { name: /^Night Geometry/ }),
    ).not.toBeInTheDocument();
    await click(within(shares).getByRole("button", { name: "Expand Liminal Structures" }));
    expect(
      within(shares).getByRole("button", { name: /^Night Geometry/ }),
    ).toBeInTheDocument();

    fireEvent.change(within(shares).getByRole("textbox", { name: "Search this user's shares" }), {
      target: { value: "Signal Bloom" },
    });
    await click(within(shares).getByRole("button", { name: "Search" }));
    expect(
      within(shares).getByRole("button", {
        name: "Open folder Music\\Electronic\\Liminal Structures\\Signal Bloom",
      }),
    ).toBeInTheDocument();
    expect(within(shares).getByText("1 folder · 3 files for “Signal Bloom”")).toBeInTheDocument();
  });

  it("opens the release-grouped Transfers workspace and filters completed releases", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Transfers" }));
    const workspace = screen
      .getByRole("heading", { name: "Transfers" })
      .closest("section") as HTMLElement;
    expect(
      screen.getByRole("button", { name: "Pause 04 - Night Geometry.flac" }),
    ).toBeInTheDocument();
    // The preview advances every 500 ms; duration math is tested in transfers.test.
    expect(screen.getAllByText(/Album ETA \d+m \d+s/).length).toBeGreaterThan(0);

    await click(screen.getByRole("tab", { name: "Completed 2" }));
    expect(within(workspace).getByText("Apex Horizon (Deluxe)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Spheric Dusk")).not.toBeInTheDocument();
  });

  it("treats Archive-owned departed audio as filed away and switches exact alternative sources", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Transfers" }));
    expect(screen.getByLabelText("Finish Line release health")).toBeInTheDocument();
    const workspace = screen.getByRole("heading", { name: "Transfers" }).closest("section") as HTMLElement;

    await click(screen.getByRole("tab", { name: "Completed 2" }));
    const apex = within(workspace).getByText("Apex Horizon (Deluxe)").closest("article") as HTMLElement;
    await waitFor(() => expect(within(apex).getByText("Filed away")).toBeInTheDocument());
    expect(within(apex).getByText(/1 file moved from downloads · Archive owns album/)).toBeInTheDocument();
    expect(within(apex).getByText("Filed away in Music Library")).toBeInTheDocument();
    expect(within(apex).queryByText("Needs attention")).not.toBeInTheDocument();
    expect(within(apex).getByRole("button", { name: "Download Apex Horizon (Deluxe) again" })).toBeInTheDocument();
    await click(within(apex).getByRole("button", { name: "Expand Apex Horizon (Deluxe)" }));
    expect(within(apex).getAllByRole("button", { name: "Download Apex Horizon (Deluxe) again" })).toHaveLength(2);
    expect(within(apex).queryByRole("button", { name: "Reveal 01 - First Light.mp3" })).not.toBeInTheDocument();

    await click(screen.getByRole("tab", { name: /All/ }));
    expect(within(workspace).getByText("Apex Horizon (Deluxe)")).toBeInTheDocument();

    const spheric = within(workspace).getByText("Spheric Dusk").closest("article") as HTMLElement;
    await click(within(spheric).getByRole("button", { name: "Expand Spheric Dusk" }));
    const alternatives = within(spheric).getByText("Alternative signals").closest("details") as HTMLElement;
    await click(within(alternatives).getByText("Alternative signals"));
    expect(within(alternatives).getByText("2/2 exact")).toBeInTheDocument();
    await click(within(alternatives).getByRole("button", { name: /signalrelay/ }));
    await waitFor(() => expect(within(spheric).getAllByText("signalrelay").length).toBeGreaterThan(0));
  });

  it("shows outgoing uploads with live progress in Transfers", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Transfers" }));
    await click(screen.getByRole("tab", { name: "Uploads 1" }));

    expect(screen.getByText("04 Endorphin.flac")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lowlight.fm/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel upload 04 Endorphin.flac" })).toBeInTheDocument();
  });

  it("opens a source's shares from transfer history", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Transfers" }));
    await click(screen.getAllByRole("button", { name: /audiophile92/ })[0]);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Your corner of the network" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "audiophile92" })).toBeInTheDocument();
  });

  it("opens People with live presence, country flags, favorites, and profile details", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "People" }));

    expect(
      screen.getByRole("heading", { name: "Your corner of the network" }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("Netherlands").length).toBeGreaterThan(0);
    expect(screen.getByText("24K")).toBeInTheDocument();
    expect(screen.getByText("8.2 MB/s")).toBeInTheDocument();
    expect(screen.getByText("field recordings")).toBeInTheDocument();

    const saved = screen.getByRole("button", { name: "Saved" });
    await click(saved);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opens the Midnight Inbox from a person profile and sends a message", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "People" }));
    await click(screen.getByRole("button", { name: "Message" }));

    const inbox = screen.getByRole("region", { name: "Midnight Inbox" });
    expect(within(inbox).getByRole("heading", { name: "Midnight Inbox" })).toBeInTheDocument();
    expect(within(inbox).getByText(/late-night radio session/)).toBeInTheDocument();
    const composer = within(inbox).getByRole("textbox", { name: "Message audiophile92" });
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: "That would be wonderful." } });
    await click(within(inbox).getByRole("button", { name: "Send" }));
    expect(await within(inbox).findByText("That would be wonderful.")).toBeInTheDocument();
  });

  it("searches message history and retries a failed transmission", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Messages" }));

    const inbox = screen.getByRole("region", { name: "Midnight Inbox" });
    fireEvent.change(
      within(inbox).getByRole("textbox", { name: "Search conversations and messages" }),
      { target: { value: "cue-sheet" } },
    );
    const vinylConversation = await within(inbox).findByRole("button", {
      name: /vinyljunkie/,
    });
    await click(vinylConversation);
    expect(within(inbox).getByText("Failed")).toBeInTheDocument();
    await click(within(inbox).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(within(inbox).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument(),
    );
  });

  it("starts a new exact-username conversation and preserves its draft", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Messages" }));
    await click(screen.getByRole("button", { name: "New message" }));
    fireEvent.change(screen.getByLabelText("Exact Soulseek username"), {
      target: { value: "fieldrecorder" },
    });
    await click(screen.getByRole("button", { name: "Open new conversation" }));

    const composer = await screen.findByRole("textbox", { name: "Message fieldrecorder" });
    fireEvent.change(composer, { target: { value: "Holding this thought for later." } });
    expect(window.localStorage.getItem(MESSAGE_DRAFTS_STORAGE_KEY)).toContain(
      "Holding this thought for later.",
    );
    await click(screen.getByRole("button", { name: "Search" }));
    await click(screen.getByRole("button", { name: "Messages" }));
    expect(screen.getByRole("textbox", { name: "Message fieldrecorder" })).toHaveValue(
      "Holding this thought for later.",
    );
  });

  it("opens a user profile directly from a search result", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Search" }));

    await click(
      screen.getAllByRole("button", { name: "View audiophile92's profile" })[0],
    );

    expect(
      screen.getByRole("heading", { name: "Your corner of the network" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "audiophile92" })).toBeInTheDocument();
  });

  it("retains saved upload policy when returning to Settings", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Files per user" }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "MB per user" }), { target: { value: "2500" } });
    await click(screen.getByRole("checkbox", { name: "Favorites first within each turn" }));
    await click(screen.getByRole("button", { name: "Save upload policy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save upload policy" })).toBeDisabled());
    await click(screen.getByRole("button", { name: "Home" }));
    await click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("spinbutton", { name: "Files per user" })).toHaveValue(50);
    expect(screen.getByRole("spinbutton", { name: "MB per user" })).toHaveValue(2500);
    expect(screen.getByRole("checkbox", { name: "Favorites first within each turn" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Privileged users first within each turn" })).not.toBeChecked();
  });

  it("opens the live connection settings from the sidebar", async () => {
    await renderApp();

    await click(screen.getByRole("button", { name: "Settings" }));

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
    expect(screen.getByText(/Watching folders for changes/)).toHaveTextContent("Last update: 1,245 cached, 3 inspected");
    expect(screen.getByRole("button", { name: "Rescan" })).toBeEnabled();
    const notifications = screen.getByRole("checkbox", {
      name: /Private-message alerts/,
    });
    expect(notifications).toBeChecked();
    await click(notifications);
    expect(getSettingsState().settings.preferences.messageNotificationsEnabled).toBe(false);
    const roomNotifications = screen.getByRole("checkbox", {
      name: /Room alerts/,
    });
    expect(roomNotifications).toBeChecked();
    await click(roomNotifications);
    expect(getSettingsState().settings.preferences.roomNotificationsEnabled).toBe(false);
  });

  it("checks for updates every six hours by default and retains cadence and channel choices", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const view = await renderApp();

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 21_600_000);
    await click(screen.getByRole("button", { name: "Settings" }));

    const interval = screen.getByRole("combobox", {
      name: /Automatic update checks/,
    });
    expect(interval).toHaveValue("360");
    const channel = screen.getByRole("combobox", { name: "Update channel" });
    expect(channel).toHaveValue("stable");
    fireEvent.change(channel, { target: { value: "beta" } });
    expect(getSettingsState().settings.preferences.updateChannel).toBe("beta");
    expect(screen.getByText(/Returning to Stable waits/)).toBeInTheDocument();
    fireEvent.change(interval, { target: { value: "15" } });
    expect(getSettingsState().settings.preferences.updateCheckIntervalMinutes).toBe(
      15,
    );
    const downloadLanes = screen.getByRole("combobox", {
      name: "Simultaneous download users",
    });
    expect(downloadLanes).toHaveValue("3");
    fireEvent.change(downloadLanes, { target: { value: "5" } });
    expect(downloadLanes).toHaveValue("5");
    expect(screen.getByText("1/5 lanes · 4 releases")).toBeInTheDocument();
    const relayDelay = screen.getByRole("combobox", {
      name: "Signal Relay suggestion delay",
    });
    expect(relayDelay).toHaveValue("10");
    fireEvent.change(relayDelay, { target: { value: "20" } });
    expect(relayDelay).toHaveValue("20");
    const autoMirror = screen.getByRole("combobox", { name: "Auto-switch to exact mirrors" });
    expect(autoMirror).toHaveValue("0");
    fireEvent.change(autoMirror, { target: { value: "5" } });
    expect(autoMirror).toHaveValue("5");
    expect(getSettingsState().settings.transfers.autoMirrorMinutes).toBe(5);
    const soundcheck = screen.getByRole("checkbox", {
      name: /Automatic Soundcheck/,
    });
    expect(soundcheck).toBeChecked();
    await click(soundcheck);
    expect(soundcheck).not.toBeChecked();

    view.unmount();
    await renderApp();
    await click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("combobox", { name: /Automatic update checks/ }),
    ).toHaveValue("15");
    expect(screen.getByRole("combobox", { name: "Update channel" })).toHaveValue("beta");
    expect(screen.getByRole("combobox", { name: "Auto-switch to exact mirrors" })).toHaveValue("5");
  });

  it("shows the release changelog in the update prompt", async () => {
    window.history.replaceState({}, "", "/?update=available");
    await renderApp();

    await click(
      await screen.findByRole("button", { name: "Update" }, { timeout: 2_000 }),
    );
    expect(
      screen.getByRole("heading", { name: "Forever 0.0.77 is ready." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update available" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Limit combined, download, and upload bandwidth across all transfer lanes.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Schedule alternate limits by local time, including overnight windows.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Safe Passage update choices" }),
    ).toBeInTheDocument();
    await click(
      screen.getByRole("button", { name: /Finish active files first/ }),
    );
    expect(await screen.findByText("Update scheduled")).toBeInTheDocument();
    expect(screen.getByText("Finishing active files…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Securing downloads for update" }),
    ).toBeInTheDocument();
  });

  it("guides a fresh profile through its first connection", async () => {
    window.history.replaceState({}, "", "/?onboarding=1");
    await renderApp();

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
    await click(
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
