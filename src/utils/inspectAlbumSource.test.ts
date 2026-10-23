import { expect, it, vi } from "vitest";
import type { FolderFile, FolderInspection } from "../types";
import { inspectAlbumSource } from "./inspectAlbumSource";

const file = (directory: string, filename = "01 Song.flac"): FolderFile => ({
  directory, filename, remoteFilename: directory + "\\" + filename, extension: "flac",
  sizeBytes: 10, bitrate: null, durationSeconds: 180, vbr: null, sampleRate: null, bitDepth: null,
});
const response = (folder: string, files: FolderFile[]): FolderInspection => ({
  username: "owner", token: 1, requestedFolder: folder, receivedAtMs: 1, files,
});
it("inspects all advertised discs, deduplicates parent listings and retains only this edition", async () => {
  const root = "Music\\Album";
  const first = root + "\\CD1", second = root + "\\Disc 2";
  const inspect = vi.fn(async (folder: string) => response(folder, folder === root
    ? [file(root, "cover.jpg"), file(first), file(root + "\\Deluxe")]
    : [file(folder)]));
  const album = await inspectAlbumSource(root, [first, second], inspect);
  expect(inspect.mock.calls.map(([folder]) => folder)).toEqual([root, first, second]);
  expect(album.files.map((f) => f.remoteFilename)).toEqual([
    first + "\\01 Song.flac", root + "\\cover.jpg", second + "\\01 Song.flac",
  ]);
  expect(album.requestedFolder).toBe(root);
});
it("allows a virtual parent but fails if any advertised disc cannot be verified", async () => {
  const inspect = vi.fn(async (folder: string) => {
    if (folder === "Album") throw new Error("virtual parent");
    if (folder.endsWith("CD2")) throw new Error("disc unavailable");
    return response(folder, [file(folder)]);
  });
  expect((await inspectAlbumSource("Album", ["Album\\CD1"], inspect)).files).toHaveLength(1);
  await expect(inspectAlbumSource("Album", ["Album\\CD1", "Album\\CD2"], inspect)).rejects.toThrow("disc unavailable");
  await expect(inspectAlbumSource("Album", ["Album", "Album\\CD1"], inspect)).rejects.toThrow("virtual parent");
});
