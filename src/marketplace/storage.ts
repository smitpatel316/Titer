// Tiny storage seam for marketplace persistence (pins + installed records):
// localStorage in the app, an in-memory map in tests / when localStorage is
// absent. Values are JSON; keys are versioned so a future schema change can
// migrate instead of misreading.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** localStorage when it exists (the app), otherwise an in-memory map. Never throws. */
export function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // A denied localStorage falls through to memory.
  }
  return createMemoryStorage();
}
