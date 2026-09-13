import {
  boardAt,
  isPlayable,
  SEATS,
  type Entry,
  type GameDoc,
} from "../doc/types";

/**
 * The rules, with no pixi anywhere in the file.
 *
 * A round is two contestants, one clock each, taking turns on their own donut:
 *
 *   right   scores, and the clock keeps running — you answer until you stop
 *   wrong   scores; the turn survives until `strikeLimit` of them
 *   pass    stops the clock, hands over, and the letter comes back later
 *
 * That single asymmetry ("right keeps the clock") is the whole game, and it is
 * why the host needs a keyboard rather than a mouse: the clock is running
 * while they rule.
 *
 * Strikes are counted per turn, not per round: a contestant gets
 * `strikeLimit` mistakes each time the table comes to them, and the count
 * goes back to zero when they lose it. A pass therefore wipes a strike, which
 * is the price of passing rather than guessing.
 *
 * Every mutating action pushes a snapshot first, so `undo()` covers all of
 * them — including the automatic hand-over and the clock hitting zero. A host
 * who mis-keys under time pressure can always take it back.
 */

/** Where a letter stands. `passed` is still askable; the other two are not. */
export type Ruling = "open" | "correct" | "wrong" | "passed";

export interface SeatState {
  player: string;
  entries: Entry[];
  rulings: Ruling[];
  /** Index of the letter on the table, or -1 when none is left to ask. */
  index: number;
  remainingMs: number;
  correct: number;
  wrong: number;
  /**
   * Wrong answers in the *current* turn. Reset when the table leaves this
   * seat; `wrong` is the running total for the round and never resets.
   */
  strikes: number;
  /** Out of the round: clock spent, or nothing left to ask. */
  done: boolean;
}

export interface MatchResult {
  /** Seat index, or null for a draw. */
  winner: number | null;
  reason: string;
}

export interface MatchState {
  seats: SeatState[];
  /** Seat whose clock runs and whose letter is on the table. */
  turn: number;
  running: boolean;
  /** Non-null once the round is over; every action but undo/reset is inert. */
  result: MatchResult | null;
}

/**
 * Something the host or the audience should notice. The match reports these
 * rather than making noise itself, so `/view` and the creator preview can run
 * the same rules in silence.
 */
export type MatchEvent =
  | "correct"
  | "wrong"
  | "pass"
  | "start"
  | "stop"
  | "switch"
  | "tick"
  | "timeup"
  | "over";

export interface MatchOptions {
  /** Seconds on each clock. */
  timeLimit: number;
  /**
   * Wrong answers a contestant gets in one turn before the table passes. 1
   * makes any mistake cost the turn.
   */
  strikeLimit: number;
  /** Seconds remaining at which `tick` starts firing once a second. */
  warnAt: number;
  /**
   * Millisecond clock, injectable so the rules can be tested without
   * waiting. Defaults to `performance.now`.
   */
  now?: () => number;
}

/** Undo depth. A round is a few hundred keystrokes at most. */
const HISTORY_LIMIT = 300;

export class Match {
  private state: MatchState;
  private history: MatchState[] = [];
  /** Whole seconds already announced, so `tick` fires once per second. */
  private lastTickSecond = -1;

  /**
   * Wall-clock anchor for the running seat: the reading its clock had when it
   * last started, and the moment that was.
   *
   * The clock is deliberately *not* integrated from per-frame deltas. Pixi's
   * ticker clamps `deltaMS` to 100ms, so on a machine dropping frames — or a
   * tab the browser has throttled — an accumulated clock silently runs slow.
   * A contestant's 150 seconds has to be 150 seconds.
   */
  private runningSince = 0;
  private remainingAtStart = 0;
  /**
   * Bumped every time the clock is re-anchored. A publisher watches this to
   * tell a fresh run from an unrelated change, so it only stamps a new start
   * time when the clock actually (re)started.
   */
  private runId = 0;

  /** Redraw hook: fired once after any change, never during a read. */
  onChange: (state: MatchState) => void = () => {};
  /** Cue hook: audio, in practice. May fire several times per action. */
  onEvent: (event: MatchEvent) => void = () => {};

  constructor(
    private doc: GameDoc,
    private opts: MatchOptions,
  ) {
    this.state = initialState(doc, opts);
  }

  /** The live state. Read it, do not write it. */
  get snapshot(): MatchState {
    return this.state;
  }

  get seat(): SeatState {
    return this.state.seats[this.state.turn];
  }

  /** The letter on the table, or null between rounds. */
  get entry(): Entry | null {
    const seat = this.seat;
    return seat.index >= 0 ? (seat.entries[seat.index] ?? null) : null;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * The clock as an anchor rather than a reading.
   *
   * A reading is useless to another machine: it is stale the instant it is
   * sent, and a screen given one would show a frozen clock between rulings.
   * `remainingAtStart` plus the moment `runId` began lets every screen run
   * the same countdown off its own frame loop.
   */
  get clock(): { running: boolean; remainingAtStart: number; runId: number } {
    return {
      running: this.state.running,
      // While stopped the seat's own reading is already current: `stop` folds
      // the elapsed time in before it pauses.
      remainingAtStart: this.state.running
        ? this.remainingAtStart
        : (this.seat?.remainingMs ?? 0),
      runId: this.runId,
    };
  }

  // --- clock ------------------------------------------------------------

  /**
   * Re-read the active clock. Called from the ticker, so it is hot — but it
   * takes no delta: the reading comes from the wall clock, and the frame rate
   * only decides how often anyone looks.
   */
  tick(): void {
    const s = this.state;
    if (!s.running || s.result) return;

    const seat = s.seats[s.turn];
    if (seat.done) {
      // Nothing to spend the time on; do not silently burn the clock.
      this.stop();
      return;
    }

    this.syncClock();

    const whole = Math.ceil(seat.remainingMs / 1000);
    if (
      seat.remainingMs > 0 &&
      whole <= this.opts.warnAt &&
      whole !== this.lastTickSecond
    ) {
      this.lastTickSecond = whole;
      this.onEvent("tick");
    }

    if (seat.remainingMs <= 0) {
      // The clock running out is an action like any other, so it has to be
      // undoable — hence a snapshot even though no key was pressed.
      this.push();
      seat.remainingMs = 0;
      retire(seat);
      s.running = false;
      this.onEvent("timeup");
      this.handOver();
      this.settle();
      this.changed();
      return;
    }

    // No `changed()`: the scene reads the clock every frame anyway, and
    // firing a change event 60 times a second would defeat the point of one.
  }

  /** Start or pause the active clock. The host's most-used key. */
  toggleClock(): void {
    if (this.state.running) this.stop();
    else this.start();
  }

  start(): void {
    const s = this.state;
    if (s.running || s.result) return;
    if (s.seats[s.turn].done || s.seats[s.turn].index < 0) return;
    this.push();
    s.running = true;
    this.anchor();
    this.lastTickSecond = -1;
    this.onEvent("start");
    this.changed();
  }

  stop(): void {
    const s = this.state;
    if (!s.running) return;
    // Fold the elapsed time in before pausing: the last tick may have been a
    // frame ago, or — in a throttled tab — a great deal longer.
    this.syncClock();
    this.push();
    s.running = false;
    this.onEvent("stop");
    this.changed();
  }

  // --- rulings ----------------------------------------------------------

  /** Right: score it and keep going, clock still running. */
  markCorrect(): void {
    const seat = this.seat;
    if (this.state.result || seat.index < 0) return;
    this.syncClock();
    this.push();

    seat.rulings[seat.index] = "correct";
    seat.correct++;
    this.onEvent("correct");
    this.advance(seat);
    this.settle();
    this.changed();
  }

  /**
   * Wrong: score it, and take a strike. The clock keeps running until the
   * strikes run out, so a contestant who misses one letter can carry on.
   */
  markWrong(): void {
    const seat = this.seat;
    if (this.state.result || seat.index < 0) return;
    this.syncClock();
    this.push();

    seat.rulings[seat.index] = "wrong";
    seat.wrong++;
    seat.strikes++;
    this.onEvent("wrong");
    this.advance(seat);

    // Running out of letters ends the turn too, whatever the strikes say —
    // otherwise the table would sit on a seat with nothing left to ask.
    if (seat.strikes >= Math.max(1, this.opts.strikeLimit) || seat.done) {
      this.state.running = false;
      this.handOver();
    }
    this.settle();
    this.changed();
  }

  /** Pass: stop the clock and hand over. The letter comes back round. */
  pass(): void {
    const seat = this.seat;
    if (this.state.result || seat.index < 0) return;
    this.syncClock();
    this.push();

    seat.rulings[seat.index] = "passed";
    this.state.running = false;
    this.onEvent("pass");
    this.advance(seat);
    this.handOver();
    this.settle();
    this.changed();
  }

  // --- getting about ----------------------------------------------------

  /**
   * Hand the turn over by hand, pausing the clock.
   *
   * Deliberately not "hand over live": this key exists to correct a mis-keyed
   * ruling, and a switch that quietly kept draining the new contestant's
   * clock would turn one slip into two.
   */
  switchSeat(): void {
    const s = this.state;
    if (s.result || s.seats.length < 2) return;
    this.syncClock();
    this.push();
    s.running = false;
    s.seats[s.turn].strikes = 0;
    s.turn = (s.turn + 1) % s.seats.length;
    this.onEvent("switch");
    this.changed();
  }

  /** Move to another askable letter without ruling the current one. */
  step(delta: number): void {
    const seat = this.seat;
    if (this.state.result || seat.index < 0) return;
    const next = findAskable(seat, seat.index, delta);
    if (next === seat.index) return;
    this.push();
    seat.index = next;
    this.changed();
  }

  /** Put the letter on the table back to unasked. */
  reopen(): void {
    const seat = this.seat;
    if (this.state.result || seat.index < 0) return;
    const was = seat.rulings[seat.index];
    if (was === "open") return;
    this.push();
    if (was === "correct") seat.correct--;
    if (was === "wrong") seat.wrong--;
    seat.rulings[seat.index] = "open";
    retire(seat);
    this.changed();
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.state = previous;
    // The restored clock is the new truth; re-anchor or the next tick would
    // measure from the undone run.
    this.anchor();
    this.lastTickSecond = -1;
    this.changed();
  }

  /** Back to the top of the round, with the current document. */
  reset(): void {
    this.state = initialState(this.doc, this.opts);
    this.history = [];
    this.anchor();
    this.lastTickSecond = -1;
    this.changed();
  }

  /** Re-seat the round on a new document, e.g. the creator's live preview. */
  setDoc(doc: GameDoc, opts: MatchOptions = this.opts): void {
    this.doc = doc;
    this.opts = opts;
    this.reset();
  }

  // --- internals --------------------------------------------------------

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  /** Bring the running seat's clock up to the present. */
  private syncClock(): void {
    const s = this.state;
    if (!s.running) return;
    const seat = s.seats[s.turn];
    seat.remainingMs = Math.max(
      0,
      this.remainingAtStart - (this.now() - this.runningSince),
    );
  }

  /** Take the current reading as the anchor for whatever runs next. */
  private anchor(): void {
    this.remainingAtStart = this.seat?.remainingMs ?? 0;
    this.runningSince = this.now();
    this.runId++;
  }

  /** Move a seat to its next askable letter, or retire it. */
  private advance(seat: SeatState): void {
    seat.index = findAskable(seat, seat.index, 1);
    retire(seat);
  }

  /**
   * Give the turn to the other contestant if they are still in it. A seat
   * playing alone keeps the table, which is how the tail of a round works
   * once one clock is spent.
   */
  private handOver(): void {
    const s = this.state;
    // Strikes are per turn, so the seat losing the table starts clean next
    // time. Done unconditionally: a seat playing on alone has nobody to hand
    // to, and would otherwise be stuck one strike from a turn it cannot lose.
    s.seats[s.turn].strikes = 0;

    for (let i = 1; i < s.seats.length; i++) {
      const candidate = (s.turn + i) % s.seats.length;
      if (s.seats[candidate].done) continue;
      if (candidate !== s.turn) {
        s.turn = candidate;
        this.onEvent("switch");
      }
      return;
    }
    // Everyone is out; `settle` will call it.
  }

  /** Decide whether the round is over, and who took it. */
  private settle(): void {
    const s = this.state;
    if (s.result) return;

    // "Cleared" means every authored letter is right — not merely "done with
    // no mistakes", which is also true of a clock that ran out on a clean run.
    const full = s.seats.findIndex(
      (seat) => seat.correct > 0 && seat.correct === playableCount(seat),
    );
    if (full >= 0) {
      s.running = false;
      s.result = {
        winner: full,
        reason: `${s.seats[full].player} cleared the donut`,
      };
      this.onEvent("over");
      return;
    }

    if (!s.seats.every((seat) => seat.done)) return;

    s.running = false;
    const best = Math.max(...s.seats.map((seat) => seat.correct));
    const leaders = s.seats
      .map((seat, i) => ({ seat, i }))
      .filter(({ seat }) => seat.correct === best);

    s.result =
      leaders.length === 1
        ? {
            winner: leaders[0].i,
            reason: `${leaders[0].seat.player} wins with ${best}`,
          }
        : { winner: null, reason: `Level on ${best}` };
    this.onEvent("over");
  }

  private push(): void {
    this.history.push(clone(this.state));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  private changed(): void {
    this.onChange(this.state);
  }
}

/** A letter still worth asking: authored, and not already right or wrong. */
function askable(seat: SeatState, index: number): boolean {
  const entry = seat.entries[index];
  if (!entry || !isPlayable(entry)) return false;
  const ruling = seat.rulings[index];
  return ruling === "open" || ruling === "passed";
}

/**
 * The next askable letter from `from`, wrapping round the donut. Returns
 * `from` when it is the only one left and -1 when there are none, which is
 * what tells `advance` to retire the seat.
 */
function findAskable(seat: SeatState, from: number, delta: number): number {
  const n = seat.entries.length;
  if (n === 0) return -1;
  const step = delta >= 0 ? 1 : -1;
  for (let i = 1; i <= n; i++) {
    const at = (((from + i * step) % n) + n) % n;
    if (askable(seat, at)) return at;
  }
  return askable(seat, from) ? from : -1;
}

/** Is this seat out of the round? Clock spent, or nothing left to ask. */
function retire(seat: SeatState): void {
  seat.done =
    seat.remainingMs <= 0 || !seat.entries.some((_, i) => askable(seat, i));
}

function playableCount(seat: SeatState): number {
  return seat.entries.filter(isPlayable).length;
}

function initialState(doc: GameDoc, opts: MatchOptions): MatchState {
  const seats = Array.from({ length: SEATS }, (_, i) => {
    const board = boardAt(doc, i);
    const seat: SeatState = {
      player: board.player,
      entries: board.entries,
      rulings: board.entries.map(() => "open" as Ruling),
      index: -1,
      remainingMs: opts.timeLimit * 1000,
      correct: 0,
      wrong: 0,
      strikes: 0,
      done: false,
    };
    // Search from -1 so a board with no clues at all starts out retired
    // rather than pointing at a letter nobody can be asked.
    seat.index = findAskable(seat, -1, 1);
    retire(seat);
    return seat;
  });

  const first = seats.findIndex((seat) => !seat.done);
  return {
    seats,
    turn: first < 0 ? 0 : first,
    running: false,
    result: null,
  };
}

/** Deep enough: `entries` are immutable document objects and can be shared. */
function clone(state: MatchState): MatchState {
  return {
    ...state,
    seats: state.seats.map((seat) => ({ ...seat, rulings: [...seat.rulings] })),
    result: state.result ? { ...state.result } : null,
  };
}
