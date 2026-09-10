/**
 * The authored document a game is built from.
 *
 * This is the one type to replace when you start a real game: the creator
 * edits it, persistence versions it, and the scene renders it. Everything
 * else in the starter is written against these three names — `GameDoc`,
 * `parseDoc`, `newDoc` — so a rewrite here is a compile error everywhere it
 * matters rather than a silent mismatch.
 *
 * The placeholder content is a bag of labelled items at normalised positions,
 * which is the least a document can be while still exercising every seam:
 * authoring, saving, publishing, loading and hit-testing.
 */
export interface GameDoc {
  /** Storage identity. Stable for the life of the document. */
  id: string;
  title: string;
  /** ISO timestamp, rewritten on every save. */
  updatedAt: string;
  items: DocItem[];
}

export interface DocItem {
  id: string;
  label: string;
  /**
   * Position as a 0..1 fraction of the stage, so a document authored on a
   * laptop lays out the same on a phone. The scene multiplies by its own
   * size; nothing in the document knows about pixels.
   */
  x: number;
  y: number;
  /** 0..360. Colour without an asset pipeline to set up first. */
  hue: number;
}

/** Short, URL-safe, collision-resistant enough for hand-authored documents. */
function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function newDoc(title = "Untitled"): GameDoc {
  return {
    id: shortId("doc"),
    title,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

export function newItem(label: string, x = 0.5, y = 0.5): DocItem {
  return {
    id: shortId("it"),
    label,
    x: clamp01(x),
    y: clamp01(y),
    hue: Math.floor(Math.random() * 360),
  };
}

/**
 * A document to show on a fresh clone, so `npm run dev` renders something
 * before anything has been authored. Not persisted: saving it in the creator
 * is what gives it an identity of its own.
 */
export function starterDoc(): GameDoc {
  return {
    ...newDoc("Blank game"),
    items: [
      { ...newItem("one", 0.3, 0.38), hue: 168 },
      { ...newItem("two", 0.5, 0.6), hue: 42 },
      { ...newItem("three", 0.7, 0.38), hue: 320 },
    ],
  };
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

/**
 * Coerce anything that arrived from storage, a URL or an imported file into a
 * usable document.
 *
 * Deliberately forgiving rather than validating: a published document may have
 * been written by an older build of the creator, and dropping a field it has
 * never heard of is better than refusing to open the file. Only a
 * non-object throws.
 */
export function parseDoc(raw: unknown): GameDoc {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a game document");
  }
  const src = raw as Partial<GameDoc>;
  const items = Array.isArray(src.items) ? src.items : [];

  return {
    id: typeof src.id === "string" && src.id ? src.id : shortId("doc"),
    title: typeof src.title === "string" ? src.title : "",
    updatedAt:
      typeof src.updatedAt === "string"
        ? src.updatedAt
        : new Date().toISOString(),
    items: items.map(parseItem),
  };
}

function parseItem(raw: unknown): DocItem {
  const src = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as Partial<DocItem>;
  return {
    id: typeof src.id === "string" && src.id ? src.id : shortId("it"),
    label: typeof src.label === "string" ? src.label : "",
    x: clamp01(Number(src.x)),
    y: clamp01(Number(src.y)),
    hue: Number.isFinite(Number(src.hue)) ? Number(src.hue) % 360 : 200,
  };
}

/** Filename-safe slug of a document's title, for exports. */
export function slugify(doc: GameDoc): string {
  return (
    doc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "game-doc"
  );
}
