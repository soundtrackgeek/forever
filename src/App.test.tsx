import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

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

  it("shows an empty state for an unmatched search", () => {
    render(<App />);

    const search = screen.getByRole("textbox", { name: "Search the network" });
    fireEvent.change(search, { target: { value: "unfindable transmission" } });
    fireEvent.submit(search.closest("form")!);

    expect(
      screen.getByRole("heading", { name: "No signals found" }),
    ).toBeInTheDocument();
  });
});
