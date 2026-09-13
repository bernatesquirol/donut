import { useMemo, useState } from "preact/hooks";
import {
  applyRows,
  looksLikeList,
  parseRows,
  summarise,
  type PasteMode,
  type PastedRow,
} from "../doc/paste";
import type { Board } from "../doc/types";

interface Props {
  /** The board being edited — used for the preview, never written to here. */
  board: Board;
  apply: (rows: PastedRow[], mode: PasteMode) => void;
}

const EXAMPLE = `A - terme que utilitzen els xavals per dir el cool que és algú (aura)
B - el millor i el pitjor servei de Barcelona alhora (bicing)`;

/**
 * Paste a whole board in.
 *
 * A rosco is 26 clues and 26 answers, twice. Typed into this form one field
 * at a time that is 104 tab stops, so in practice the round is written
 * somewhere else — a document, a spreadsheet, a chat message — and the honest
 * thing for the creator to do is read it in whatever shape it arrives.
 * `src/doc/paste.ts` has the rules; this is the part you can see.
 *
 * The preview is the point of the card. Guessing what "A - clue (answer)"
 * means is only acceptable if you can see the guess before it lands, so
 * nothing is written until a button is pressed and the button says exactly
 * how many rows it is about to write.
 */
export function PasteList({ board, apply }: Props) {
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);

  const rows = useMemo(() => parseRows(text), [text]);
  const unanswered = rows.filter((r) => !r.answer).length;
  const unknown = useMemo(() => {
    const present = new Set(board.entries.map((e) => e.letter));
    return rows.filter((r) => r.letter && !present.has(r.letter)).length;
  }, [board, rows]);

  function run(mode: PasteMode): void {
    apply(rows, mode);
    setText("");
    setConfirming(false);
  }

  return (
    <div class="card">
      <h2>Paste a list</h2>
      <p class="muted">
        One clue per line, for <b>{board.player || "this contestant"}</b>. A
        letter in front of it is used if there is one — <code>A - clue</code>,{" "}
        <code>A. clue</code>, a tab-separated column out of a spreadsheet — and
        otherwise the lines are read as A, B, C… in order. An answer goes in
        brackets at the end of the line, or in a column of its own.
      </p>

      <textarea
        class="paste-box"
        rows={6}
        spellcheck={false}
        value={text}
        placeholder={EXAMPLE}
        onInput={(e) => {
          setText((e.currentTarget as HTMLTextAreaElement).value);
          setConfirming(false);
        }}
      />

      {rows.length > 0 && (
        <>
          <div class="paste-preview">
            {rows.map((row, i) => (
              <div key={i} class={"paste-row" + (row.answer ? "" : " blank")}>
                <span class="paste-letter">{row.letter || "·"}</span>
                <span class="paste-clue">{row.clue}</span>
                <span class="muted">
                  {row.answer}
                  {row.contains && row.answer ? " · contains" : ""}
                </span>
              </div>
            ))}
          </div>

          <p class="muted">
            {summarise(board, rows, "merge")}
            {unanswered > 0 &&
              ` ${unanswered} with no answer — the host judges those from memory.`}
            {unknown > 0 &&
              ` ${unknown} name a letter this board does not have; they go on the end.`}
          </p>
        </>
      )}

      <div class="row" style="margin-top:12px">
        <button
          class="primary"
          disabled={rows.length === 0}
          onClick={() => run("merge")}
        >
          Fill in {rows.length || ""} {rows.length === 1 ? "letter" : "letters"}
        </button>

        {confirming ? (
          <button class="sm danger" onClick={() => run("replace")}>
            Yes, throw away the {board.entries.length} letters on this board
          </button>
        ) : (
          <button
            class="sm"
            disabled={rows.length === 0}
            onClick={() => setConfirming(true)}
            title="Discard this board and use the pasted list as it stands"
          >
            Replace the board
          </button>
        )}

        <span class="grow" />
        {text && (
          <button class="sm" onClick={() => setText("")}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The same import, run straight off a paste into the table.
 *
 * Returns false when the clipboard held ordinary text, in which case the
 * browser should be left to paste it into the field the way it always has:
 * hijacking someone typing one clue would be much worse than not helping.
 */
export function absorbPaste(
  event: ClipboardEvent,
  board: Board,
  at: number,
  apply: (board: Board, count: number) => void,
): boolean {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!looksLikeList(text)) return false;

  const rows = parseRows(text);
  if (rows.length === 0) return false;

  event.preventDefault();
  // Rows that name their own letter land on it; the rest fill downwards from
  // the row that was pasted into, which is what a spreadsheet would do.
  apply(applyRows(board, rows, "merge", at), rows.length);
  return true;
}
