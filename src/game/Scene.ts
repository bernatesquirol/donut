import {
  Container,
  FederatedPointerEvent,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import type { AppConfig } from "../config";
import { fonts, metrics, theme } from "../theme";
import { QuestionPanel } from "./QuestionPanel";
import { Rosco } from "./Rosco";
import type { MatchView, QuestionView } from "./view";

/** Which letter, on whose donut, a pointer landed on. */
export interface SceneTap {
  seat: number;
  index: number;
}

/** How much smaller the opponent's donut is on a contestant's own screen. */
const UNFOCUSED = 0.52;

/**
 * Below this width a panel per contestant is two unreadable columns rather
 * than one readable one, so only the question in play is drawn.
 */
const NARROW = 620;

/**
 * The playing surface: the donuts and the question on the table.
 *
 * A renderer and nothing else — the rules live in `match.ts`, the keys in
 * `controls.ts`, and what a given screen is allowed to see in `view.ts`. It
 * draws a `MatchView`, so the same class serves the host console reading a
 * local `Match` and a contestant screen reading a live room, with no idea
 * which it has.
 *
 *   setState(view)   structure, rulings, the question — on every change
 *   setClocks(ms[])  the readings — every frame, because a live clock runs
 *                    between changes
 *   setFocus(seat)   whose donut is the big one; null means "both equal"
 *   resize(w, h)     the host owns the size; the scene never reads the window
 *   update(deltaMS)  one tick
 *   onTap            a letter was clicked
 */
export class Scene extends Container {
  private roscos: Rosco[] = [];

  private topLeft: Text;
  private topMid: Text;
  private topRight: Text;

  /** One per question drawn: on the host, one per contestant. */
  private panels: QuestionPanel[] = [];
  private questions: QuestionView[] = [];

  private view: MatchView | null = null;
  private clocks: number[] = [];
  private focus: number | null = null;
  private title = "";
  /** Top-right corner: the help key, plus whatever is currently switched off. */
  private hint = "H  KEYS";

  private w = 0;
  private h = 0;

  onTap: (tap: SceneTap | null) => void = () => {};

  constructor(private config: AppConfig) {
    super();

    this.topLeft = text(12, theme.textDim, "600", "left");
    this.topMid = text(13, theme.textBright, "700", "center");
    this.topRight = text(12, theme.textDim, "600", "right");

    this.addChild(this.topLeft, this.topMid, this.topRight);

    this.eventMode = "static";
    this.on("pointertap", (e: FederatedPointerEvent) => {
      // A tap either hit a letter — which stops propagation — or it hit the
      // background, which the creator reads as "deselect".
      void e;
      this.onTap(null);
    });
  }

  /** Shown top-left: the round's name. */
  setTitle(title: string): void {
    this.title = (title || "Untitled").toUpperCase();
    this.topLeft.text = this.title;
  }

  /** The match. Called on every change, not every frame. */
  setState(view: MatchView): void {
    this.view = view;
    this.clocks = view.seats.map((s) => s.remainingMs);
    this.rebuildIfNeeded();
    this.apply();
  }

  /**
   * The clock readings for this frame. Separate from `setState` because a
   * live round's clock is computed from a shared anchor and so changes
   * continuously while nothing else does.
   */
  setClocks(ms: number[]): void {
    this.clocks = ms;
    ms.forEach((value, i) => this.roscos[i]?.setClock(value));
  }

  /**
   * Make one donut the big one. A contestant's screen focuses their own seat,
   * so their letters are readable across a studio and the opponent's are
   * still there to be glanced at.
   */
  setFocus(seat: number | null): void {
    if (seat === this.focus) return;
    this.focus = seat;
    this.layout();
  }

  /**
   * Ring one letter as "the one being edited". Independent of the letter on
   * the table, which the rules own: the creator is looking at a document, not
   * playing a round.
   */
  setSelection(seat: number | null, index: number | null): void {
    this.roscos.forEach((rosco, i) => {
      rosco.setSelected(i === seat ? index : null);
    });
  }

  /** Replace the top-right hint, e.g. to say the cues are muted. */
  setHint(text: string): void {
    this.hint = text;
    this.topRight.text = text;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.layout();
  }

  /** One frame. `deltaMS` comes from the pixi ticker. */
  update(deltaMS: number): void {
    for (const rosco of this.roscos) rosco.update(deltaMS);
  }

  /** Re-run layout after a config change. */
  refresh(): void {
    this.apply();
    this.layout();
  }

  // --- internals --------------------------------------------------------

  private rebuildIfNeeded(): void {
    const seats = this.view?.seats.length ?? 0;
    if (seats === this.roscos.length) return;

    for (const rosco of this.roscos) rosco.destroy({ children: true });
    this.roscos = Array.from({ length: seats }, (_, seat) => {
      const rosco = new Rosco();
      rosco.onPick = (index) => this.onTap({ seat, index });
      this.addChild(rosco);
      return rosco;
    });
    this.layout();
  }

  private apply(): void {
    const view = this.view;
    if (!view) return;

    const warnMs = this.config.game.warnAt * 1000;
    view.seats.forEach((seat, i) => {
      const rosco = this.roscos[i];
      if (!rosco) return;
      rosco.setSeat(seat, warnMs);
      rosco.setClock(this.clocks[i] ?? seat.remainingMs);
      // Once the round is over neither donut is "live": nothing is on the
      // table, so nothing should be pulsing for attention.
      rosco.setActive(!view.result && i === view.turn);
    });

    this.topMid.text = statusLine(view);
    // A strike showing is the one case where "running" is not reassuring.
    this.topMid.style.fill = view.result
      ? theme.accent
      : view.seats[view.turn]?.strikes
        ? theme.danger
        : view.running
          ? theme.textBright
          : theme.warn;

    this.questions = view.questions;

    // How many panels there are, and whether an answer line has to fit in
    // them, both change what the stage has to make room for.
    this.layout();
  }

  private layout(): void {
    if (this.w <= 0 || this.h <= 0) return;

    const pad = metrics.panelPad;
    const topH = clamp(this.h * 0.08, 28, 52);
    const shown = this.shownQuestions();
    // Half-width panels wrap their clue over more lines, so a row of them is
    // given a little more of the stage than a single one gets.
    const panelH =
      shown.length > 1
        ? clamp(this.h * 0.3, 110, 220)
        : clamp(this.h * 0.26, 96, 190);
    const midH = this.h - topH - panelH - pad;

    this.topLeft.position.set(pad, topH / 2);
    this.topMid.position.set(this.w / 2, topH / 2);
    this.topRight.position.set(this.w - pad, topH / 2);
    this.topRight.text = this.hint;
    setSize(this.topMid, clamp(this.h * 0.026, 12, 20));
    // Whose turn it is has to be readable at any width; the title and the
    // help hint are the two that give way when the bar gets crowded.
    this.topLeft.visible = this.w >= 860;
    this.topRight.visible = this.w >= 620;

    this.layoutRoscos(topH, midH, pad);
    this.layoutPanels(shown, this.h - panelH, panelH - pad, pad);
  }

  /**
   * The questions there is room to draw. Every one the view offers, except on
   * a stage too narrow to split — where the one being read out wins.
   */
  private shownQuestions(): QuestionView[] {
    if (this.questions.length <= 1 || this.w >= NARROW) return this.questions;
    const active = this.questions.filter((q) => q.active);
    return active.length ? active : this.questions.slice(0, 1);
  }

  private layoutRoscos(topH: number, midH: number, pad: number): void {
    const n = this.roscos.length;
    if (n === 0 || midH <= 0) return;

    // One weight per donut: equal on the host console, lopsided on a
    // contestant's screen where one of them is theirs.
    const weights = this.roscos.map((_, i) =>
      this.focus === null || i === this.focus ? 1 : UNFOCUSED,
    );
    const sum = weights.reduce((a, b) => a + b, 0);
    const biggest = Math.max(...weights);

    // Side by side or one above the other — whichever leaves room for the
    // bigger donut. A tall phone-shaped window wants them stacked; a laptop
    // wants them beside each other, and picking by aspect ratio guesses
    // wrong right around square.
    const beside = Math.min(
      (this.w - pad * (n + 1)) / sum,
      (midH - pad) / biggest,
    );
    const above = Math.min(
      (this.w - pad * 2) / biggest,
      (midH - pad * (n + 1)) / sum,
    );
    const stacked = above > beside;

    const unit =
      Math.max(40, stacked ? above : beside) *
      clamp(this.config.game.roscoSize, 0.3, 1);
    const diameters = weights.map((wt) => unit * wt);

    // The focused donut comes first, so a contestant reads their own board
    // before the opponent's.
    const order = this.roscos.map((_, i) => i);
    if (this.focus !== null) {
      order.sort((a, b) => Number(a !== this.focus) - Number(b !== this.focus));
    }

    const span =
      diameters.reduce((a, b) => a + b, 0) + pad * Math.max(0, n - 1);
    const axis = stacked ? midH : this.w;
    let cursor = (axis - span) / 2;

    for (const i of order) {
      const d = diameters[i];
      const along = cursor + d / 2;
      cursor += d + pad;
      if (stacked) this.roscos[i].position.set(this.w / 2, topH + along);
      else this.roscos[i].position.set(along, topH + midH / 2);
      this.roscos[i].resize(d);
    }
  }

  /**
   * The questions across the foot of the stage, side by side and equally
   * wide. Equal rather than weighted towards the active one because they
   * swap every time the table moves, and a panel that resizes as it lights
   * up is a panel the host has to re-find.
   */
  private layoutPanels(
    shown: QuestionView[],
    y: number,
    height: number,
    pad: number,
  ): void {
    while (this.panels.length > shown.length) {
      this.panels.pop()?.destroy({ children: true });
    }
    while (this.panels.length < shown.length) {
      const panel = new QuestionPanel();
      this.panels.push(panel);
      this.addChildAt(panel, 0);
    }

    const n = shown.length;
    if (n === 0) return;

    const width = (this.w - pad * 2 - pad * (n - 1)) / n;
    shown.forEach((question, i) => {
      const panel = this.panels[i];
      // A name over a lone panel only repeats what the donut under it says.
      panel.set(question, n > 1);
      panel.position.set(pad + i * (width + pad), y);
      panel.layout(width, height);
    });
  }
}

function statusLine(view: MatchView): string {
  if (view.result) return view.result.reason.toUpperCase();
  const seat = view.seats[view.turn];
  if (!seat) return "";

  const name = seat.player.toUpperCase();
  const clock = view.running ? "RUNNING" : "PAUSED";
  // Only once a strike is on the board: the host needs to know what the next
  // wrong answer costs, and nothing else.
  const strikes =
    seat.strikes > 0 ? ` · STRIKE ${seat.strikes} OF ${view.strikeLimit}` : "";
  return `${name} — ${clock}${strikes}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function text(
  size: number,
  fill: number,
  weight: "600" | "700",
  align: "left" | "center" | "right",
): Text {
  const t = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: fonts.ui,
      fontSize: size,
      fontWeight: weight,
      fill,
      align,
      letterSpacing: weight === "700" ? 0.8 : 0,
    }),
  });
  t.anchor.set(align === "left" ? 0 : align === "right" ? 1 : 0.5, 0.5);
  return t;
}

function setSize(t: Text, size: number): void {
  if (t.style.fontSize === size) return;
  t.style.fontSize = size;
}
