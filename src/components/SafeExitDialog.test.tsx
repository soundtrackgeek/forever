import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SafeExitDialog } from "./SafeExitDialog";

describe("SafeExitDialog", () => {
  it("explains a failed idle save and offers a retry instead of claiming files are active", () => {
    const retry = vi.fn();
    render(<SafeExitDialog open activeCount={0} preparing={false} error="Disk full."
      onKeepRunning={vi.fn()} onPauseAndExit={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Disk full.");
    expect(screen.queryByText(/0 active files/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry save & exit" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("keeps the app open or starts a coordinated pause", () => {
    const onKeepRunning = vi.fn();
    const onPauseAndExit = vi.fn();
    render(
      <SafeExitDialog
        open
        activeCount={3}
        preparing={false}
        onKeepRunning={onKeepRunning}
        onPauseAndExit={onPauseAndExit}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Downloads are still moving." }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 active files are writing to disk.", { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause safely & exit" }));
    expect(onKeepRunning).toHaveBeenCalledOnce();
    expect(onPauseAndExit).toHaveBeenCalledOnce();
  });
});
