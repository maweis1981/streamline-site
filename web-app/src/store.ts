import type { Playlist } from "./model";

// Playlists live in IndexedDB (they can be megabytes); small preferences in localStorage.
// Both can be unavailable (private windows, blocked storage), so every call degrades to memory.

const DB_NAME = "doubo-web";
const STORE = "playlists";
const memory = new Map<string, Playlist>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const dbPromise = openDb();

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return dbPromise.then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function loadPlaylists(): Promise<Playlist[]> {
  const stored = (await tx<Playlist[]>("readonly", (s) => s.getAll())) ?? [];
  for (const p of stored) memory.set(p.id, p);
  return [...memory.values()].sort((a, b) => a.importedAt - b.importedAt);
}

export async function savePlaylist(p: Playlist): Promise<void> {
  memory.set(p.id, p);
  await tx("readwrite", (s) => s.put(p));
}

export async function deletePlaylist(id: string): Promise<void> {
  memory.delete(id);
  await tx("readwrite", (s) => s.delete(id));
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`doubo.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`doubo.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference lasts for this visit only */
  }
}
