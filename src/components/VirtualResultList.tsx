import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type ResultScrollMemory = Map<string, { signature: string; offset: number }>;
type Props<T> = {
  items: T[]; itemKey: (item: T) => string; children: (item: T) => ReactNode;
  className: string; label: string; empty: ReactNode; columns?: number; estimate?: number;
  memory: ResultScrollMemory; memoryKey: string; signature: string;
};

// Virtualize rows, including pairs of cards in grid mode. Small lists avoid the
// observer overhead. Stable keys and measurement support expanded confidence rows.
export function VirtualResultList<T>({ items, itemKey, children, className, label, empty,
  columns = 1, estimate = 66, memory, memoryKey, signature }: Props<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [initialOffset] = useState(() => memory.get(memoryKey)?.signature === signature ? memory.get(memoryKey)!.offset : 0);
  const previousSignature = useRef(signature);
  const restored = useRef(false);
  const pendingFocus = useRef<number | null>(null);
  const virtualized = items.length > 40;
  const count = Math.ceil(items.length / columns);
  const getItemKey = useCallback((index: number) => itemKey(items[index * columns]), [itemKey, items, columns]);
  const focusedIndex = focusedKey === null ? -1 : items.findIndex((item) => itemKey(item) === focusedKey);
  // This mutable virtualizer stays local; its methods must not be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count, getScrollElement: () => scrollRef.current, estimateSize: () => estimate,
    getItemKey, overscan: 5, enabled: virtualized,
    initialOffset: () => scrollRef.current?.scrollTop ?? initialOffset, useFlushSync: false,
    rangeExtractor: useCallback((range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const row = Math.floor(focusedIndex / columns);
      return row >= 0 ? [...new Set([...indexes, row])].sort((a, b) => a - b) : indexes;
    }, [focusedIndex, columns]),
  });

  useLayoutEffect(() => {
    if (previousSignature.current !== signature) {
      previousSignature.current = signature;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      virtualizer.scrollToOffset(0);
    }
  }, [signature, virtualizer]);
  useLayoutEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!virtualized && scrollRef.current) scrollRef.current.scrollTop = initialOffset;
  }, [initialOffset, virtualized]);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    scrollRef.current?.querySelector<HTMLElement>(`[data-result-index="${pendingFocus.current}"] button`)?.focus({ preventScroll: true });
    pendingFocus.current = null;
  });

  const row = (index: number) => <div className={columns > 1 ? "virtual-result-grid-row" : undefined}>
    {items.slice(index * columns, (index + 1) * columns).map((item, offset) =>
      <div key={itemKey(item)} data-result-index={index * columns + offset} role="listitem"
        aria-posinset={index * columns + offset + 1} aria-setsize={items.length}
        onFocus={() => setFocusedKey(itemKey(item))}>{children(item)}</div>)}
  </div>;

  return <div ref={scrollRef} className={`${className} virtual-result-list`} role="list" aria-label={label}
    tabIndex={0} aria-description="Use arrow keys, Home and End to move through results."
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null); }}
    onScroll={(event) => memory.set(memoryKey, { signature, offset: event.currentTarget.scrollTop })}
    onKeyDown={(event) => {
      if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
        Math.max(0, Math.min(items.length - 1, focusedIndex + (event.key === "ArrowDown" ? 1 : -1)));
      pendingFocus.current = next;
      setFocusedKey(itemKey(items[next]));
      if (virtualized) virtualizer.scrollToIndex(Math.floor(next / columns), { align: "auto" });
      else scrollRef.current?.querySelector<HTMLElement>(`[data-result-index="${next}"]`)?.scrollIntoView?.({ block: "nearest" });
    }}>
    {!items.length ? empty : virtualized ?
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((item) => <div key={item.key} data-index={item.index}
          ref={virtualizer.measureElement} className="virtual-result-row"
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}>
          {row(item.index)}
        </div>)}
      </div> : Array.from({ length: count }, (_, index) => <div key={getItemKey(index)}>{row(index)}</div>)}
  </div>;
}
