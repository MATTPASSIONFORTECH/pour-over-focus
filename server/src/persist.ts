/* Optional JSON-file durability. Writes are debounced and atomic
   (temp file + rename) so a crash mid-write never leaves a torn file. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { LeaderboardStore, type StoreOptions } from "./leaderboard.ts";

export async function loadStore(file: string, options: StoreOptions = {}): Promise<LeaderboardStore> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new LeaderboardStore(options);
    throw err;
  }
  // A corrupt file should fail loudly rather than silently start an empty board and overwrite it.
  return LeaderboardStore.fromJSON(JSON.parse(text), options);
}

export async function saveStore(file: string, store: LeaderboardStore): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store.toJSON()));
  await rename(tmp, file);
}

export interface Saver {
  flush: () => Promise<void>;
  stop: () => void;
}

export function autoSave(file: string, store: LeaderboardStore, delayMs = 1000, onError: (err: unknown) => void = () => {}): Saver {
  let timer: NodeJS.Timeout | null = null;
  let writing: Promise<void> = Promise.resolve();

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    // Chain writes so two renames never race each other.
    writing = writing.then(() => saveStore(file, store)).catch(onError);
    return writing;
  };
  const unsubscribe = store.onChange(() => {
    timer ??= setTimeout(flush, delayMs);
  });

  return {
    flush,
    stop: () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
