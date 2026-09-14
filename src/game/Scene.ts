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
import type { MatchView, QuestionRole, QuestionView } from "./view";

/** Which letter, on whose donut, a pointer landed on. */
export interface SceneTap {
  seat: number;
  index: number;
}

/** How much smaller the opponent's donut is on a contestant's own screen. */
const UNFOCUSED = 0.52;

/**
 * How much of their space the donuts give up to a row of panels across the
 * foot. Only the fallback layout needs it; a column already sizes its ring
 * against the questions underneath it.
 */
const CROWDED = 0.78;

/**
 * Narrower than this and a panel is two words a line. It is the threshold
 * for both layouts: a column thinner than this is not worth having, and a
 * row of panels drops the ones it cannot fit — the read-ahead first, then
 * the opponent's. The question in play is never dropped.
 */
const MIN_PANEL = 290;
const DROP_ORDER: QuestionRole[] = ["next", "opponent"];

/** Which edge of the stage a donut ended up against. "" when neither. */
type Side = "left" | "right" | "top" | "bottom" | "";

/**
 * How a screen points at a donut. Spelled out as well as arrowed because
 * "left" and "right" is how a studio talks about the two contestants, and an
 * arrow on its own means nothing the moment the stage stacks them instead.
 */
const SIDE_LABEL: Record<Side, string> = {
  left: "← LEFT",
  right: "RIGHT →",
  top: "↑ TOP",
  bottom: "BOTTOM ↓",
  "": "",
};

/**
 * The kicker over each panel.
 *
 * Exactly one CURRENT on the stage — the question being read out — and NEXT
 * on everything else, because everything else *is* that contestant's next
 * question: the read-ahead under the donut with the table, and the letter
 * the waiting contestant is sitting on under theirs. "Opponent" is a word
 * for whose column it is, and in a column layout the donut above the panel
 * has already said that.
 */
const ROLE_LABEL: Record<QuestionRole, string> = {
  current: "CURRENT",
  next: "NEXT",
  opponent: "NEXT",
  notice: "",
};

/**
 * Relative widths for the fallback row. Safe to weight because the row is
 * ordered by role rather than by seat, so the question in play is always the
 * first panel and giving it the extra room cannot make the row reflow every
 * time the table moves.
 */
const PANEL_WEIGHT: Record<QuestionRole, number> = {
  current: 1.35,
  next: 1,
  opponent: 1,
  notice: 1,
};

/** Where one panel ended up. Both layouts produce these; one loop draws them. */
interface Placement {
  question: QuestionView;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The playing surface: a column per contestant — their donut, and under it
 * the questions that are theirs.
 *
 * The column is the whole idea. A host has to know two things at a glance,
 * "what am I asking" and "whose is it", and a row of panels across the foot
 * of the stage answers the first and leaves the second to a label. Sitting
 * each question under the ring it belongs to answers both without reading
 * anything: the contestant with the table has two panels in their column —
 * the question being read out, and the one a right answer moves them on to —
 * and the other contestant has the one they are sitting on. Panels are the
 * same height whichever column they are in and the stacks are top-aligned,
 * so the two questions actually on the table sit on one line with the
 * read-ahead hanging below its own.
 *
 * A screen entitled to one question draws one panel, under the donut of
 * whoever has to answer it, which is what makes `/view` say who is up
 * without a word.
 *
 * A renderer and nothing else — the rules live in `match.ts`, the keys in
 * `controls.ts`, and what a given screen is allowed to see in `view.ts`. It
 * draws a `MatchView`, so the same class serves the host console reading a
 * local `Match` and a contestant screen reading a live room, with no idea
 * which it has.
 *
 *   setState(view)   structure, rulings, the questions — on every change
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

  /** One per panel placed: three on the host, one everywhere else. */
  private panels: QuestionPanel[] = [];
  private questions: QuestionView[] = [];

  private view: MatchView | null = null;
  private clocks: number[] = [];
  /** Per seat, filled in by the layout that decided where the donuts went. */
  private sides: Side[] = [];
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
   * Make one donut the big one, and its column the wide one. A contestant's
   * screen focuses their own seat, so their letters are readable across a
   * studio and the opponent's are still there to be glanced at.
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

    this.questions = view.questions;

    // How many panels there are, and whether an answer line has to fit in
    // them, both change what the stage has to make room for.
    this.layout();
  }

  private layout(): void {
    if (this.w <= 0 || this.h <= 0) return;

    const pad = metrics.panelPad;
    const topH = clamp(this.h * 0.08, 28, 52);

    this.topLeft.position.set(pad, topH / 2);
    this.topMid.position.set(this.w / 2, topH / 2);
    this.topRight.position.set(this.w - pad, topH / 2);
    this.topRight.text = this.hint;
    setSize(this.topMid, clamp(this.h * 0.026, 12, 20));
    // Whose turn it is has to be readable at any width; the title and the
    // help hint are the two that give way when the bar gets crowded.
    this.topLeft.visible = this.w >= 860;
    this.topRight.visible = this.w >= 620;

    const columned = this.columnsFit(this.questions);
    const placements = columned
      ? this.placeColumns(this.questions, topH, pad)
      : this.placeRow(this.shownQuestions(), topH, pad);

    this.drawPanels(placements, columned);
    // Reads which side of the stage each donut ended up on, so it waits for
    // whichever `place*` ran above to have put them there.
    this.writeStatus();
  }

  /** The middle of the top bar: who is up, which side they are, the clock. */
  private writeStatus(): void {
    const view = this.view;
    if (!view) return;

    this.topMid.text = statusLine(
      view,
      SIDE_LABEL[this.sides[view.turn] ?? ""],
    );
    // A strike showing is the one case where "running" is not reassuring.
    this.topMid.style.fill = view.result
      ? theme.accent
      : view.seats[view.turn]?.strikes
        ? theme.danger
        : view.running
          ? theme.textBright
          : theme.warn;
  }

  // --- the column layout ------------------------------------------------

  /**
   * Is there room to give every donut its own column?
   *
   * Two things rule it out. A round-wide notice — "ROUND OVER" — belongs to
   * no donut and so has nowhere to sit in a column; and a stage narrow
   * enough that a column would be thinner than a readable panel is not a
   * stage with two columns on it. Either way the panels go in a row across
   * the foot instead.
   */
  private columnsFit(questions: QuestionView[]): boolean {
    const n = this.roscos.length;
    if (n === 0 || questions.length === 0) return false;
    if (questions.some((q) => q.seat < 0 || q.seat >= n)) return false;

    const weights = this.columnWeights();
    const total = weights.reduce((a, b) => a + b, 0);
    const free = this.w - metrics.panelPad * (n + 1);
    return (free * Math.min(...weights)) / total >= MIN_PANEL;
  }

  /**
   * A column per donut: the ring above, its questions stacked below.
   *
   * Every panel is one slot tall whichever column it is in, and the stacks
   * are top-aligned rather than filling their column. That is what puts the
   * two questions actually on the table on the same line — the contestant
   * with the table has a second panel hanging under theirs, and the space
   * opposite it stays empty rather than inflating a question nobody has been
   * asked yet to twice the size of the one being read out.
   */
  private placeColumns(
    questions: QuestionView[],
    topH: number,
    pad: number,
  ): Placement[] {
    const n = this.roscos.length;

    const stacks: QuestionView[][] = this.roscos.map(() => []);
    for (const question of questions) stacks[question.seat].push(question);

    const rows = Math.max(1, ...stacks.map((stack) => stack.length));
    const slotH = clamp(this.h * 0.21, 96, 180);
    const bandH = rows * slotH + (rows - 1) * pad;
    const midH = Math.max(40, this.h - topH - bandH - pad * 2);
    const bandY = this.h - bandH - pad;

    const weights = this.columnWeights();
    const total = weights.reduce((a, b) => a + b, 0);
    const free = this.w - pad * (n + 1);

    // One unit for all the rings, from the widest column: the narrower of
    // that column and the room left above the questions, which is what keeps
    // a ring out of them at any window shape rather than at the ones we
    // thought to try. Sized off the widest and shared out by weight rather
    // than each ring filling its own column, or a screen whose height binds
    // would draw both donuts the same size and lose which one is focused.
    const biggest = Math.max(...weights);
    const widest = (free * biggest) / total;
    const unit =
      Math.max(40, Math.min(widest, midH)) *
      clamp(this.config.game.roscoSize, 0.3, 1);

    const placements: Placement[] = [];
    let x = pad;

    for (const seat of this.columnOrder()) {
      const w = (free * weights[seat]) / total;

      this.roscos[seat].position.set(x + w / 2, topH + midH / 2);
      this.roscos[seat].resize(unit * (weights[seat] / biggest));

      stacks[seat].forEach((question, row) => {
        placements.push({
          question,
          x,
          y: bandY + row * (slotH + pad),
          w,
          h: slotH,
        });
      });

      x += w + pad;
    }

    this.markSides(false);
    return placements;
  }

  // --- the fallback row -------------------------------------------------

  /**
   * The donuts sharing the middle, with the panels in one row across the
   * foot. For the two cases a column cannot take: a round-wide notice, which
   * is nobody's, and a stage too narrow to split into columns.
   */
  private placeRow(
    shown: QuestionView[],
    topH: number,
    pad: number,
  ): Placement[] {
    const panelH = panelBand(this.h, shown.length);
    const midH = this.h - topH - panelH - pad;
    this.layoutRoscos(topH, midH, pad, shown.length);

    const n = shown.length;
    if (n === 0) return [];

    const y = this.h - panelH;
    const height = panelH - pad;
    const weights = shown.map((question) => PANEL_WEIGHT[question.role]);
    const total = weights.reduce((a, b) => a + b, 0);
    const free = this.w - pad * (n + 1);

    const placements: Placement[] = [];
    let x = pad;
    shown.forEach((question, i) => {
      const w = (free * weights[i]) / total;
      placements.push({ question, x, y, w, h: height });
      x += w + pad;
    });
    return placements;
  }

  /**
   * The questions there is room for in one row, in the order the view
   * offered them. All of them on a wide stage; on a narrow one, as many as
   * will still be readable, given up in `DROP_ORDER` rather than by
   * position.
   */
  private shownQuestions(): QuestionView[] {
    const all = this.questions;
    if (all.length <= 1) return all;

    const pad = metrics.panelPad;
    const room = Math.max(1, Math.floor((this.w - pad) / (MIN_PANEL + pad)));
    if (room >= all.length) return all;

    const kept = new Set(all);
    for (const role of DROP_ORDER) {
      for (const question of all) {
        if (kept.size <= room) break;
        if (question.role === role) kept.delete(question);
      }
    }

    const shown = all.filter((question) => kept.has(question));
    return shown.length > room ? shown.slice(0, room) : shown;
  }

  private layoutRoscos(
    topH: number,
    midH: number,
    pad: number,
    panels: number,
  ): void {
    const n = this.roscos.length;
    if (n === 0 || midH <= 0) {
      this.markSides(false);
      return;
    }

    const weights = this.columnWeights();
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
      clamp(this.config.game.roscoSize, 0.3, 1) *
      (panels > 2 ? CROWDED : 1);
    const diameters = weights.map((wt) => unit * wt);

    const span =
      diameters.reduce((a, b) => a + b, 0) + pad * Math.max(0, n - 1);
    const axis = stacked ? midH : this.w;
    let cursor = (axis - span) / 2;

    for (const i of this.columnOrder()) {
      const d = diameters[i];
      const along = cursor + d / 2;
      cursor += d + pad;
      if (stacked) this.roscos[i].position.set(this.w / 2, topH + along);
      else this.roscos[i].position.set(along, topH + midH / 2);
      this.roscos[i].resize(d);
    }

    this.markSides(stacked);
  }

  // --- shared between the two layouts -----------------------------------

  /**
   * One weight per donut, and per column: equal on the host console,
   * lopsided on a contestant's screen where one of them is theirs.
   */
  private columnWeights(): number[] {
    return this.roscos.map((_, i) =>
      this.focus === null || i === this.focus ? 1 : UNFOCUSED,
    );
  }

  /**
   * Left to right. The focused donut comes first, so a contestant reads
   * their own board before the opponent's.
   */
  private columnOrder(): number[] {
    const order = this.roscos.map((_, i) => i);
    if (this.focus !== null) {
      order.sort((a, b) => Number(a !== this.focus) - Number(b !== this.focus));
    }
    return order;
  }

  /**
   * Which edge each donut ended up against. Read off the positions the
   * layout just chose rather than inferred from seat order: a contestant's
   * screen puts their own donut first, whichever seat that happens to be.
   */
  private markSides(stacked: boolean): void {
    this.sides = this.roscos.map(() => "" as Side);

    const ranked = this.roscos
      .map((rosco, seat) => ({ seat, at: stacked ? rosco.y : rosco.x }))
      .sort((a, b) => a.at - b.at);
    if (ranked.length < 2) return;

    this.sides[ranked[0].seat] = stacked ? "top" : "left";
    this.sides[ranked[ranked.length - 1].seat] = stacked ? "bottom" : "right";
  }

  /** Reconcile the panel objects and hand each one its box. */
  private drawPanels(placements: Placement[], columned: boolean): void {
    while (this.panels.length > placements.length) {
      this.panels.pop()?.destroy({ children: true });
    }
    while (this.panels.length < placements.length) {
      const panel = new QuestionPanel();
      this.panels.push(panel);
      this.addChildAt(panel, 0);
    }

    const single = placements.length === 1;
    placements.forEach(({ question, x, y, w, h }, i) => {
      const panel = this.panels[i];
      panel.set(question, this.headingOf(question, columned, single));
      panel.position.set(x, y);
      panel.layout(w, h);
    });
  }

  /**
   * The line over a panel: what it is for, whose it is, and — when the panel
   * is not already sitting under that donut — which donut to look at.
   *
   * A lone panel drops the role: there is nothing beside it to tell it apart
   * from. It keeps the side, though, whatever the layout, because a screen
   * showing one question is a screen whose entire job is "this one, and it
   * is theirs to answer".
   */
  private headingOf(
    question: QuestionView,
    columned: boolean,
    single: boolean,
  ): string {
    const role = single ? "" : ROLE_LABEL[question.role];
    const name = question.label.trim().toUpperCase();
    // In a column the ring above the panel has already pointed at itself. In
    // a row, only the panels that are not the read-ahead point — that one is
    // the same donut as the panel beside it.
    const pointing = single || (!columned && question.role !== "next");
    const side = pointing ? SIDE_LABEL[this.sides[question.seat] ?? ""] : "";

    return [role, name, side].filter(Boolean).join("  ·  ");
  }
}

/**
 * The height of the fallback row. More panels wrap their clues over more
 * lines each, so the row takes more of the stage as it grows — and the
 * donuts above it take correspondingly less.
 */
function panelBand(height: number, panels: number): number {
  if (panels <= 1) return clamp(height * 0.26, 96, 190);
  if (panels === 2) return clamp(height * 0.3, 110, 220);
  return clamp(height * 0.34, 120, 260);
}

function statusLine(view: MatchView, side: string): string {
  if (view.result) return view.result.reason.toUpperCase();
  const seat = view.seats[view.turn];
  if (!seat) return "";

  const clock = view.running ? "RUNNING" : "PAUSED";
  // Only once a strike is on the board: the host needs to know what the next
  // wrong answer costs, and nothing else.
  const strikes =
    seat.strikes > 0 ? ` · STRIKE ${seat.strikes} OF ${view.strikeLimit}` : "";
  // Side first, and not only for the host: this line is the biggest thing on
  // a projected board, so it is where "who has to answer" belongs.
  const who = [side, seat.player.toUpperCase()].filter(Boolean).join(" ");
  return `${who} — ${clock}${strikes}`;
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
