import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadPolicySettings } from "./UploadPolicySettings";

const policy = { maxFilesPerUser: 100, maxMegabytesPerUser: 10_000, prioritizeFavorites: false, prioritizePrivileged: false };

describe("Upload policy", () => {
  it("saves both limits and priority switches together and prevents overlapping saves", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<UploadPolicySettings policy={policy} onSave={save} />);
    expect(screen.getByRole("button", { name: "Save upload policy" })).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Files per user" }), { target: { value: "25" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "MB per user" }), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Favorites first within each turn" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Privileged users first within each turn" }));
    fireEvent.click(screen.getByRole("button", { name: "Save upload policy" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ maxFilesPerUser: 25, maxMegabytesPerUser: 2000, prioritizeFavorites: true, prioritizePrivileged: true });
    expect(screen.getByRole("spinbutton", { name: "Files per user" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save upload policy" })).toBeEnabled());
  });

  it("keeps the draft and exposes save failures for retry", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Disk is full"));
    render(<UploadPolicySettings policy={policy} onSave={save} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Files per user" }), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save upload policy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk is full");
    expect(screen.getByRole("spinbutton", { name: "Files per user" })).toHaveValue(40);
    expect(screen.getByRole("button", { name: "Save upload policy" })).toBeEnabled();
  });

  it("uses required integer bounds before submitting the form", () => {
    render(<UploadPolicySettings policy={policy} onSave={vi.fn()} />);
    const files = screen.getByRole("spinbutton", { name: "Files per user" });
    for (const value of ["", "0", "501", "2.5"]) {
      fireEvent.change(files, { target: { value } });
      expect(files).toBeInvalid();
    }
    fireEvent.change(files, { target: { value: "500" } });
    expect(files).toBeValid();
  });
});
