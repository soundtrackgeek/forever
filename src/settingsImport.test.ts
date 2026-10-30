import { expect, it } from "vitest";
import { defaultSettings, validateSettingsImport } from "./settings";
import { defaultAdvancedFilters } from "./utils/searchResults";

// Browser-preview path (outside Tauri); the desktop path is covered in Rust.
it("imports settings exported before newer advanced filter fields existed", async () => {
  const settings = defaultSettings();
  const legacyFilters: Record<string, unknown> = { ...defaultAdvancedFilters };
  delete legacyFilters.albumsOnly;
  delete legacyFilters.minimumAlbumTracks;
  settings.dialMemory.pinned = [{ id: "p", mode: "files", query: "friday night lights", searchFilter: "all", searchSort: "best", searchLayout: "list", albumFilter: "all", advancedFilters: legacyFilters as typeof defaultAdvancedFilters }];
  await expect(validateSettingsImport(JSON.stringify(settings))).resolves.toBeTruthy();
});
