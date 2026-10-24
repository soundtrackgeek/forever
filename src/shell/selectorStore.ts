// The provider publishes committed snapshots. Stable action facades call the
// latest controller closure, so telemetry never invalidates navigation actions.
export function createSelectorStore<T extends object>(initial: T) {
  let current = initial;
  const actions = new Map<keyof T, unknown>();
  const listeners = new Set<() => void>();
  function snapshot(value: T): T {
    const next = { ...value };
    for (const key of Object.keys(value) as (keyof T)[]) {
      if (typeof value[key] !== "function") continue;
      if (!actions.has(key)) {
        actions.set(key, (...args: unknown[]) =>
          Reflect.apply(
            current[key] as (...args: unknown[]) => unknown,
            undefined,
            args,
          ),
        );
      }
      next[key] = actions.get(key) as T[keyof T];
    }
    return next;
  }
  let published = snapshot(initial);
  return {
    getSnapshot: () => published,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: T) {
      current = next;
      published = snapshot(next);
      listeners.forEach((listener) => listener());
    },
  };
}

export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const prototype = Object.getPrototypeOf(left);
  if (prototype !== Object.getPrototypeOf(right)) return false;
  // Maps, Sets, Dates and other non-record values must retain identity semantics.
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(left)) return false;
  const keys = Object.keys(left) as (keyof T)[];
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        Object.is(left[key], right[key]),
    )
  );
}

export function selectSnapshot<T, S>(
  getSnapshot: () => T,
  select: (state: T) => S,
) {
  let cached: { source: T; value: S } | undefined;
  return () => {
    const source = getSnapshot();
    if (cached && Object.is(source, cached.source)) return cached.value;
    const selected = select(source);
    const value =
      cached && shallowEqual(cached.value, selected) ? cached.value : selected;
    cached = { source, value };
    return value;
  };
}
