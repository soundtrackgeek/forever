import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { FilingPanel } from "./FilingPanel";
import { filingApi, type FilingPlan, type FilingRecord } from "../filing";
import { acceptSettings, defaultSettings } from "../settings";
import { groupTransfers } from "../utils/transfers";
import type { Transfer } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
const transfer: Transfer = { id:"a", releaseId:"release", releaseTitle:"Artist - Album (1994)", title:"01 Song.wav", username:"peer", remoteFilename:"music/01 Song.wav", sizeBytes:100, transferredBytes:100, speedBytesPerSecond:0, etaSeconds:0, status:"completed", queuePosition:null, localPath:"C:\\Downloads\\01 Song.wav", error:null, createdAtMs:1, updatedAtMs:1 };
const group = groupTransfers([transfer])[0];
const plan: FilingPlan = { id:"plan", releaseId:"release", title:group.title, albumDirectory:"C:\\Library\\Artist\\Album", files:[{transferId:"a", source:transfer.localPath, destination:"C:\\Library\\Artist\\Album\\101 Song.wav", backup:"C:\\Downloads\\.forever-undo-a.wav", before:[["Title","Old title"]], tags:{title:"Song",artist:"Artist",albumArtist:"Artist",album:"Album",date:"1994",disc:1,track:1,releaseGroupId:null,releaseId:null,recordingId:null}}], artworkBytes:0,warnings:["Review your mapping"],beetsCommand:"beet import -t -- 'C:\\Library\\Artist\\Album'" };

beforeEach(() => {
  const defaults = defaultSettings(); defaults.transfers.filing!.libraryRoot = "C:\\Library"; acceptSettings(defaults);
  vi.spyOn(filingApi, "history").mockResolvedValue([]);
  vi.spyOn(filingApi, "notices").mockResolvedValue([]);
  vi.spyOn(filingApi, "preview").mockResolvedValue(plan);
  vi.spyOn(filingApi, "apply").mockResolvedValue({ plan, state:"filed" });
  vi.spyOn(filingApi, "undoPreview").mockResolvedValue({plan,state:"filed"});
  vi.spyOn(filingApi, "undo").mockResolvedValue({plan,state:"undone"});
});
it("requires review, applies only the reviewed plan, then previews undo before restoring", async () => {
  render(<FilingPanel group={group} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:"Preview tags and paths"}));
  const apply = await screen.findByRole("button", {name:"Apply filing"}); expect(apply).toBeDisabled();
  expect(filingApi.preview).toHaveBeenCalledWith(expect.objectContaining({releaseId:"release",tracks:[expect.objectContaining({transferId:"a"})]}));
  fireEvent.click(screen.getByLabelText("I reviewed the track assignments, tags, and destination paths."));
  vi.mocked(filingApi.history).mockResolvedValue([{plan,state:"filed"}]);
  fireEvent.click(apply); await waitFor(() => expect(filingApi.apply).toHaveBeenCalledWith("plan"));
  fireEvent.click(await screen.findByRole("button", {name:"Preview undo"}));
  expect(filingApi.undo).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", {name:"Confirm undo filing"}));
  await waitFor(() => expect(filingApi.undo).toHaveBeenCalledWith("plan"));
  expect(await screen.findByText("Original files and transfer paths restored.")).toBeVisible();
});
it("invalidates a reviewed preview when tags or destination settings change", async () => {
  render(<FilingPanel group={group} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:"Preview tags and paths"})); await screen.findByRole("button", {name:"Apply filing"});
  fireEvent.change(screen.getByLabelText("Track artist — file 1"), {target:{value:"Correct Artist"}});
  expect(screen.queryByRole("button", {name:"Apply filing"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"Preview tags and paths"})); await screen.findByRole("button", {name:"Apply filing"});
  fireEvent.change(screen.getByLabelText("Naming template"), {target:{value:"{album}/{title}"}});
  expect(screen.queryByRole("button", {name:"Apply filing"})).not.toBeInTheDocument();
  expect(filingApi.apply).not.toHaveBeenCalled();
});
it("surfaces preview collisions without allowing apply", async () => {
  vi.mocked(filingApi.preview).mockRejectedValue(new Error("Destination already exists"));
  render(<FilingPanel group={group} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:"Preview tags and paths"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Destination already exists");
  expect(screen.queryByRole("button", {name:"Apply filing"})).not.toBeInTheDocument();
});
it("keeps interrupted operations reviewable after remount and blocks unsafe undo", async () => {
  const interrupted: FilingRecord = {plan,state:"applying"};
  vi.mocked(filingApi.history).mockResolvedValue([interrupted]);
  vi.mocked(filingApi.undoPreview).mockRejectedValue(new Error("File changed since review"));
  render(<FilingPanel group={null} onClose={vi.fn()} />);
  expect(await screen.findByText("Interrupted — review and undo")).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name:"Preview undo"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("File changed since review");
  expect(screen.queryByRole("button", {name:"Confirm undo filing"})).not.toBeInTheDocument();
});

it("requires an explicit track assignment and does not treat another edition as already mapped", async () => {
  vi.mocked(invoke).mockResolvedValue({ releases: [{id:"edition-one",title:"Album",date:"1994",trackCount:1},{id:"edition-two",title:"Album",date:"2001",trackCount:1}], truncated:false });
  const tagged = { ...plan.files[0].tags!, title:"Official song",releaseGroupId:"group",releaseId:"edition-one",recordingId:"recording" };
  vi.spyOn(filingApi, "metadata").mockResolvedValue([tagged]);
  render(<FilingPanel group={group} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("MusicBrainz release group ID"), {target:{value:"group"}});
  fireEvent.click(screen.getByRole("button", {name:"Find editions"}));
  fireEvent.change(await screen.findByLabelText("MusicBrainz edition"), {target:{value:"edition-one"}});
  fireEvent.click(screen.getByRole("button", {name:"Load edition tags"}));
  const mapping = await screen.findByLabelText("Assign MusicBrainz track for file 1");
  expect(mapping).toHaveValue("-1");
  expect(screen.getByLabelText("Title — file 1")).toHaveValue("Song");
  fireEvent.change(mapping, {target:{value:"0"}});
  expect(screen.getByLabelText("Title — file 1")).toHaveValue("Official song");
  vi.mocked(filingApi.metadata).mockResolvedValue([{...tagged,releaseId:"edition-two"}]);
  fireEvent.change(screen.getByLabelText("MusicBrainz edition"), {target:{value:"edition-two"}});
  fireEvent.click(screen.getByRole("button", {name:"Load edition tags"}));
  expect(await screen.findByLabelText("Assign MusicBrainz track for file 1")).toHaveValue("-1");
});
