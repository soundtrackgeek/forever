import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { UPDATE_CHECK_INTERVAL_STORAGE_KEY } from "./hooks/useAppUpdater";
import { MESSAGE_NOTIFICATION_STORAGE_KEY } from "./hooks/usePrivateMessages";
import { ROOM_NOTIFICATION_STORAGE_KEY } from "./hooks/useSoulseekRooms";
import { MESSAGE_DRAFTS_STORAGE_KEY } from "./components/MessagesWorkspace";

describe("Forever shell", () => {
  it("opens The Listening Post first and routes every live signal to its exact workspace", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "The Listening Post" })).toBeInTheDocument();
    expect(screen.getByText("Everything worth hearing, waiting in one place.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("2 new Wanted matches")).toBeInTheDocument();
    expect(screen.getByText("1 unread message")).toBeInTheDocument();
    expect(screen.getByText("1 room mention")).toBeInTheDocument();
    expect(screen.getByText("72,366")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open transfer/ }));
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toHaveTextContent("Night Geometry");

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: /2 new Wanted matches/ }));
    expect(screen.getByRole("tab", { name: "Wanted 4" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: /1 room mention/ }));
    expect(screen.getByRole("heading", { name: "Lossless Listening" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: /1 unread message/ }));
    expect(screen.getByRole("region", { name: "Midnight Inbox" })).toBeInTheDocument();
    expect(screen.getByText(/late-night radio session/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Missing Shelf" }));
    expect(screen.getByRole("tab", { name: "Missing shelf" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders the Midnight Radio search workspace", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("heading", { name: "Across the network" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("night geometry")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Night Geometry" })).toHaveLength(2);
  });

  it("keeps independent Dial Memory searches and reopens a recently closed preset", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("tab", { name: /night geometryFiles 6 results/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Def LeppardAlbums 8 albums/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /rare Bowie demosFiles/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Kate Bush" })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("New search (Ctrl+T)"));
    const input = screen.getByRole("textbox", { name: "Search the network" });
    fireEvent.change(input, { target: { value: "Def Leppard Hysteria" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(screen.getByRole("tab", { name: /night geometryFiles 6 results/ }));
    expect(screen.getAllByRole("heading", { name: "Night Geometry" })).toHaveLength(2);
    const background = await screen.findByRole(
      "tab",
      { name: /Def Leppard HysteriaFiles 39 new/ },
      { timeout: 1_800 },
    );

    fireEvent.click(background);
    expect(screen.getByDisplayValue("Def Leppard Hysteria")).toBeInTheDocument();
    expect(screen.getAllByText(/1987 - Hysteria \[FLAC\]/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Pin Def Leppard Hysteria" }));
    expect(screen.getByRole("button", { name: "Unpin Def Leppard Hysteria" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Def Leppard Hysteria" }));
    expect(screen.queryByDisplayValue("Def Leppard Hysteria")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Recently closed/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Def Leppard Hysteria/ }));
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

  it("joins, reads, and writes in the public Rooms workspace", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
    expect(screen.getByRole("heading", { name: "Rooms" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lossless Listening" })).toBeInTheDocument();
    expect(screen.getByText(/Japanese pressing/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: /Post-Punk/ }));
    expect(screen.getByText(/previewing directory/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    const composer = await screen.findByRole("textbox", { name: "Message Post-Punk" });
    fireEvent.change(composer, { target: { value: "The signal is clear." } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(await screen.findByText("The signal is clear.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      screen.getByRole("heading", { name: "Across the network" }),
    ).toBeInTheDocument();
  });

  it("streams a search and shows an empty state when no responses match", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(screen.getByRole("button", { name: "All types" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Compressed audio 1" }));

    expect(
      screen.getByText("1 result"),
    ).toBeInTheDocument();
    expect(screen.getByText("320 kbps")).toBeInTheDocument();
  });

  it("discovers an artist's albums and groups Soulseek files into downloadable sources", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(screen.getByRole("tab", { name: "Albums" }));
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
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);

    const previewTracks = screen.getAllByRole("button", {
      name: /Preview tracks in/,
    })[0];
    fireEvent.mouseEnter(previewTracks);
    const trackPreview = screen.getByRole("tooltip");
    expect(within(trackPreview).getByText("01 - Women.flac")).toBeInTheDocument();
    expect(within(trackPreview).getByText("12")).toBeInTheDocument();
    fireEvent.mouseLeave(previewTracks);

    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Night Geometry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Spheric Dusk" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Cancel Night Geometry" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Cancel Spheric Dusk" }),
      ).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Download album" })[0]);
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

    fireEvent.click(screen.getAllByRole("button", { name: "Download album" })[0]);
    const queued = await screen.findByRole(
      "button",
      { name: "Queued #1" },
      { timeout: 1_500 },
    );
    expect(queued).toHaveClass("is-queued");
    expect(queued).toBeEnabled();
    expect(await screen.findByText("Release queued")).toBeInTheDocument();
    fireEvent.click(queued);
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toBeInTheDocument();
    expect(
      screen.getAllByText("Def Leppard - Hysteria (1987)").length,
    ).toBeGreaterThan(0);
  }, 10_000);

  it("uses Music Library as a read-only Archive without adopting downloads", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(
      screen.getByRole("heading", { name: "Your collection, without touching it." }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Archive connected")).toBeInTheDocument();
    expect(
      screen.getByText(/com\.local\.musiclibrary\\music-library\.sqlite3/),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-only by construction")).toBeInTheDocument();
    expect(
      screen.getByText(/completed download stays watched until Music Library reports it as owned/),
    ).toBeInTheDocument();
    expect(screen.getByText("72,366")).toBeInTheDocument();
    expect(screen.getByText("1,101,878")).toBeInTheDocument();
  });

  it("finds collection gaps and adds a batch to Wanted with one Smart Match profile", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("tab", { name: "Missing shelf" }));

    expect(screen.getByRole("heading", { name: "Def Leppard" })).toBeInTheDocument();
    expect(screen.getByText("3/10")).toBeInTheDocument();
    expect(screen.getByText(/Music Library cache/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select Adrenalize" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Slang" }));
    expect(screen.getByText("2 missing selected")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Bulk format preference" }), {
      target: { value: "losslessOnly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add 2 to Wanted" }));
    expect(await screen.findByText("2 added to Wanted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    expect(screen.getByText("Viva! Hysteria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Wanted 6" }));
    expect(screen.getByText("Adrenalize")).toBeInTheDocument();
    expect(screen.getByText("Slang")).toBeInTheDocument();
  });

  it("scans one missing album, previews sources, downloads the best copy, and starts a watch", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("tab", { name: "Missing shelf" }));

    const adrenalize = screen.getByText("Adrenalize").closest("article") as HTMLElement;
    fireEvent.click(within(adrenalize).getByRole("button", { name: /Not scanned/ }));
    expect(screen.getByText(/Shelf Radar · 0\/1/)).toBeInTheDocument();

    const lossless = await within(adrenalize).findByRole(
      "button",
      { name: /Lossless found/ },
      { timeout: 1_800 },
    );
    fireEvent.click(lossless);

    expect(screen.getByText("2 sources on radar")).toBeInTheDocument();
    expect(screen.getByText("rockvault")).toBeInTheDocument();
    const trackDetails = screen.getAllByText("Tracks")[0].closest("details") as HTMLDetailsElement;
    fireEvent.click(within(trackDetails).getByText("Tracks"));
    expect(within(trackDetails).getByText(/01 - Let’s Get Rocked\.flac/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download best" }));
    const queuedBest = await screen.findByRole("button", { name: "Queued #2" });
    expect(queuedBest).toBeEnabled();
    expect(screen.getByRole("button", { name: /Queued.*Adrenalize from rockvault/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download best" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Watch for better" }));
    await waitFor(() => expect(within(adrenalize).getAllByText("Wanted").length).toBeGreaterThan(0));
    fireEvent.click(queuedBest);
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toHaveTextContent("Def Leppard - Adrenalize (1992)");
  });

  it("watches missing albums and opens newly available sources without changing Archive", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(screen.getByRole("tab", { name: "Albums" }));
    const adrenalize = screen
      .getByRole("heading", { name: "Adrenalize" })
      .closest("article") as HTMLElement;
    fireEvent.click(
      within(adrenalize).getByRole("button", { name: "Add Adrenalize to Wanted" }),
    );
    expect(
      within(adrenalize).getByRole("button", { name: "Remove Adrenalize from Wanted" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wanted 5" }));
    expect(screen.getByText("High ’n’ Dry")).toBeInTheDocument();
    expect(screen.getByText("4 matching")).toBeInTheDocument();

    const highAndDry = screen.getByText("High ’n’ Dry").closest("article") as HTMLElement;
    fireEvent.click(within(highAndDry).getByRole("button", { name: "Edit High ’n’ Dry Smart Match profile" }));
    fireEvent.click(screen.getByRole("radio", { name: /Lossless only/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Minimum track count/ }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save match profile" }));
    expect(await screen.findByText("Lossless only · 10+ tracks")).toBeInTheDocument();

    const rhythm = screen.getByRole("combobox", { name: "Check rhythm" });
    fireEvent.change(rhythm, { target: { value: "15" } });
    expect(rhythm).toHaveValue("15");
    expect(screen.getByText(/Checks run every 15 minutes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Waiting/ }));
    const sonicHoliday = screen.getByText("A Sonic Holiday").closest("article") as HTMLElement;
    fireEvent.click(within(sonicHoliday).getByRole("button", { name: "Check A Sonic Holiday now" }));
    expect(within(sonicHoliday).getByText("Checking")).toBeInTheDocument();

    expect(
      await screen.findByText(/FLAC · 11 tracks · free slot for Engine Alley/, {}, { timeout: 1_500 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review match" }));
    expect(screen.getByRole("heading", { name: "Review the best transmission." })).toBeInTheDocument();
    expect(await screen.findByText("Folder verified")).toBeInTheDocument();
    expect(screen.getByText("Companion")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare alternatives" }));
    expect(
      screen.getByRole("heading", { name: "A Sonic Holiday — Engine Alley" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Engine Alley A Sonic Holiday")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove A Sonic Holiday from Wanted" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("reviews and queues the best matching source while preserving companion files", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wanted 4" }));

    const highAndDry = screen.getByText("High ’n’ Dry").closest("article") as HTMLElement;
    fireEvent.click(within(highAndDry).getByRole("button", { name: "Download best" }));
    expect(screen.getByRole("heading", { name: "Review the best transmission." })).toBeInTheDocument();
    expect(await screen.findByText("Folder verified")).toBeInTheDocument();
    expect(screen.getByText("Companion")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Queue complete album" }));

    expect(await within(screen.getByRole("dialog")).findByRole("button", { name: "Queued" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close Smart Match review" }));
    expect(within(highAndDry).getByRole("button", { name: /Queued #\d+/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("tab", { name: /Fulfilled/ }));
    expect(screen.getByText("Hysteria")).toBeInTheDocument();
    expect(screen.getByText("Fulfilled by Music Library")).toBeInTheDocument();
    expect(screen.getByText("Read-only source of truth")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel Night Geometry" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel Night Geometry" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse folder" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download 12 files" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Deselect 01 - Thresholds.flac" }),
    );
    expect(
      screen.getByRole("button", { name: "Download 11 files" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download 11 files" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Transfers" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Night Geometry").length).toBeGreaterThan(0);
  });

  it("explores a user's complete shares and downloads a selection", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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
      expect(screen.getByRole("button", { name: /Downloading · \d+%|Queued #\d+/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: /audiophile92’s shares/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Downloading · \d+%|Queued #\d+/ }));
    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(document.querySelector(".release-transfer-card.is-focus-target")).toHaveTextContent("audiophile92 selection");
  });

  it("searches folders and expands or collapses the share hierarchy", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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
    expect(screen.getAllByText(/Album ETA 1m 24s/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Completed 1" }));
    expect(within(workspace).getByText("Apex Horizon (Deluxe)")).toBeInTheDocument();
    expect(within(workspace).queryByText("Spheric Dusk")).not.toBeInTheDocument();
  });

  it("treats Archive-owned departed audio as filed away and switches exact alternative sources", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    expect(screen.getByLabelText("Finish Line release health")).toBeInTheDocument();
    const workspace = screen.getByRole("heading", { name: "Transfers" }).closest("section") as HTMLElement;

    fireEvent.click(screen.getByRole("tab", { name: "Completed 1" }));
    const apex = within(workspace).getByText("Apex Horizon (Deluxe)").closest("article") as HTMLElement;
    await waitFor(() => expect(within(apex).getByText("Filed away")).toBeInTheDocument());
    expect(within(apex).getByText(/1 file moved from downloads · Archive owns album/)).toBeInTheDocument();
    expect(within(apex).getByText("Filed away in Music Library")).toBeInTheDocument();
    expect(within(apex).queryByText("Needs attention")).not.toBeInTheDocument();
    expect(within(apex).getByRole("button", { name: "Download Apex Horizon (Deluxe) again" })).toBeInTheDocument();
    fireEvent.click(within(apex).getByRole("button", { name: "Expand Apex Horizon (Deluxe)" }));
    expect(within(apex).getAllByRole("button", { name: "Download Apex Horizon (Deluxe) again" })).toHaveLength(2);
    expect(within(apex).queryByRole("button", { name: "Reveal 01 - First Light.mp3" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    expect(within(workspace).getByText("Apex Horizon (Deluxe)")).toBeInTheDocument();

    const spheric = within(workspace).getByText("Spheric Dusk").closest("article") as HTMLElement;
    fireEvent.click(within(spheric).getByRole("button", { name: "Expand Spheric Dusk" }));
    const alternatives = within(spheric).getByText("Alternative signals").closest("details") as HTMLElement;
    fireEvent.click(within(alternatives).getByText("Alternative signals"));
    expect(within(alternatives).getByText("2/2 exact")).toBeInTheDocument();
    fireEvent.click(within(alternatives).getByRole("button", { name: /signalrelay/ }));
    await waitFor(() => expect(within(spheric).getAllByText("signalrelay").length).toBeGreaterThan(0));
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
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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
    const roomNotifications = screen.getByRole("checkbox", {
      name: /Room alerts/,
    });
    expect(roomNotifications).toBeChecked();
    fireEvent.click(roomNotifications);
    expect(window.localStorage.getItem(ROOM_NOTIFICATION_STORAGE_KEY)).toBe("false");
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
    const downloadLanes = screen.getByRole("combobox", {
      name: "Simultaneous download users",
    });
    expect(downloadLanes).toHaveValue("3");
    fireEvent.change(downloadLanes, { target: { value: "5" } });
    expect(downloadLanes).toHaveValue("5");
    expect(screen.getByText("1/5 lanes · 3 releases")).toBeInTheDocument();
    const relayDelay = screen.getByRole("combobox", {
      name: "Signal Relay suggestion delay",
    });
    expect(relayDelay).toHaveValue("10");
    fireEvent.change(relayDelay, { target: { value: "20" } });
    expect(relayDelay).toHaveValue("20");

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
      screen.getByRole("heading", { name: "Forever 0.0.43 is ready." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update available" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Release validation now gives frontend integration flows enough time on slower Windows runners.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Safe Passage remains unchanged: active downloads are still flushed, persisted, and resumed safely.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Safe Passage update choices" }),
    ).toBeInTheDocument();
    fireEvent.click(
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
