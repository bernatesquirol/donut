import type { AppConfig } from "../config";
import { isPlayable, prompt, timeLimitOf, type GameDoc } from "../doc/types";
import type { MatchResult, MatchState, Ruling, SeatState } from "./match";

/**
 * What a screen draws — and, just as importantly, what it is allowed to know.
 *
 * The scene used to read `MatchState` directly, which was fine while the host
 * console was the only screen. It is not fine once contestants have screens of
 * their own: `MatchState.seats[].entries` holds every clue *and every answer*,
 * so anything given that object can read the whole round ahead.
 *
 * So the scene renders a `MatchView` instead: letters, rulings, clocks, and
 * questions that have already been worded and already been redacted. Two
 * producers build one, and neither can leak what it does not include —
 *
 *   `viewOf`      on the host, from the live `MatchState`
 *   `viewOfLive`  on a contestant screen, from what arrived over the wire
 *
 * Which also means the rules about what is visible when — the answer toggle,
 * hiding the clue while the clock is stopped — live in one place rather than
 * being re-decided per screen.
 */
export interface LetterView {
  letter: string;
  ruling: Ruling;
  /** Authored, so the round can ask it. Drawn faintly when false. */
  inPlay: boolean;
}

export interface SeatView {
  player: string;
  letters: LetterView[];
  /** Index of the letter on the table, or -1 when none is left to ask. */
  index: number;
  remainingMs: number;
  /** The full clock, for the ring that drains round the donut. */
  limitMs: number;
  correct: number;
  wrong: number;
  strikes: number;
  done: boolean;
}

/** One panel: worded for reading aloud, redacted for the audience. */
export interface QuestionView {
  /** Whose question this is. "" for a round-wide notice with no seat. */
  label: string;
  /**
   * The seat on the table — the one the host is reading out *now*. Every
   * other panel is what that contestant will be asked when the table comes
   * back to them, which is only there to be read ahead, never aloud.
   */
  active: boolean;
  /** "STARTS WITH C", or "" when there is nothing on the table. */
  prompt: string;
  /** The clue, or "" when this screen should not show it. */
  clue: string;
  /** The answer, or "" when this screen should not show it. */
  answer: string;
  /** Shown in place of a clue: round over, nothing authored, clock stopped. */
  notice: string;
}

export interface MatchView {
  seats: SeatView[];
  turn: number;
  running: boolean;
  result: MatchResult | null;
  strikeLimit: number;
  /**
   * The panels on the table, in seat order. The host console gets one per
   * contestant so the next question is visible while the current one is
   * being answered; a screen that is only entitled to the letter in play
   * gets a single panel, and a round-wide notice ("ROUND OVER") is also one.
   */
  questions: QuestionView[];
}

/** The panel the host is reading out. Blank when there is nothing to ask. */
export function activeQuestion(view: MatchView): QuestionView {
  return view.questions.find((q) => q.active) ?? blankQuestion();
}

/** An empty panel, to be spread over. */
export function blankQuestion(): QuestionView {
  return {
    label: "",
    active: false,
    prompt: "",
    clue: "",
    answer: "",
    notice: "",
  };
}

/** How much of the question a screen is entitled to. */
export interface Redaction {
  /** Print the clue while the clock runs. */
  clue: boolean;
  /** Print the expected answer. Never true on a contestant's screen. */
  answer: boolean;
  /** Blank the clue whenever the clock is stopped. */
  hideWhenPaused: boolean;
  /**
   * Word a panel for every contestant rather than only the one on the table.
   * True for the host, who reads ahead; false everywhere else, because the
   * other seat's panel is a clue that contestant has not been asked yet.
   */
  everySeat: boolean;
}

export function redactionFor(config: AppConfig): Redaction {
  return {
    clue: true,
    answer: config.game.showAnswer,
    hideWhenPaused: config.game.hideCluePaused,
    everySeat: true,
  };
}

/**
 * The host's view: the whole state, redacted by `show` — their own settings by
 * default, something stricter when projecting for someone else's screen.
 */
export function viewOf(
  state: MatchState,
  doc: GameDoc,
  config: AppConfig,
  show: Redaction = redactionFor(config),
): MatchView {
  const limitMs = timeLimitOf(doc, config.game.timeLimit) * 1000;

  return {
    seats: state.seats.map((seat) => ({
      player: seat.player,
      letters: seat.entries.map((entry, i) => ({
        letter: entry.letter,
        ruling: seat.rulings[i] ?? "open",
        inPlay: isPlayable(entry),
      })),
      index: seat.index,
      remainingMs: seat.remainingMs,
      limitMs,
      correct: seat.correct,
      wrong: seat.wrong,
      strikes: seat.strikes,
      done: seat.done,
    })),
    turn: state.turn,
    running: state.running,
    result: state.result,
    strikeLimit: Math.max(1, config.game.strikes),
    questions: questionsOf(state, show),
  };
}

/**
 * Word and redact the panels. The one place either decision is made.
 *
 * A panel per seat on the host's console: the whole point of the host screen
 * is that they can see what is coming for the contestant who is waiting,
 * without leafing through the document while a clock runs.
 */
function questionsOf(state: MatchState, show: Redaction): QuestionView[] {
  if (state.result) {
    return [
      {
        ...blankQuestion(),
        active: true,
        prompt: "ROUND OVER",
        notice: state.result.reason,
      },
    ];
  }

  if (state.seats.length === 0) {
    return [
      {
        ...blankQuestion(),
        active: true,
        prompt: "NOTHING TO ASK",
        notice: "This document has no boards.",
      },
    ];
  }

  const wanted = show.everySeat ? state.seats.map((_, i) => i) : [state.turn];

  return wanted
    .filter((i) => state.seats[i] !== undefined)
    .map((i) => questionOf(state.seats[i], i === state.turn, state, show));
}

function questionOf(
  seat: SeatState,
  active: boolean,
  state: MatchState,
  show: Redaction,
): QuestionView {
  const base = { ...blankQuestion(), label: seat.player, active };
  const entry = seat.index >= 0 ? seat.entries[seat.index] : null;

  if (!entry) {
    // "Nothing left" and "nothing ever written" look identical on the donut,
    // and the fix for them is not the same one.
    const unwritten = !seat.entries.some(isPlayable);
    return {
      ...base,
      prompt: "NOTHING TO ASK",
      notice: unwritten
        ? `No clues written for ${seat.player} yet.`
        : `${seat.player} has no letters left to play.`,
    };
  }

  const worded = prompt(entry).toUpperCase();

  // The letter stays on show either way — the donut is already pointing at
  // it — but the clue itself waits for the clock. The waiting seat's panel
  // follows the same rule: a pause should not turn into free reading time
  // for anyone who can see this screen.
  if (show.hideWhenPaused && !state.running) {
    return { ...base, prompt: worded };
  }

  return {
    ...base,
    prompt: worded,
    clue: show.clue ? entry.clue : "",
    answer: show.answer ? entry.answer || "— no answer recorded —" : "",
  };
}
