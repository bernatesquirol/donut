import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import { fonts, metrics, theme } from "../theme";
import type { QuestionView } from "./view";

/**
 * One question on the table: what it is for, how to word it, and — on the
 * host's screen only — what counts as right.
 *
 * The host console draws three of these. That is the point: the table moves
 * between two donuts on one clock, and a host who can only see the letter in
 * play has to find whatever comes next in a document while a clock runs. So
 * the read-ahead and the opponent's question get panels too, dimmed and
 * unringed, and the one being read out is the bright one.
 *
 * The heading is handed in already worded rather than built from `view.label`:
 * it carries which side of the stage the question's donut is on, and where
 * the donuts went is the scene's business, not this class's.
 *
 * Drawn from its own origin at the top-left, like `Rosco` is drawn from its
 * centre: the scene decides where the panels go and how wide each one is.
 */
export class QuestionPanel extends Container {
  private bg = new Graphics();
  private labelText: Text;
  private promptText: Text;
  private clueText: Text;
  private answerText: Text;

  private view: QuestionView | null = null;
  /**
   * Set when the words change. Fitting the clue costs a dozen text
   * measurements, and the scene calls `set` and then `layout` back to back,
   * so laying out twice for one change is worth not doing.
   */
  private dirty = true;

  private w = 0;
  private h = 0;

  constructor() {
    super();

    this.labelText = text(11, theme.textDim, "700");
    this.promptText = text(13, theme.accent, "700");
    this.clueText = text(22, theme.textBright, "600");
    this.answerText = text(15, theme.textDim, "600");

    this.addChild(this.bg);
    this.addChild(
      this.labelText,
      this.promptText,
      this.clueText,
      this.answerText,
    );
  }

  /**
   * What to say. Cheap enough to call on every match change.
   *
   * `heading` is the line over the clue — the role, the contestant and the
   * side of the stage their donut is on. "" leaves it off.
   */
  set(view: QuestionView, heading: string): void {
    this.view = view;

    this.labelText.text = heading;
    this.labelText.visible = heading.length > 0;
    this.labelText.style.fill = view.active ? theme.accent : theme.textDim;

    this.promptText.text = view.prompt;
    this.promptText.style.fill = view.active ? theme.accent : theme.textDim;

    // A notice stands in for the clue rather than sitting next to it: "no
    // clues written yet" is the answer to "what does it say", not an aside.
    this.clueText.text = view.clue || view.notice;
    this.clueText.style.fill = view.clue ? theme.textBright : theme.textDim;

    this.answerText.text = view.answer;
    this.answerText.visible = view.answer.length > 0;

    // A read-ahead panel recedes rather than disappearing. Reading ahead is
    // what it is for; being mistaken for the question in play is not.
    this.alpha = view.active ? 1 : 0.72;

    this.dirty = true;
    this.layout(this.w, this.h);
  }

  /**
   * Fill a box of this size, drawn from the panel's own origin.
   *
   * The panel is stacked rather than positioned: a name and a wording at the
   * top, the answer along the bottom, and the clue gets exactly what is left
   * between them. Only the clue is sized by measurement, because it is the
   * only one whose length nobody controls — a clue is a sentence someone
   * wrote, and two panels side by side halve the width it has to wrap in.
   * Proportional sizing alone put a three-line clue through both its
   * neighbours.
   */
  layout(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (!this.dirty && width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.dirty = false;

    const active = this.view?.active ?? true;
    const pad = metrics.panelPad;

    this.bg
      .clear()
      .roundRect(0, 0, width, height, metrics.radius)
      .fill({ color: theme.panelBg })
      .stroke({
        width: active ? 2 : 1,
        color: active ? theme.accent : theme.panelBorder,
        alignment: 0,
      });

    const inner = Math.max(40, width - pad * 2);
    const centre = width / 2;

    // The furniture: short, fixed, and sized off the box. Measured rather
    // than assumed to be one line, so a long contestant name that wraps
    // pushes the clue down instead of sitting on top of it.
    setSize(this.labelText, fit(height * 0.1, width * 0.035, 9, 14));
    setSize(this.promptText, fit(height * 0.11, width * 0.042, 10, 16));

    let head = pad * 0.5;
    if (this.labelText.visible) {
      const h = measure(this.labelText, inner).height;
      this.labelText.position.set(centre, head + h / 2);
      head += h;
    }
    const promptH = measure(this.promptText, inner).height;
    this.promptText.position.set(centre, head + promptH / 2);
    head += promptH + pad * 0.3;

    let foot = height - pad * 0.6;
    if (this.answerText.visible) {
      // The answer is the host's crib, not the headline: it takes a quarter
      // of the panel at most and shrinks inside it rather than pushing the
      // clue out of the box.
      const h = fitInto(
        this.answerText,
        inner,
        height * 0.26,
        10,
        fit(height * 0.14, width * 0.05, 12, 22),
      );
      this.answerText.position.set(centre, foot - h / 2);
      foot -= h + pad * 0.3;
    }

    // Whatever is left is the clue's, and the clue is fitted into it.
    const band = Math.max(14, foot - head);
    fitInto(
      this.clueText,
      inner,
      band,
      11,
      fit(height * 0.24, width * 0.08, 13, 34),
    );
    this.clueText.position.set(centre, head + band / 2);
  }
}

/** Height decides, width vetoes, and the result stays inside the bounds. */
function fit(
  byHeight: number,
  byWidth: number,
  lo: number,
  hi: number,
): number {
  return Math.max(lo, Math.min(hi, Math.min(byHeight, byWidth)));
}

/**
 * The biggest whole font size at which the text fits the box, applied.
 * Returns the height it ended up taking, which is what the caller has to
 * position around.
 *
 * A binary search over five or six sizes rather than a formula: how tall a
 * wrapped paragraph is depends on where the words happen to break, which no
 * ratio of the box predicts. `maxLineWidth` is checked as well as the height
 * because pixi does not break inside a word — one unbreakable long answer
 * would otherwise run out of both sides of the panel.
 */
function fitInto(
  t: Text,
  width: number,
  height: number,
  lo: number,
  hi: number,
): number {
  let low = Math.ceil(lo);
  let high = Math.max(low, Math.floor(hi));
  let best = low;
  let bestHeight = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    setSize(t, mid);
    const m = measure(t, width);
    if (m.height <= height && m.maxLineWidth <= width) {
      best = mid;
      bestHeight = m.height;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  setSize(t, best);
  // Nothing fit, so the smallest size is worn and it overflows a little —
  // still better than a clue the host cannot read at all.
  return bestHeight >= 0 ? bestHeight : measure(t, width).height;
}

/**
 * Wrapped size of what a `Text` currently says, without rendering it. Empty
 * text takes no room at all — pixi would measure it as a blank line.
 */
function measure(
  t: Text,
  wrapWidth: number,
): { height: number; maxLineWidth: number } {
  if (!t.text) return { height: 0, maxLineWidth: 0 };
  t.style.wordWrap = true;
  t.style.wordWrapWidth = wrapWidth;
  const m = CanvasTextMetrics.measureText(t.text, t.style, undefined, true);
  return { height: m.height, maxLineWidth: m.maxLineWidth };
}

function text(size: number, fill: number, weight: "600" | "700"): Text {
  const t = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: fonts.ui,
      fontSize: size,
      fontWeight: weight,
      fill,
      align: "center",
      letterSpacing: weight === "700" ? 0.8 : 0,
    }),
  });
  t.anchor.set(0.5, 0.5);
  return t;
}

function setSize(t: Text, size: number): void {
  if (t.style.fontSize === size) return;
  t.style.fontSize = size;
}
