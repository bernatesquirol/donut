/**
 * The working copy: whatever this browser has open, in localStorage.
 *
 * Separate from `remote.ts` on purpose. This is the draft you are editing —
 * always available, never shared, no network. Publishing is what makes a
 * document visible anywhere else, and the two are allowed to disagree.
 */
import { parseDoc, type GameDoc } from "./types";

const KEY_PREFIX = "gamestarter.doc.";
const INDEX_KEY = "gamestarter.docs";

export interface DocEntry {
  id: string;
  title: string;
}

/** Ids of every locally saved document, most recently saved first. */
export function listDocs(): DocEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DocEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Save and stamp `updatedAt`. Returns the stamped document. */
export function save(doc: GameDoc): GameDoc {
  const stamped: GameDoc = { ...doc, updatedAt: new Date().toISOString() };
  localStorage.setItem(KEY_PREFIX + stamped.id, JSON.stringify(stamped));

  const index = listDocs().filter((e) => e.id !== stamped.id);
  index.unshift({ id: stamped.id, title: stamped.title || stamped.id });
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  return stamped;
}

export function load(id: string): GameDoc | null {
  const raw = localStorage.getItem(KEY_PREFIX + id);
  if (!raw) return null;
  try {
    return parseDoc(JSON.parse(raw));
  } catch (err) {
    console.warn(`[storage] "${id}" is not readable`, err);
    return null;
  }
}

export function remove(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id);
  const index = listDocs().filter((e) => e.id !== id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Most recently saved document — what the game boots into by default. */
export function loadLatest(): GameDoc | null {
  for (const entry of listDocs()) {
    const doc = load(entry.id);
    if (doc) return doc;
  }
  return null;
}

export function downloadJson(doc: GameDoc, filename: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<GameDoc> {
  return parseDoc(JSON.parse(await file.text()));
}
