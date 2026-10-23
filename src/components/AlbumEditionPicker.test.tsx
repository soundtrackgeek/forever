import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AlbumEditionPicker } from "./AlbumEditionPicker";
import type { AlbumEditions } from "../types";
const editions: AlbumEditions = { defaultReleaseId: "deluxe", truncated: true, releases: [
  { id: "deluxe", title: "Album", date: "2000", country: "JP", disambiguation: "Deluxe remaster",
    trackCount: 20, media: [{ format: "CD", trackCount: 20 }] },
] };
it("shows edition evidence, saves the choice, and keeps the old choice on failure", async () => {
  const save = vi.fn().mockRejectedValue(new Error("could not save"));
  render(<AlbumEditionPicker albumId="album" onLoad={async () => editions} onSelect={save} />);
  await screen.findByRole("option", { name: /2000.*JP.*Deluxe remaster.*20 tracks/ });
  expect(screen.getByText(/list is incomplete/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "deluxe" } });
  await screen.findByText(/could not save/);
  expect(save).toHaveBeenCalledWith("deluxe");
  expect(screen.getByRole("combobox")).toHaveValue("");
});
it("discards an old album's release list when its request finishes late", async () => {
  let resolve!: (value: AlbumEditions) => void;
  const old = new Promise<AlbumEditions>((done) => { resolve = done; });
  const load = vi.fn((id: string) => id === "old" ? old : Promise.resolve({ ...editions, releases: [] }));
  const { rerender } = render(<AlbumEditionPicker albumId="old" onLoad={load} onSelect={vi.fn()} />);
  rerender(<AlbumEditionPicker albumId="new" onLoad={load} onSelect={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  await act(async () => resolve(editions));
  expect(screen.queryByRole("option", { name: /Deluxe remaster/ })).not.toBeInTheDocument();
});
