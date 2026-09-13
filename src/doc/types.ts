/**
 * The authored document a match is built from.
 *
 * A donut document is a pair of *boards*, one per contestant: a clue and an
 * answer for every letter of the alphabet. The scene draws each board as a
 * ring — the "donut" — and `src/game/match.ts` walks it.
 *
 * Two boards rather than one shared board because the contestants take turns
 * on the same clock: if they answered the same clues, the second one would
 * simply have heard the first one's answers.
 *
 * `parseDoc` is deliberately forgiving. A published document may have been
 * written by an older build, and a board that is missing half its letters is
 * still a board worth opening — the game skips letters with no clue rather
 * than refusing to start.
 */
export interface GameDoc {
  /** Storage identity. Stable for the life of the document. */
  id: string;
  title: string;
  /** ISO timestamp, rewritten on every save. */
  updatedAt: string;
  /**
   * Seconds on each contestant's clock. 0 means "unset" and falls back to
   * `DEFAULT_TIME_LIMIT`, which is what a document authored before this field
   * existed reads as. `config.game.timeLimit` overrides it either way.
   */
  timeLimit: number;
  /** One per contestant. The game plays the first two. */
  boards: Board[];
  /**
   * Secret half of the live room name, so a round in progress is not readable
   * — or writable — by anyone who merely knows the document id.
   *
   * The id is not a secret: it is in every published share link and in the
   * catalogue. This is, which is what makes the room path unguessable without
   * database rules to enforce it. Regenerate it in the creator to lock out
   * links you have already handed out.
   */
  liveKey: string;
}

export interface Board {
  id: string;
  /** Contestant name, shown in the middle of their donut. */
  player: string;
  entries: Entry[];
}

export interface Entry {
  id: string;
  /** A single upper-case character. Duplicates are allowed but pointless. */
  letter: string;
  /**
   * The answer *contains* the letter instead of starting with it — the
   * standard escape hatch for letters no useful word begins with. Shown to
   * the host so they read out the right form of the question.
   */
  contains: boolean;
  /** What the host reads aloud. */
  clue: string;
  /** What counts as right. The host judges; this is their crib. */
  answer: string;
}

/** The letters a new board is built from. */
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** How many contestants a match seats. Two donuts, two clocks. */
export const SEATS = 2;

/** Seconds per contestant for a document that does not say. */
export const DEFAULT_TIME_LIMIT = 150;

/** Short, URL-safe, collision-resistant enough for hand-authored documents. */
function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/**
 * A fresh live-room secret. 10 base-36 characters from `crypto`, which is
 * roughly 51 bits — enough that guessing one is not a strategy.
 */
export function newLiveKey(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

export function newEntry(letter: string, clue = "", answer = ""): Entry {
  return {
    id: shortId("e"),
    letter: normaliseLetter(letter),
    contains: false,
    clue,
    answer,
  };
}

/** A board with every letter present and no clues written yet. */
export function newBoard(player: string, alphabet = ALPHABET): Board {
  return {
    id: shortId("b"),
    player,
    entries: [...alphabet].map((letter) => newEntry(letter)),
  };
}

export function newDoc(title = "Untitled"): GameDoc {
  return {
    id: shortId("doc"),
    title,
    updatedAt: new Date().toISOString(),
    timeLimit: DEFAULT_TIME_LIMIT,
    boards: [newBoard("Player 1"), newBoard("Player 2")],
    liveKey: newLiveKey(),
  };
}

/**
 * The board a seat plays. Always returns something: a document with one board
 * — or none — still opens, it just has an empty donut opposite.
 */
export function boardAt(doc: GameDoc, seat: number): Board {
  return doc.boards[seat] ?? newBoard(`Player ${seat + 1}`);
}

/** An entry with no clue cannot be asked, so the game steps over it. */
export function isPlayable(entry: Entry): boolean {
  return entry.clue.trim().length > 0;
}

/** How much of a board is actually ready to play. */
export function boardProgress(board: Board): { done: number; total: number } {
  return {
    done: board.entries.filter(isPlayable).length,
    total: board.entries.length,
  };
}

/**
 * Seconds each contestant gets. The config override wins when it is set,
 * because its whole purpose is to shorten an already-published round from the
 * URL; otherwise the document decides, and `DEFAULT_TIME_LIMIT` catches a
 * document written before the field existed.
 */
export function timeLimitOf(doc: GameDoc, override = 0): number {
  if (override > 0) return override;
  return doc.timeLimit > 0 ? doc.timeLimit : DEFAULT_TIME_LIMIT;
}

/** How the host should phrase the question for an entry. */
export function prompt(entry: Entry): string {
  return entry.contains
    ? `Contains ${entry.letter}`
    : `Starts with ${entry.letter}`;
}

function normaliseLetter(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  // One glyph, not one UTF-16 unit, so a letter outside the BMP survives.
  return [...text][0] ?? "?";
}

/**
 * Coerce anything that arrived from storage, a URL or an imported file into a
 * usable document. Only a non-object throws.
 */
export function parseDoc(raw: unknown): GameDoc {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a game document");
  }
  const src = raw as Partial<GameDoc>;
  const boards = Array.isArray(src.boards) ? src.boards : [];
  const limit = Number(src.timeLimit);

  return {
    id: typeof src.id === "string" && src.id ? src.id : shortId("doc"),
    title: typeof src.title === "string" ? src.title : "",
    updatedAt:
      typeof src.updatedAt === "string"
        ? src.updatedAt
        : new Date().toISOString(),
    timeLimit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 0,
    // Seats are positional, so both are materialised even if the file has
    // fewer: the game and the editor can then index them without guarding.
    boards: Array.from({ length: Math.max(SEATS, boards.length) }, (_, i) =>
      i < boards.length
        ? parseBoard(boards[i], i)
        : newBoard(`Player ${i + 1}`),
    ),
    // Minted on read for a document written before live screens existed,
    // which is the same as never having shared a room.
    liveKey:
      typeof src.liveKey === "string" && src.liveKey
        ? src.liveKey
        : newLiveKey(),
  };
}

function parseBoard(raw: unknown, seat: number): Board {
  const src = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as Partial<Board>;
  const entries = Array.isArray(src.entries) ? src.entries : [];
  return {
    id: typeof src.id === "string" && src.id ? src.id : shortId("b"),
    player:
      typeof src.player === "string" && src.player.trim()
        ? src.player
        : `Player ${seat + 1}`,
    entries: entries.length ? entries.map(parseEntry) : newBoard("").entries,
  };
}

function parseEntry(raw: unknown): Entry {
  const src = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as Partial<Entry>;
  return {
    id: typeof src.id === "string" && src.id ? src.id : shortId("e"),
    letter: normaliseLetter(src.letter),
    contains: src.contains === true,
    clue: typeof src.clue === "string" ? src.clue : "",
    answer: typeof src.answer === "string" ? src.answer : "",
  };
}

/** Filename-safe slug of a document's title, for exports. */
export function slugify(doc: GameDoc): string {
  return (
    doc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "donut-doc"
  );
}

/**
 * A playable document to show on a fresh clone, so `npm run dev` is a game
 * and not an empty form. Not persisted: saving it in the creator is what
 * gives it an identity of its own.
 */
export function starterDoc(): GameDoc {
  return {
    ...newDoc("Donut — demo round"),
    timeLimit: DEFAULT_TIME_LIMIT,
    liveKey: newLiveKey(),
    boards: [board("Player 1", STARTER_A), board("Player 2", STARTER_B)],
  };
}

/** `[letter, clue, answer]`, or a 4th `true` for a contains-the-letter clue. */
type Row = [string, string, string, boolean?];

function board(player: string, rows: Row[]): Board {
  return {
    id: shortId("b"),
    player,
    entries: rows.map(([letter, clue, answer, contains]) => ({
      ...newEntry(letter, clue, answer),
      contains: contains === true,
    })),
  };
}

const STARTER_A: Row[] = [
  ["A", "Sour-tasting substance that turns litmus red.", "Acid"],
  ["B", "The lowest of the adult male singing voices.", "Bass"],
  ["C", "A young cow.", "Calf"],
  ["D", "A flat figure with ten sides.", "Decagon"],
  ["E", "The largest land animal, and it has a trunk.", "Elephant"],
  ["F", "Device that strains the impurities out of a liquid.", "Filter"],
  ["G", "The largest of the great apes.", "Gorilla"],
  ["H", "Frozen rain that falls as hard pellets.", "Hail"],
  ["I", "Land entirely surrounded by water.", "Island"],
  ["J", "A written record kept day by day.", "Journal"],
  ["K", "The set of keys you type on.", "Keyboard"],
  ["L", "Big cat with a mane, called the king of beasts.", "Lion"],
  ["M", "Stone the sculptors of Carrara work in.", "Marble"],
  ["N", "A book-length work of prose fiction.", "Novel"],
  ["O", "The curved path one body takes around another.", "Orbit"],
  ["P", "Flightless Antarctic seabird that swims to hunt.", "Penguin"],
  ["Q", "A group of four musicians playing together.", "Quartet"],
  ["R", "Arc of colour across the sky after rain.", "Rainbow"],
  ["S", "The star our planet goes round.", "Sun"],
  ["T", "The simplest figure you can draw with straight lines.", "Triangle"],
  ["U", "Mythical horse with a single horn.", "Unicorn"],
  ["V", "A mountain that erupts.", "Volcano"],
  ["W", "The largest animal alive, and it lives in the sea.", "Whale"],
  ["X", "The gas that is one fifth of the air we breathe.", "Oxygen", true],
  ["Y", "The colour of a lemon.", "Yellow"],
  ["Z", "African horse in black and white stripes.", "Zebra"],
];

const STARTER_B: Row[] = [
  ["A", "The continent the Sahara lies in.", "Africa"],
  ["B", "Instrument that measures atmospheric pressure.", "Barometer"],
  ["C", "A sailor's map of the coast and the depths.", "Chart"],
  ["D", "A long spell without rain, damaging to crops.", "Drought"],
  ["E", "The circle around the middle of the globe.", "Equator"],
  ["F", "The thigh bone, longest in the human body.", "Femur"],
  ["G", "A river of ice moving slowly downhill.", "Glacier"],
  ["H", "Half a sphere — the north or the south of the globe.", "Hemisphere"],
  ["I", "Water gone solid.", "Ice"],
  ["J", "The largest planet in the solar system.", "Jupiter"],
  ["K", "A thousand metres.", "Kilometre"],
  ["L", "A tower whose lamp warns ships off the rocks.", "Lighthouse"],
  ["M", "A picture assembled out of small coloured tiles.", "Mosaic"],
  ["N", "The direction opposite south.", "North"],
  ["O", "Sea creature with eight arms.", "Octopus"],
  ["P", "A closed flat figure made of straight sides.", "Polygon"],
  ["Q", "A pit where stone is cut out of the ground.", "Quarry"],
  ["R", "Ridge of coral just under the surface of the sea.", "Reef"],
  ["S", "Frozen rain that falls soft and settles white.", "Snow"],
  ["T", "Giant sea wave set off by an earthquake.", "Tsunami"],
  ["U", "Everything there is, taken together.", "Universe"],
  ["V", "The second planet out from the sun.", "Venus"],
  ["W", "The direction the sun sets in.", "West"],
  ["X", "A poison made by a living organism.", "Toxin", true],
  ["Y", "Twelve months.", "Year"],
  ["Z", "The point of the sky directly overhead.", "Zenith"],
];
