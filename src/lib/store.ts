import { useSyncExternalStore } from "react";

/**
 * A tiny external store: enough for realtime state without pulling in a
 * global state library. Selectors keep re-renders scoped.
 */
export interface Store<T> {
  get: () => T;
  set: (updater: Partial<T> | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (updater) => {
      const next = typeof updater === "function" ? updater(state) : { ...state, ...updater };
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
