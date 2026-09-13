import type { MatchResult, Ruling } from "../game/match";

/**
 * What crosses the wire during a live round.
 *
 * Deliberately not `MatchState`. That object carries every clue and every
 * answer, so publishing it would put the whole round in a database the
 * contestants' own screens read — one devtools tab from being a cheat sheet.
 * This shape carries the current clue and nothing else about the questions;
 * there is no field for an answer, so no future change can accidentally start
 * sending one.
 *
 * The clock is an anchor, not a reading. `startedAt` is server time, so every
 * screen runs the same countdown off its own frame loop instead of watching a
 * number that only updates when the host presses a key.
 */
export interface LiveMatch {
  /** Bumped by the host on every write; lets a client drop a stale one. */
  rev: number;
  /** The round's name. Not secret, and a screen with no document needs it. */
  title: string;
  seats: LiveSeat[];
  turn: number;
  strikeLimit: number;
  clock: LiveClock;
  result: MatchResult | null;
  /** "STARTS WITH C", already worded for reading out. */
  prompt: string;
  /** The clue on the table. Never an answer — there is nowhere to put one. */
  clue: string;
  /** Shown instead of a clue: round over, or nothing left to ask. */
  notice: string;
}

export interface LiveSeat {
  player: string;
  /**
   * One character per letter, in ring order. A plain string rather than an
   * array because it is the cheapest thing to diff and the letters are not
   * secret.
   */
  letters: string;
  /** One ruling per letter, same order. */
  rulings: Ruling[];
  /** Which letters were actually authored, same order. */
  inPlay: boolean[];
  index: number;
  /**
   * Last known reading. Correct as-is for every stopped clock; for the seat
   * that is running, `LiveClock` overrides it — otherwise the opponent's
   * clock would be blank.
   */
  remainingMs: number;
  limitMs: number;
  correct: number;
  wrong: number;
  strikes: number;
  done: boolean;
}

export interface LiveClock {
  running: boolean;
  /** The active seat's reading when this run began. */
  remainingAtStart: number;
  /**
   * Server time at which it began, or null while stopped. Server time and not
   * the host's: a contestant's laptop clock can be minutes out, and the
   * countdown would be wrong by exactly that much.
   */
  startedAt: number | null;
}

/**
 * A transport is a room you can write to and listen on. Two implementations:
 * Firebase Realtime Database for the real thing, and a same-origin channel
 * for developing both screens on one machine.
 */
export interface LiveTransport {
  /** Which one this is, for screens that need to say so in two words. */
  readonly kind: "firebase" | "local";
  /** False when nothing is configured; callers explain rather than fail. */
  readonly enabled: boolean;
  /** Human-readable name of where this is going, for the host's screen. */
  readonly label: string;
  /** Overwrite the room. Hosts call this on every change. */
  publish(room: string, match: LiveMatch): Promise<void>;
  /**
   * Listen. `onMatch` fires with the current value immediately if there is
   * one, then on every change. Returns the unsubscribe.
   */
  subscribe(
    room: string,
    onMatch: (match: LiveMatch | null) => void,
    onError?: (err: Error) => void,
  ): () => void;
  /**
   * Milliseconds to add to `Date.now()` to get server time. 0 when the
   * transport has no opinion.
   */
  serverOffset(): Promise<number>;
  /** Drop the room. Hosts call this when a round is finished with. */
  close(room: string): Promise<void>;
}

/**
 * Where a round lives in the database.
 *
 * Both halves are required: the document id alone is not a secret — it is in
 * every published share link and in the S3 catalogue — so with open database
 * rules it would let anyone who has seen a link write into a live match. The
 * key is the part that is actually unguessable.
 */
export function roomPath(docId: string, liveKey: string): string {
  return `${sanitise(docId)}-${sanitise(liveKey)}`;
}

/** Firebase paths reject `. $ # [ ] /` and control characters. */
function sanitise(part: string): string {
  return part.replace(/[.$#[\]/\s]+/g, "_");
}
