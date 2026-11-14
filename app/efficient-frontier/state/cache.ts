// Tiny IndexedDB key–value store (no dependency). Used for price-history
// caching and CSV-imported series, which can exceed localStorage quotas.
// Falls back to an in-memory map when IndexedDB is unavailable (private
// browsing in some browsers, tests).

const DB_NAME = "efficient-frontier";
const DB_VERSION = 1;
export type StoreName = "prices" | "csv";

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ["prices", "csv"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(`${store}:${key}`) as T | undefined;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(`${store}:${key}`, value);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  const db = await openDb();
  if (!db) {
    return [...memory.keys()].filter((k) => k.startsWith(store + ":")).map((k) => k.slice(store.length + 1));
  }
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.delete(`${store}:${key}`);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  if (!db) {
    for (const k of [...memory.keys()]) if (k.startsWith(store + ":")) memory.delete(k);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
