import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("opens the live connection settings from the sidebar", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(
      screen.getByRole("heading", { name: "Connection" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Network online")).not.toHaveLength(0);
    expect(screen.getByDisplayValue("SignalLevel")).toBeInTheDocument();
  });

  it("guides a fresh profile through its first connection", async () => {
    window.history.replaceState({}, "", "/?onboarding=1");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Tune into Soulseek" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "MidnightListener" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "not-logged-or-persisted-by-the-preview" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect to Soulseek" }),
    );

    await waitFor(
      () =>
        expect(
          screen.queryByRole("heading", { name: "Tune into Soulseek" }),
        ).not.toBeInTheDocument(),
      { timeout: 3_000 },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "MidnightListener profile. Online. Open connection settings.",
        }),
      ).toBeInTheDocument(),
    );
  });
});
