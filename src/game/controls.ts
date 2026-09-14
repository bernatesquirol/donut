import type { AppConfig } from "../config";
import type { Match } from "./match";

/**
 * The host's keyboard.
 *
 * One table drives both the listener and the on-screen guide, because a
 * shortcut that is not on the card might as well not exist — and a card that
 * has drifted from the code is worse than none.
 *
 * The layout assumes a host with one hand on the keyboard and their eyes on
 * the contestant: the three rulings are the three keys you can find without
 * looking (space, enter, backspace), and everything destructive is a letter
 * you have to aim for.
 *
 * How many wrong answers a turn survives is `config.game.strikes`, not
 * something the keyboard decides — the host rules on the answer and the rules
 * work out what it costs. Same for how much the clock keys are worth:
 * `config.game.timeStep`. `guideRows` is what keeps the card in step with
 * both.
 */
export interface ControlHost {
  match: Match;
  /**
   * Read at the moment a key is pressed, not when the table was built, so a
   * binding whose effect a setting decides sees the current value.
   */
  config: AppConfig;
  /** Show or hide the expected answer under the clue. */
  toggleAnswer(): void;
  /** Silence the cues, or bring them back. */
  toggleMute(): void;
  /** Open the key guide, pausing the clock. */
  showGuide(): void;
  /**
   * Ask whether to restart, and restart if the answer is yes.
   *
   * The one action the keyboard does not just do. Every other key is covered
   * by `undo`; `reset` empties the undo history along with the round, so
   * there is nothing left to take it back with.
   */
  confirmReset(): void;
}

export interface Binding {
  /** `KeyboardEvent.key` values, compared case-insensitively. */
  keys: string[];
  /** How the key is written on the guide. */
  label: string;
  description: string;
  /**
   * For the keys whose effect a setting changes. Overrides `description` on
   * the guide, so raising `game.strikes` cannot leave the card lying about
   * what the key does.
   */
  describe?: (config: AppConfig) => string;
  run: (host: ControlHost) => void;
}

export const BINDINGS: Binding[] = [
  {
    keys: [" "],
    label: "SPACE",
    description: "start or pause the clock",
    run: ({ match }) => match.toggleClock(),
  },
  {
    keys: ["Enter"],
    label: "ENTER",
    description: "right — scores, and the clock keeps running",
    run: ({ match }) => match.markCorrect(),
  },
  {
    keys: ["Backspace"],
    label: "BACKSPACE",
    description: "wrong — scores, stops the clock, hands over",
    describe: ({ game }) =>
      game.strikes > 1
        ? `wrong — scores; ${game.strikes} in one turn hands over`
        : "wrong — scores, stops the clock, hands over",
    run: ({ match }) => match.markWrong(),
  },
  {
    keys: ["p"],
    label: "P",
    description: "pass — hands over, and the letter comes back",
    run: ({ match }) => match.pass(),
  },
  {
    keys: ["Tab"],
    label: "TAB",
    description: "change contestant, pausing the clock",
    run: ({ match }) => match.switchSeat(),
  },
  {
    keys: ["ArrowRight"],
    label: "→",
    description: "next letter, without ruling this one",
    run: ({ match }) => match.step(1),
  },
  {
    keys: ["ArrowLeft"],
    label: "←",
    description: "previous letter, without ruling this one",
    run: ({ match }) => match.step(-1),
  },
  {
    keys: ["z"],
    label: "Z",
    description: "undo — including a hand-over or a clock that ran out",
    run: ({ match }) => match.undo(),
  },
  {
    keys: ["o"],
    label: "O",
    description: "reopen this letter, as if it had never been asked",
    run: ({ match }) => match.reopen(),
  },
  // Adjusting a clock by hand: the two keys at the left-hand end of the
  // number row belong to the contestant on the left of the stage, the two at
  // the right-hand end to the one on the right, and the outer key of each
  // pair adds. It is a mapping you can find without looking down, which is
  // the only kind worth having here — and the usual reason to reach for it is
  // that the studio interrupted the contestant who is *not* playing yet, so
  // both clocks have to be reachable whoever has the table.
  {
    keys: ["1"],
    label: "1",
    description: "add time to the left contestant's clock",
    describe: ({ game }) => `left contestant +${game.timeStep}s`,
    run: ({ match, config }) => match.addTime(0, config.game.timeStep * 1000),
  },
  {
    keys: ["2"],
    label: "2",
    description: "take time off the left contestant's clock",
    describe: ({ game }) => `left contestant -${game.timeStep}s`,
    run: ({ match, config }) => match.addTime(0, -config.game.timeStep * 1000),
  },
  {
    keys: ["9"],
    label: "9",
    description: "take time off the right contestant's clock",
    describe: ({ game }) => `right contestant -${game.timeStep}s`,
    run: ({ match, config }) => match.addTime(1, -config.game.timeStep * 1000),
  },
  {
    keys: ["0"],
    label: "0",
    description: "add time to the right contestant's clock",
    describe: ({ game }) => `right contestant +${game.timeStep}s`,
    run: ({ match, config }) => match.addTime(1, config.game.timeStep * 1000),
  },
  {
    keys: ["a"],
    label: "A",
    description: "show or hide the answer",
    run: (host) => host.toggleAnswer(),
  },
  {
    keys: ["m"],
    label: "M",
    description: "mute or unmute the cues",
    run: (host) => host.toggleMute(),
  },
  {
    keys: ["r"],
    label: "R",
    description: "restart the round from the top — asks first",
    run: (host) => host.confirmReset(),
  },
  {
    keys: ["h", "?"],
    label: "H",
    description: "this list",
    run: (host) => host.showGuide(),
  },
];

/** The key card, with the config-dependent wording resolved. */
export function guideRows(
  config: AppConfig,
): { label: string; description: string }[] {
  return BINDINGS.map(({ label, description, describe }) => ({
    label,
    description: describe ? describe(config) : description,
  }));
}

/**
 * Listen for the whole table. Returns the unsubscribe.
 *
 * `keydown` on the window rather than on the canvas: the host may well have
 * clicked the browser chrome, and losing the rulings because focus wandered
 * off a canvas is not a failure mode worth having.
 */
export function bindKeyboard(host: ControlHost): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    // Leave the browser's own shortcuts alone, and stay out of the way of
    // anything with a text cursor in it.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;

    const binding = BINDINGS.find((b) =>
      b.keys.some((k) => k.toLowerCase() === e.key.toLowerCase()),
    );
    if (!binding) return;

    // Space scrolls, backspace navigates back, tab moves focus — all three
    // would be a disaster mid-round.
    e.preventDefault();
    binding.run(host);
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
