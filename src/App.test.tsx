import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { UPDATE_CHECK_INTERVAL_STORAGE_KEY } from "./hooks/useAppUpdater";

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

  it("streams a search and shows an empty state when no responses match", async () => {
    render(<App />);

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

    fireEvent.click(screen.getByRole("button", { name: "All types" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Compressed audio 1" }));

    expect(
      screen.getByText("1 result"),
    ).toBeInTheDocument();
    expect(screen.getByText("320 kbps")).toBeInTheDocument();
  });

  it("queues a first file and exposes pause and resume controls", async () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Pause 01 - Thresholds.flac" }),
    );
    expect(
      screen.getByRole("button", { name: "Resume 01 - Thresholds.flac" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Resume 01 - Thresholds.flac" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Get files" }));

    await waitFor(() =>
      expect(screen.getByText("Night Geometry.flac")).toBeInTheDocument(),
    );
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

    view.unmount();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("combobox", { name: /Automatic update checks/ }),
    ).toHaveValue("15");
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
