import { ALPHABET, newEntry, type Board, type Entry } from "./types";

/**
 * Turning a pasted list into a board.
 *
 * Nobody authors a rosco by typing into 26 boxes twice. They write it in a
 * document or a spreadsheet, in whatever shape came naturally, and the job of
 * this file is to accept that shape rather than ask for another one. All of
 * these are the same board:
 *
 *   A - a word for how cool someone is (aura)
 *   B. the bike hire nobody can ever find (bicing)
 *
 *   A<TAB>a word for how cool someone is<TAB>aura
 *   a word for how cool someone is<TAB>aura          (letters by position)
 *
 * The two things worth knowing about the rules below: a line that does not
 * announce a letter and does not carry an answer is treated as the previous
 * clue wrapping, because that is what a copied paragraph does; and a line
 * with no letter at all takes one from its position, because a spreadsheet
 * column of 26 clues is already in alphabetical order.
 *
 * Nothing here writes to a document. `parseRows` reads text, `applyRows`
 * folds rows into a board, and the creator decides which of the two ways to
 * do it the user asked for.
 */

export interface PastedRow {
  /** Upper-case, or "" when the text did not say and position must decide. */
  letter: string;
  clue: string;
  answer: string;
  contains: boolean;
}

/** How a pasted list meets the letters already on the board. */
export type PasteMode = "merge" | "replace";

/** Columns, in order of how sure we can be that they are columns. */
const COLUMN = /\t| \| /;

/**
 * "A - clue", "A. clue", "A) clue", "A: clue". One or two glyphs, because a
 * Spanish rosco has CH, LL and RR in it.
 */
const LETTER_LINE = /^(\p{L}{1,2})\s*[-–—.:)\]]\s*(\S.*)$/u;

/** A trailing "(answer)" or "[answer]", which is how most lists mark one. */
const TRAILING_ANSWER = /^(.*?)\s*[([]([^()[\]]{1,80})[)\]][.\s]*$/;

/** A "contains the letter" column, in the words people actually write. */
const CONTAINS =
  /^(x|y|yes|s|si|sí|true|t|1|conté|conte|contiene|contains|contains?\s+the\s+letter)$/i;

/**
 * Read a pasted list. Returns one row per clue found, in the order they were
 * written; rows with neither a clue nor an answer are dropped rather than
 * turning blank lines into blank letters.
 */
export function parseRows(text: string): PastedRow[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Whether a bare line is a clue of its own or the line above wrapping
  // depends on the company it keeps. In a list that announces its letters, a
  // line that does not is a paragraph continuing; in a plain column of clues,
  // every line is a clue and joining them would destroy the list.
  const announced = lines.some(
    (line) => !COLUMN.test(line) && LETTER_LINE.test(unquote(line)),
  );

  const rows: PastedRow[] = [];

  for (const line of lines) {
    const cells = line.split(COLUMN);
    if (cells.length > 1) {
      rows.push(fromCells(cells.map(unquote)));
      continue;
    }

    const plain = unquote(line);
    const marked = LETTER_LINE.exec(plain);
    if (marked) {
      rows.push(fromText(marked[1], marked[2]));
      continue;
    }

    const previous = rows[rows.length - 1];
    if (announced && previous) {
      rows[rows.length - 1] = continued(previous, plain);
      continue;
    }

    rows.push(fromText("", plain));
  }

  return rows.filter((row) => row.clue || row.answer);
}

/** A wrapped line: more clue, and possibly the answer it was running on to. */
function continued(row: PastedRow, line: string): PastedRow {
  const split = !row.answer ? TRAILING_ANSWER.exec(line) : null;
  return finish({
    ...row,
    clue: `${row.clue} ${(split?.[1] ?? line).trim()}`.trim(),
    answer: split?.[2].trim() ?? row.answer,
  });
}

/**
 * Is this paste a list at all?
 *
 * Used to decide whether to hijack a paste into a single field: one line of
 * prose with no structure is somebody filling in one clue, and swallowing it
 * would be infuriating.
 */
export function looksLikeList(text: string): boolean {
  if (COLUMN.test(text)) return true;
  return parseRows(text).length > 1;
}

/**
 * Fold rows into a board.
 *
 *   replace  the pasted list *is* the board, letters and all
 *   merge    each row lands on the letter it names, leaving the rest alone
 *
 * `from` is where positional rows — the ones that never named a letter —
 * start landing, so pasting a spreadsheet column into the middle of the table
 * fills downwards from there instead of from A.
 */
export function applyRows(
  board: Board,
  rows: PastedRow[],
  mode: PasteMode,
  from = 0,
): Board {
  if (rows.length === 0) return board;

  if (mode === "replace") {
    return {
      ...board,
      entries: rows.map((row, i) => write(newEntry(letterFor(row, i)), row)),
    };
  }

  const entries = [...board.entries];
  /** Rows already landed, so two clues for "A" do not fight over one row. */
  const taken = new Set<number>();
  let cursor = Math.max(0, from);

  for (const row of rows) {
    let index: number;
    if (row.letter) {
      index = entries.findIndex(
        (entry, i) => !taken.has(i) && entry.letter === row.letter,
      );
    } else {
      while (cursor < entries.length && taken.has(cursor)) cursor++;
      index = cursor < entries.length ? cursor : -1;
      cursor++;
    }

    if (index < 0) {
      // A letter the board does not have — an X in a Catalan rosco, say. It
      // goes on the end rather than being dropped on the floor.
      entries.push(write(newEntry(row.letter || "?"), row));
      taken.add(entries.length - 1);
    } else {
      entries[index] = write(entries[index], row);
      taken.add(index);
    }
  }

  return { ...board, entries };
}

/** What `applyRows` would change, for a preview that has to be trusted. */
export function summarise(
  board: Board,
  rows: PastedRow[],
  mode: PasteMode,
): string {
  if (rows.length === 0) return "";
  const before = board.entries.length;
  const after = applyRows(board, rows, mode).entries.length;

  const noun = rows.length === 1 ? "clue" : "clues";
  if (mode === "replace") {
    return `${rows.length} ${noun}, replacing all ${before} letters on this board.`;
  }
  const added = after - before;
  return added > 0
    ? `${rows.length} ${noun}, ${added} of them on letters this board does not have yet.`
    : `${rows.length} ${noun}, all landing on letters already on this board.`;
}

// --- internals ------------------------------------------------------------

function fromCells(cells: string[]): PastedRow {
  const first = cells[0].replace(/[-–—.:)\]]+$/, "").trim();
  const led = cells.length > 1 && /^\p{L}{1,2}$/u.test(first);

  const letter = led ? first.toUpperCase() : "";
  const rest = led ? cells.slice(1) : cells;

  // An answer of its own beats one dug out of the clue's brackets — someone
  // who made a column for it meant it.
  const split = TRAILING_ANSWER.exec(rest[0] ?? "");
  const clue = (rest[1] ? rest[0] : (split?.[1] ?? rest[0])) ?? "";
  const answer = rest[1] ?? split?.[2] ?? "";
  const flag = rest[2] ?? "";

  return finish({
    letter,
    clue: clue.trim(),
    answer: answer.trim(),
    contains: flag ? CONTAINS.test(flag.trim()) : false,
  });
}

function fromText(letter: string, rest: string): PastedRow {
  const split = TRAILING_ANSWER.exec(rest);
  return finish({
    letter: letter.toUpperCase(),
    clue: (split?.[1] ?? rest).trim(),
    answer: (split?.[2] ?? "").trim(),
    contains: false,
  });
}

/** Work out "contains" from the answer when the list did not say. */
function finish(row: PastedRow): PastedRow {
  if (row.contains || !row.letter || !row.answer) return row;
  const answer = fold(row.answer);
  const letter = fold(row.letter);
  return {
    ...row,
    contains:
      letter.length > 0 &&
      !answer.startsWith(letter) &&
      answer.includes(letter),
  };
}

/** Accent-blind upper case, so "Àfrica" still starts with A. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

function write(entry: Entry, row: PastedRow): Entry {
  return {
    ...entry,
    letter: row.letter || entry.letter,
    clue: row.clue,
    answer: row.answer,
    // A row with no answer has nothing to infer from, so a flag the author
    // ticked by hand survives re-pasting a list of bare clues.
    contains: row.answer ? row.contains : entry.contains,
  };
}

/** The letter a positional row lands on: A, B, C… then "?" past the end. */
function letterFor(row: PastedRow, index: number): string {
  return row.letter || ALPHABET[index] || "?";
}

/** Excel wraps a cell holding a quote or a comma, and doubles the quotes. */
function unquote(cell: string): string {
  const text = cell.trim();
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) {
    return text;
  }
  return text.slice(1, -1).replace(/""/g, '"').trim();
}
