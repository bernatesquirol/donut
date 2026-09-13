import { loadConfig } from "../config";
import { createBoard } from "../game/board";
import { ClientSession } from "../live/session";
import { createTransport } from "../live/transport";
import { roomPath } from "../live/types";
import { addNotice, failNotice } from "../ui/notice";

/**
 * Route `/play`: one contestant's screen.
 *
 *   /play?id=<docId>&k=<liveKey>&seat=<name>
 *
 * Their donut big, the opponent's small beside it, and the clue on the table
 * while the clock runs. Read-only by construction: there is no keyboard bound
 * here and no `Match` behind it, so the only thing this screen can do is show
 * what the host published.
 *
 * Note what it does *not* load: the document. It has no need of one — the
 * live room carries the letters, the rulings and the current clue — and that
 * is deliberate, because the document is where the answers are. A contestant
 * with devtools open can find nothing here that they could not hear.
 *
 * `k` is the document's `liveKey`. Both halves of the room name are needed,
 * and this is the unguessable half: the document id is in every published
 * share link, so on its own it would let anyone who has seen one watch — or
 * with open database rules, interfere with — a round in progress.
 */
export async function mount(root: HTMLElement): Promise<void> {
  root.classList.add("fullscreen");

  const config = loadConfig();
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") ?? "";
  const key = params.get("k") ?? "";
  const wanted = params.get("seat") ?? "";

  const notice = addNotice(root, "Waiting for the host…");

  if (!id || !key) {
    failNotice(
      notice,
      "This link is incomplete",
      "A player screen needs ?id=, ?k= and ?seat=. The creator prints the " +
        "whole link for each contestant once a round is published.",
    );
    return;
  }

  const stage = document.createElement("div");
  stage.className = "stage-host";
  root.appendChild(stage);

  const board = await createBoard(stage, config);
  const transport = createTransport(config);
  const session = new ClientSession(transport, roomPath(id, key));

  /** Which seat this screen belongs to, once a payload says. */
  let seat = -1;

  function onChange(): void {
    if (session.error) {
      failNotice(notice, "Lost the live round", session.error);
      notice.hidden = false;
      return;
    }

    const view = session.view();
    if (!view) {
      // The room is empty: the host has not opened the console yet, or has
      // finished with this round and taken it down.
      notice.textContent = "Waiting for the host…";
      notice.hidden = false;
      return;
    }

    seat = resolveSeat(
      view.seats.map((s) => s.player),
      wanted,
    );
    if (seat < 0) {
      failNotice(
        notice,
        "No such contestant in this round",
        `This link is for "${wanted}", but the round is being played by ` +
          `${view.seats.map((s) => `"${s.player}"`).join(" and ")}. ` +
          `Renaming a contestant in the creator invalidates their old link.`,
      );
      notice.hidden = false;
      return;
    }

    notice.hidden = true;
    board.scene.setFocus(seat);
    board.scene.setTitle(session.payload?.title || view.seats[seat].player);
    board.scene.setHint(transport.kind === "local" ? "LIVE · LOCAL" : "");
    board.scene.setState(view);
  }

  // The clock has to keep counting between messages: the host only writes
  // when something actually happens, and the anchor is what makes that
  // possible without a message a frame.
  board.onFrame = () => {
    if (!session.joined) return;
    board.scene.setClocks(session.clocks());
  };

  await session.open(onChange);
  onChange();
}

/**
 * Seats are addressed by contestant name, so a link reads
 * `?seat=Ana` rather than `?seat=0`. Matched loosely — case and stray spaces
 * should not break a link that was typed out by hand — with a plain index
 * accepted as a fallback.
 */
function resolveSeat(players: string[], wanted: string): number {
  const trimmed = wanted.trim();
  if (!trimmed) return -1;

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    return index >= 0 && index < players.length ? index : -1;
  }

  const target = trimmed.toLowerCase();
  return players.findIndex((p) => (p ?? "").trim().toLowerCase() === target);
}
