import type { AppConfig } from "../config";
import { isPlayable, prompt, timeLimitOf, type GameDoc } from "../doc/types";
import {
  askableAfter,
  type MatchResult,
  type MatchState,
  type Ruling,
} from "./match";

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

/**
 * What a panel is for, which is what a screen labels it.
 *
 *   current   the question being read out now
 *   next      the same contestant's following letter — a right answer keeps
 *             their clock, so this is usually the one read out next
 *   opponent  what the other contestant is sitting on, for when the table
 *             does change hands
 *   notice    round-wide, belonging to no seat ("ROUND OVER")
 */
export type QuestionRole = "current" | "next" | "opponent" | "notice";

/** One panel: worded for reading aloud, redacted for the audience. */
export interface QuestionView {
  /** Whose question this is. "" for a round-wide notice with no seat. */
  label: string;
  /** Which seat it belongs to, so a screen can point at that donut. -1: none. */
  seat: number;
  role: QuestionRole;
  /**
   * The question on the table — the one the host is reading out *now*. The
   * other panels are read-ahead: never aloud, and drawn to recede.
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
   * The panels on the table, in role order: current, next, opponent. Ordered
   * by role rather than by seat, so the host's eye does not have to re-find
   * the question in play every time the table moves.
   *
   * A screen that is only entitled to the letter in play gets a single
   * panel, and a round-wide notice ("ROUND OVER") is also one.
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
    seat: -1,
    role: "notice",
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
  /**
   * Blank the clue whenever the clock is stopped, so a pause is not free
   * thinking time. Never true for the host, who is the one person in the
   * room who needs the clue most while the clock is not running.
   */
  hideWhenPaused: boolean;
  /**
   * How many panels to word.
   *
   *   "current"  the question on the table and nothing else
   *   "host"     current, the same contestant's next letter, and the
   *              opponent's — the console, where reading ahead is the job
   *
   * Not a count: every panel past the first is a clue somebody has not been
   * asked yet, so this is a decision about entitlement and it belongs here
   * with the other two.
   */
  panels: "current" | "host";
}

/**
 * The host's console: everything, subject to their own answer toggle.
 *
 * `hideWhenPaused` is not one of the toggles, and deliberately not
 * `config.game.hideCluePaused`: that setting is about what a *contestant* may
 * read while the clock is stopped. Stopping the clock is what a host does in
 * order to adjudicate a disputed answer, or to take a breath before reading
 * the next one out, and neither works off a blank panel.
 */
export function redactionFor(config: AppConfig): Redaction {
  return {
    clue: true,
    answer: config.game.showAnswer,
    hideWhenPaused: false,
    panels: "host",
  };
}

/**
 * Any screen that is not the host's: the question being read out, no answer,
 * no reading ahead.
 *
 * Both `/view` and a contestant's screen want exactly this, for the same
 * reason — neither of them is sitting next to the host. `/view` especially,
 * because it is a link anyone can open: with the host's own redaction it
 * printed the expected answer under the clue and the waiting contestant's
 * question beside it.
 */
export function redactionForAudience(config: AppConfig): Redaction {
  return {
    clue: true,
    answer: false,
    hideWhenPaused: config.game.hideCluePaused,
    panels: "current",
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
 * Three panels on the host's console, because three is how many questions
 * could be the next one they read out: a right answer keeps the clock and
 * moves this contestant on a letter, and anything else hands the table to
 * the opponent. None of the three should mean leafing through the document
 * while a clock runs.
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

  const turn = state.seats[state.turn];
  if (!turn) {
    return [
      {
        ...blankQuestion(),
        active: true,
        prompt: "NOTHING TO ASK",
        notice: "This document has no boards.",
      },
    ];
  }

  const current = questionOf(state, state.turn, turn.index, "current", show);
  if (show.panels === "current") return [current];

  const panels = [
    current,
    // Where a right answer goes. -1 once this is their last letter, which
    // `questionOf` says in words rather than leaving a blank panel.
    questionOf(state, state.turn, askableAfter(turn, turn.index), "next", show),
  ];

  for (let i = 1; i < state.seats.length; i++) {
    const other = (state.turn + i) % state.seats.length;
    panels.push(
      questionOf(state, other, state.seats[other].index, "opponent", show),
    );
  }

  return panels;
}

function questionOf(
  state: MatchState,
  seatIndex: number,
  entryIndex: number,
  role: QuestionRole,
  show: Redaction,
): QuestionView {
  const seat = state.seats[seatIndex];
  const base = {
    ...blankQuestion(),
    label: seat.player,
    seat: seatIndex,
    role,
    active: role === "current",
  };
  const entry = entryIndex >= 0 ? seat.entries[entryIndex] : null;

  if (!entry) {
    // "Nothing left" and "nothing ever written" look identical on the donut,
    // and the fix for them is not the same one. Nor is "they are on their
    // last letter", which is only ever the read-ahead panel's problem.
    const unwritten = !seat.entries.some(isPlayable);
    return {
      ...base,
      prompt: "NOTHING TO ASK",
      notice: unwritten
        ? `No clues written for ${seat.player} yet.`
        : role === "next" && seat.index >= 0
          ? `Last letter on ${seat.player}'s donut.`
          : `${seat.player} has no letters left to play.`,
    };
  }

  const worded = prompt(entry).toUpperCase();

  // The letter stays on show either way — the donut is already pointing at
  // it — but the clue itself waits for the clock. Only ever on a screen that
  // is not the host's: a pause should not turn into free reading time for a
  // contestant, and it is the host who called the pause.
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
