import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StorageNotices } from "./StorageNotices";

describe("storage recovery notices", () => {
  it("shows recovery details without a dialog and dismisses only notices already seen", () => {
    const recovered = { store: "transfers.json", message: "Restored the previous saved copy." };
    const blocked = { store: "wanted.json", message: "Store version 99 is not supported. Changes cannot be saved." };
    const { rerender } = render(<StorageNotices notices={[recovered]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("View recovery details (1 store)"));
    expect(screen.getByText(/Restored the previous saved copy/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<StorageNotices notices={[recovered, blocked]} />);
    expect(screen.getByRole("status")).toHaveTextContent("wanted.json");
    expect(screen.getByRole("status")).not.toHaveTextContent("transfers.json");
  });

  it("renders nothing for a healthy startup", () => {
    render(<StorageNotices notices={[]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
