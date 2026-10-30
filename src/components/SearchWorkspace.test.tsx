import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ConnectionSnapshot, SearchResult, SearchSnapshot } from "../types";
import { defaultAdvancedFilters, type AdvancedSearchFilters } from "../utils/searchResults";
import { SearchWorkspace } from "./SearchWorkspace";

beforeEach(() => {
  // Give the virtual list a viewport so rows render in jsdom.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 600, width: 1000, x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 1000, toJSON: () => ({}) });
});

const file = (owner: string, folder: string, name: string): SearchResult => ({
  id: `${owner}:${folder}\\${name}`, title: name, filename: `${folder}\\${name}`, folder, owner,
  subtitle: folder, format: "MP3", quality: "320 kbps", size: "8 MB", sizeBytes: 8_000_000, bitrate: 320,
  tracks: 1, trust: 100, rating: 5, ratingLabel: "Ready", availability: [], slotFree: true, queueLength: 0,
  averageSpeed: 1000, source: "live",
});
const album = "Music\\Explosions in the Sky\\2004 - Friday Night Lights";
const results = [
  file("dcnck", album, "01 - From West Texas.mp3"),
  file("dcnck", album, "02 - Your Hand In Mine.mp3"),
  file("dcnck", album, "03 - Our Last Days As Children.mp3"),
  file("astro", "Mixes", "Friday Night Lights single.mp3"),
  file("cole", "OST\\Friday Night Lights", "01 - Home.mp3"),
  file("cole", "OST\\Friday Night Lights", "02 - Inside It All Feels The Same.mp3"),
];
const search: SearchSnapshot = { state: "completed", token: 7, clientId: "c", query: "friday night lights", resultCount: results.length, peerCount: 3, message: "Done", startedAtMs: 1, finishedAtMs: 2 };
const connection: ConnectionSnapshot = { state: "online", username: "me", server: "s", message: "", attempt: 0, connectedAtMs: 1, retryInSeconds: null, updatedAtMs: 1 };
const noop = () => undefined;

const view = (advancedFilters: AdvancedSearchFilters, onAdvancedFiltersChange = vi.fn()) => (
  <SearchWorkspace presetRail={null} sessionId="s1" scrollMemory={new Map()} filter="all" sort="best"
    advancedFilters={advancedFilters} onAdvancedFiltersChange={onAdvancedFiltersChange} layout="list"
    searchMode="files" albumContext={null} albumResultView="files" archiveConnected={false} archiveLoading={false}
    wantedAlbum={null} query="friday night lights" results={results} transfers={[]} selectedResult={null}
    search={search} searchError={null} connection={connection} onOpenConnection={noop} onFilterChange={noop}
    onSortChange={noop} onLayoutChange={noop} onQueryChange={noop} onSearch={noop} onStopSearch={noop}
    onSelectResult={noop} onQueueDownload={noop} onQueueAlbumSource={async () => undefined} onOpenTransfer={noop}
    onBrowseUser={noop} personByUsername={() => null} onOpenPerson={noop} onSearchModeChange={noop}
    onAlbumResultViewChange={noop} onToggleWanted={async () => undefined} onLoadOfficialTracklist={async () => []} />
);

it("starts in Albums only and shows loose files once it is switched off", () => {
  const onChange = vi.fn();
  const rendered = render(view(defaultAdvancedFilters, onChange));
  expect(screen.getByText("2 album folders")).toBeInTheDocument();
  expect(screen.getByLabelText("Albums only")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Albums only"));
  expect(onChange).toHaveBeenCalledWith({ ...defaultAdvancedFilters, albumsOnly: false });
  rendered.rerender(view({ ...defaultAdvancedFilters, albumsOnly: false }, onChange));
  expect(screen.getByText("6 results")).toBeInTheDocument();
  expect(screen.queryByLabelText("Minimum album tracks")).not.toBeInTheDocument();
});

it("groups a plain file search into album folders with a default two-track minimum", async () => {
  render(view(defaultAdvancedFilters));
  expect(screen.getByText("2 album folders")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("2004 - Friday Night Lights")).toBeInTheDocument());
  expect(screen.getByText("Friday Night Lights")).toBeInTheDocument();
  expect(screen.queryByText("Mixes")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Minimum album tracks")).toHaveAttribute("placeholder", "2");
  // Without an official tracklist, downloads are not held back by a title check.
  expect(screen.getAllByRole("button", { name: /Download album/ })[0]).toBeEnabled();
});

it("applies a custom minimum album track count", async () => {
  render(view({ ...defaultAdvancedFilters, minimumAlbumTracks: 3 }));
  expect(screen.getByText("1 album folder")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("2004 - Friday Night Lights")).toBeInTheDocument());
  expect(screen.queryByText("Friday Night Lights")).not.toBeInTheDocument();
});
