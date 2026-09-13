import { useEffect, useRef, useState } from "preact/hooks";
import type { AppConfig } from "../config";
import { applyRows, type PasteMode, type PastedRow } from "../doc/paste";
import {
  ALPHABET,
  boardAt,
  boardProgress,
  newBoard,
  newEntry,
  newLiveKey,
  type Board,
  type Entry,
  type GameDoc,
} from "../doc/types";
import { CopyLink } from "./CopyLink";
import { absorbPaste, PasteList } from "./PasteList";
import { Preview } from "./Preview";

interface Props {
  config: AppConfig;
  doc: GameDoc;
  /** Apply a change. Immutable in, immutable out — the preview diffs on it. */
  update: (fn: (doc: GameDoc) => GameDoc) => void;
}

/**
 * The authoring form: the real game on top, a clue per letter underneath.
 *
 * The preview is above rather than beside the form because the thing being
 * authored is two metre-wide donuts — squeezed into a side panel you cannot
 * read the letters, which is the only reason to have a preview at all.
 *
 * One board is edited at a time. They are separate on purpose: the contestants
 * take turns on the same clock, so sharing clues would mean the second one had
 * already heard the answers.
 */
export function Editor({ config, doc, update }: Props) {
  const [seat, setSeat] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  /** What the last paste did, so a table that changed under you says why. */
  const [pasted, setPasted] = useState("");

  const board = boardAt(doc, seat);
  const progress = boardProgress(board);
  const rows = useRef<(HTMLDivElement | null)[]>([]);

  // Clicking a letter on the donut should land you on its row, wherever the
  // list happens to be scrolled to.
  useEffect(() => {
    if (selected === null) return;
    rows.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [seat, selected]);

  function patchBoard(fn: (board: Board) => Board) {
    update((d) => ({
      ...d,
      boards: d.boards.map((b, i) => (i === seat ? fn(b) : b)),
    }));
  }

  function patchEntry(index: number, patch: Partial<Entry>) {
    patchBoard((b) => ({
      ...b,
      entries: b.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    }));
  }

  function removeEntry(index: number) {
    patchBoard((b) => ({
      ...b,
      entries: b.entries.filter((_, i) => i !== index),
    }));
    setSelected(null);
  }

  function addLetter() {
    patchBoard((b) => ({ ...b, entries: [...b.entries, newEntry("?")] }));
    setSelected(board.entries.length);
  }

  /** Top the board up to a full alphabet without touching what is written. */
  function addMissing() {
    const present = new Set(board.entries.map((e) => e.letter));
    const missing = [...ALPHABET].filter((l) => !present.has(l));
    if (missing.length === 0) return;
    patchBoard((b) => ({
      ...b,
      entries: [...b.entries, ...missing.map((l) => newEntry(l))],
    }));
  }

  /** A list pasted from the card below, or straight into the table. */
  function takeRows(rows: PastedRow[], mode: PasteMode, at = 0) {
    if (rows.length === 0) return;
    patchBoard((b) => applyRows(b, rows, mode, at));
    setSelected(null);
    setPasted(
      `Read ${rows.length} ${rows.length === 1 ? "clue" : "clues"} into ` +
        `${board.player || `player ${seat + 1}`}.`,
    );
  }

  function clearBoard() {
    patchBoard((b) => ({ ...newBoard(b.player), id: b.id }));
    setSelected(null);
    setPasted("");
  }

  return (
    <div class="editor">
      <div class="card">
        <Preview
          config={config}
          doc={doc}
          selection={selected === null ? null : { seat, index: selected }}
          onTap={(tap) => {
            if (!tap) {
              setSelected(null);
              return;
            }
            setSeat(tap.seat);
            setSelected(tap.index);
          }}
        />
        <p class="muted">
          The real game, rules and all — click a letter to edit it. Open{" "}
          <b>Play this document</b> above to run a round with the keyboard.
        </p>
      </div>

      <div class="card">
        <h2>Round</h2>
        <div class="row">
          <label class="field grow">
            <span>Title</span>
            <input
              type="text"
              value={doc.title}
              onInput={(e) =>
                update((d) => ({
                  ...d,
                  title: (e.currentTarget as HTMLInputElement).value,
                }))
              }
            />
          </label>
          <label class="field">
            <span>Seconds each</span>
            <input
              class="num"
              type="number"
              min="10"
              max="900"
              value={doc.timeLimit}
              onInput={(e) =>
                update((d) => ({
                  ...d,
                  timeLimit: Math.max(
                    0,
                    Math.round(
                      Number((e.currentTarget as HTMLInputElement).value) || 0,
                    ),
                  ),
                }))
              }
            />
          </label>
        </div>
        <p class="muted">
          id <code>{doc.id}</code>
        </p>
      </div>

      <div class="card">
        <h2>Boards</h2>
        <div class="row tabs">
          {doc.boards.map((b, i) => {
            const p = boardProgress(b);
            return (
              <button
                key={b.id}
                class={"tab" + (i === seat ? " selected" : "")}
                onClick={() => {
                  setSeat(i);
                  setSelected(null);
                  setPasted("");
                }}
              >
                {b.player || `Player ${i + 1}`}
                <span class="muted">
                  {" "}
                  {p.done}/{p.total}
                </span>
              </button>
            );
          })}
        </div>

        <div class="row" style="margin-top:12px">
          <label class="field grow">
            <span>Contestant</span>
            <input
              type="text"
              value={board.player}
              onInput={(e) =>
                patchBoard((b) => ({
                  ...b,
                  player: (e.currentTarget as HTMLInputElement).value,
                }))
              }
            />
          </label>
        </div>

        <div class="letter-list">
          <div class="letter-head">
            <span>Letter</span>
            <span>Clue the host reads</span>
            <span>Answer</span>
            <span title="The answer contains the letter instead of starting with it">
              Contains
            </span>
            <span />
          </div>

          {board.entries.length === 0 && (
            <p class="muted">
              This board has no letters. Add the alphabet to get started.
            </p>
          )}

          {board.entries.map((entry, index) => (
            <div
              key={entry.id}
              ref={(el) => {
                rows.current[index] = el;
              }}
              class={
                "letter-row" +
                (index === selected ? " selected" : "") +
                (entry.clue.trim() ? "" : " blank")
              }
              onFocusIn={() => setSelected(index)}
              onPaste={(e) =>
                absorbPaste(
                  e as ClipboardEvent,
                  board,
                  index,
                  (next, count) => {
                    patchBoard(() => next);
                    setSelected(null);
                    setPasted(
                      `Read ${count} ${count === 1 ? "clue" : "clues"} into ` +
                        `${board.player || `player ${seat + 1}`}, starting at ` +
                        `this row.`,
                    );
                  },
                )
              }
            >
              <input
                class="letter"
                type="text"
                value={entry.letter}
                maxLength={2}
                onInput={(e) =>
                  patchEntry(index, {
                    letter:
                      (
                        e.currentTarget as HTMLInputElement
                      ).value.toUpperCase() || "?",
                  })
                }
              />
              <input
                type="text"
                value={entry.clue}
                placeholder="Leave empty to keep this letter out of play"
                onInput={(e) =>
                  patchEntry(index, {
                    clue: (e.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <input
                type="text"
                value={entry.answer}
                placeholder="answer"
                onInput={(e) =>
                  patchEntry(index, {
                    answer: (e.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <input
                type="checkbox"
                checked={entry.contains}
                title="Contains the letter instead of starting with it"
                onChange={(e) =>
                  patchEntry(index, {
                    contains: (e.currentTarget as HTMLInputElement).checked,
                  })
                }
              />
              <button
                class="sm danger"
                title="Remove this letter"
                onClick={() => removeEntry(index)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {pasted && <p class="muted paste-said">{pasted}</p>}

        <div class="row" style="margin-top:12px">
          <button onClick={addMissing}>Add missing letters</button>
          <button onClick={addLetter}>Add one letter</button>
          <span class="grow" />
          <span class="muted">
            {progress.done} of {progress.total} letters are ready to play
          </span>
          <button class="sm danger" onClick={clearBoard}>
            Clear board
          </button>
        </div>
      </div>

      <PasteList board={board} apply={(rows, mode) => takeRows(rows, mode)} />

      <LiveScreens doc={doc} update={update} />
    </div>
  );
}

/**
 * A screen for each contestant, and the links that open them.
 *
 * The contestant name in the URL is why these are worth printing rather than
 * describing: `?seat=Ana` is a link you can read out, but it also means
 * renaming a contestant breaks the link you already sent.
 */
function LiveScreens({
  doc,
  update,
}: {
  doc: GameDoc;
  update: Props["update"];
}) {
  const [confirming, setConfirming] = useState(false);

  function playPath(player: string): string {
    const q = new URLSearchParams({
      id: doc.id,
      k: doc.liveKey,
      seat: player,
    });
    return `/play?${q.toString()}`;
  }

  function regenerate() {
    update((d) => ({ ...d, liveKey: newLiveKey() }));
    setConfirming(false);
  }

  const unnamed = doc.boards.some((b) => !b.player.trim());

  return (
    <div class="card">
      <h2>Live screens</h2>
      <p class="muted">
        One screen per contestant, following the host console as it happens:
        their own donut large, the opponent&rsquo;s beside it, and the clue
        while the clock runs. Never an answer &mdash; the host&rsquo;s screen is
        the only one that has them.
      </p>

      {unnamed ? (
        <p class="error">
          Give every contestant a name above first: the name is what their link
          points at.
        </p>
      ) : (
        <ul class="doc-list">
          {doc.boards.map((b) => (
            <li key={b.id} class="bare">
              <ul class="doc-list">
                <CopyLink path={playPath(b.player)} label={b.player} />
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div class="row" style="margin-top:12px">
        {confirming ? (
          <>
            <button class="sm danger" onClick={regenerate}>
              Yes, break the old links
            </button>
            <button class="sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            class="sm"
            onClick={() => setConfirming(true)}
            title="Mint a new room key"
          >
            New room key
          </button>
        )}
        <span class="grow" />
        <span class="muted">
          The key is the unguessable half of the room name. Renew it to shut out
          links you have already handed out.
        </span>
      </div>
    </div>
  );
}
