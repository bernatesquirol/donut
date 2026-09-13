import { activeQuestion, type MatchView, type SeatView } from "../game/view";
import type { LiveMatch, LiveSeat } from "./types";

/**
 * `MatchView` <-> `LiveMatch`.
 *
 * The view is the common currency: the host builds one from its `MatchState`
 * with a contestant's redaction applied, this flattens it for the wire, and a
 * contestant screen inflates it back. Nothing in this file can invent a field
 * the view did not already decide to include, which is what keeps the answers
 * off the network.
 */

export interface ClockAnchor {
  running: boolean;
  remainingAtStart: number;
  /** Server time the run began, or null while stopped. */
  startedAt: number | null;
}

/** Flatten a contestant-safe view for publishing. */
export function liveOf(
  view: MatchView,
  anchor: ClockAnchor,
  rev: number,
  title: string,
): LiveMatch {
  // The letter on the table and nothing else. The host's own screen words a
  // panel per contestant so they can read ahead; the wire has room for one,
  // which is what keeps the waiting contestant's next clue off their screen.
  const question = activeQuestion(view);

  return {
    rev,
    title,
    seats: view.seats.map(seatToWire),
    turn: view.turn,
    strikeLimit: view.strikeLimit,
    clock: {
      running: anchor.running,
      remainingAtStart: Math.round(anchor.remainingAtStart),
      startedAt: anchor.startedAt,
    },
    result: view.result,
    prompt: question.prompt,
    clue: question.clue,
    notice: question.notice,
  };
}

function seatToWire(seat: SeatView): LiveSeat {
  return {
    player: seat.player,
    letters: seat.letters.map((l) => l.letter).join(""),
    rulings: seat.letters.map((l) => l.ruling),
    inPlay: seat.letters.map((l) => l.inPlay),
    index: seat.index,
    remainingMs: Math.round(seat.remainingMs),
    limitMs: seat.limitMs,
    correct: seat.correct,
    wrong: seat.wrong,
    strikes: seat.strikes,
    done: seat.done,
  };
}

/**
 * Inflate what arrived into something a scene can draw.
 *
 * `serverOffsetMs` is what to add to this machine's `Date.now()` to get server
 * time; without it a laptop whose clock is two minutes fast would show a
 * countdown two minutes short.
 */
export function viewOfLive(live: LiveMatch, serverOffsetMs: number): MatchView {
  const now = Date.now() + serverOffsetMs;

  return {
    seats: live.seats.map((seat, i) => seatFromWire(seat, i, live, now)),
    turn: live.turn,
    running: live.clock.running,
    result: live.result ?? null,
    strikeLimit: Math.max(1, live.strikeLimit),
    // One panel: the wire carries the letter on the table and nothing else,
    // so there is no opponent's question here to draw even if a screen
    // wanted to.
    questions: [
      {
        label: live.seats?.[live.turn]?.player ?? "",
        active: true,
        prompt: live.prompt ?? "",
        clue: live.clue ?? "",
        // There is no answer on the wire, and this is the only place a screen
        // could have shown one.
        answer: "",
        notice: live.notice ?? "",
      },
    ],
  };
}

/**
 * One seat's clock reading, now.
 *
 * Split out because it is the only thing that changes between messages: the
 * per-frame path calls this 26 times a second per seat rather than rebuilding
 * a whole view with 52 letters in it.
 */
export function liveClockOf(
  live: LiveMatch,
  index: number,
  serverNow: number,
): number {
  const seat = live.seats?.[index];
  if (!seat) return 0;
  const { running, startedAt, remainingAtStart } = live.clock;
  if (!running || index !== live.turn || startedAt == null) {
    return seat.remainingMs ?? 0;
  }
  return Math.max(0, remainingAtStart - (serverNow - startedAt));
}

function seatFromWire(
  seat: LiveSeat,
  index: number,
  live: LiveMatch,
  serverNow: number,
): SeatView {
  // Firebase drops empty arrays and nulls, so nothing here may assume a
  // field survived the round trip.
  const letters = [...(seat.letters ?? "")];
  const rulings = seat.rulings ?? [];
  const inPlay = seat.inPlay ?? [];

  return {
    player: seat.player ?? "",
    letters: letters.map((letter, i) => ({
      letter,
      ruling: rulings[i] ?? "open",
      inPlay: inPlay[i] ?? false,
    })),
    index: seat.index ?? -1,
    remainingMs: liveClockOf(live, index, serverNow),
    limitMs: seat.limitMs || 1,
    correct: seat.correct ?? 0,
    wrong: seat.wrong ?? 0,
    strikes: seat.strikes ?? 0,
    done: seat.done ?? false,
  };
}

/** Which seat a contestant's name refers to, or -1. */
export function seatOfName(live: LiveMatch, name: string): number {
  const wanted = name.trim().toLowerCase();
  return live.seats.findIndex(
    (s) => (s.player ?? "").trim().toLowerCase() === wanted,
  );
}
