import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VirtualResultList, type ResultScrollMemory } from "./VirtualResultList";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("virtual-result-list") ? 400 : 60; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height || String(this.querySelectorAll('[data-result-index]').length * 60)); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.classList.contains("virtual-result-list") ? 400 : 60, width: 1000, x: 0, y: 0, top: 0, left: 0, bottom: 400, right: 1000, toJSON: () => ({}) }; });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0; this.dispatchEvent(new Event("scroll")); } });
});

const items = Array.from({ length: 5000 }, (_, index) => ({ id: `result-${index}` }));
const itemKey = (item: { id: string }) => item.id;
const content = (item: { id: string }) => <button>{item.id}</button>;
const view = (memory: ResultScrollMemory, count = 5000, signature = "first", columns = 1) =>
  <VirtualResultList items={items.slice(0, count)} itemKey={itemKey} className="result-list" label="Files" empty="No files" memory={memory} memoryKey="files" signature={signature} estimate={60} columns={columns}>{content}</VirtualResultList>;

it("bounds the DOM for 5,000 rows, reaches the end by keyboard, preserves append position and resets filters", async () => {
  const memory: ResultScrollMemory = new Map();
  const rendered = render(view(memory, 4800));
  await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
  expect(screen.getAllByRole("listitem").length).toBeLessThan(40);
  fireEvent.keyDown(screen.getByRole("list"), { key: "End" });
  await waitFor(() => expect(screen.getByRole("button", { name: "result-4799" })).toHaveFocus());
  const list = screen.getByRole("list");
  const offset = list.scrollTop;
  expect(offset).toBeGreaterThan(200_000);
  rendered.rerender(view(memory));
  expect(list.scrollTop).toBe(offset);
  fireEvent.keyDown(list, { key: "End" });
  await waitFor(() => expect(screen.getByRole("button", { name: "result-4999" })).toHaveFocus());
  expect(screen.getAllByRole("listitem").length).toBeLessThan(40);
  rendered.rerender(view(memory, 2, "filtered"));
  expect(list.scrollTop).toBe(0);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

it("virtualizes paired cards and restores an independent preset scroll offset", async () => {
  const memory: ResultScrollMemory = new Map();
  const rendered = render(view(memory, 5000, "first", 2));
  await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
  const list = screen.getByRole("list");
  act(() => { list.scrollTop = 6000; fireEvent.scroll(list); });
  expect(screen.getAllByRole("listitem").length).toBeLessThan(60);
  rendered.unmount();
  render(view(memory, 5000, "first", 2));
  await waitFor(() => expect(screen.getByRole("list").scrollTop).toBe(6000));
  expect(screen.getAllByRole("listitem").length).toBeLessThan(60);
});

it("keeps position when streaming crosses the virtualization threshold and resets a restored small list", async () => {
  const memory: ResultScrollMemory = new Map([["files", { signature: "first", offset: 900 }]]);
  const rendered = render(view(memory, 39));
  expect(screen.getByRole("list").scrollTop).toBe(900);
  rendered.rerender(view(memory, 50));
  await waitFor(() => expect(screen.getByRole("list").scrollTop).toBe(900));
  rendered.rerender(view(memory, 35, "filtered"));
  expect(screen.getByRole("list").scrollTop).toBe(0);
});
