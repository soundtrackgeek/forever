import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BandwidthForm } from "./BandwidthSettings";
import { defaultBandwidth } from "../bandwidth";

describe("bandwidth policy", () => {
  it("saves combined and direction caps with an overnight unlimited window", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<BandwidthForm policy={defaultBandwidth()} onSave={save} />);
    fireEvent.change(screen.getByLabelText("Normal combined limit"), { target: { value: "1024" } });
    fireEvent.change(screen.getByLabelText("Normal upload limit"), { target: { value: "128" } });
    fireEvent.click(screen.getByLabelText("Use alternate limits on a daily schedule"));
    fireEvent.click(screen.getByLabelText("Pause file transfers on metered networks"));
    fireEvent.click(screen.getByRole("button", { name: "Save bandwidth settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...defaultBandwidth(), normal: { totalKib: 1024, downloadKib: 0, uploadKib: 128 }, scheduleEnabled: true, pauseOnMetered: true }));
  });
  it("rejects blank, negative, fractional and overlarge caps and equal schedule times", () => {
    const save = vi.fn();
    render(<BandwidthForm policy={defaultBandwidth()} onSave={save} />);
    for (const value of ["", "-1", "1.5", "1000001"]) {
      fireEvent.change(screen.getByLabelText("Normal combined limit"), { target: { value } });
      expect(screen.getByRole("button", { name: "Save bandwidth settings" })).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText("Normal combined limit"), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText("Use alternate limits on a daily schedule"));
    fireEvent.change(screen.getByLabelText("Alternate end time"), { target: { value: "23:00" } });
    expect(screen.getByRole("alert")).toHaveTextContent("distinct");
    expect(screen.getByRole("button", { name: "Save bandwidth settings" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps the draft and reports a failed save", async () => {
    render(<BandwidthForm policy={defaultBandwidth()} onSave={vi.fn().mockRejectedValue(new Error("Disk full"))} />);
    fireEvent.change(screen.getByLabelText("Normal download limit"), { target: { value: "64" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bandwidth settings" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Disk full"));
    expect(screen.getByLabelText("Normal download limit")).toHaveValue(64);
  });
});
