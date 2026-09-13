import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { fonts, metrics, theme } from "../theme";
import type { QuestionView } from "./view";

/**
 * One question on the table: whose it is, how to word it, and — on the host's
 * screen only — what counts as right.
 *
 * The host console draws one of these per contestant. That is the point: the
 * table moves between two donuts on one clock, and a host who can only see
 * the letter in play has to find the waiting contestant's next clue in a
 * document while a clock runs. So the waiting seat gets a panel too, dimmed
 * and unringed, and the one being read out is the bright one.
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

  /** What to say. Cheap enough to call on every match change. */
  set(view: QuestionView, showLabel: boolean): void {
    this.view = view;

    this.labelText.text = view.label.toUpperCase();
    this.labelText.visible = showLabel && view.label.length > 0;
    this.labelText.style.fill = view.active ? theme.accent : theme.textDim;

    this.promptText.text = view.prompt;
    this.promptText.style.fill = view.active ? theme.accent : theme.textDim;

    // A notice stands in for the clue rather than sitting next to it: "no
    // clues written yet" is the answer to "what does it say", not an aside.
    this.clueText.text = view.clue || view.notice;
    this.clueText.style.fill = view.clue ? theme.textBright : theme.textDim;

    this.answerText.text = view.answer;
    this.answerText.visible = view.answer.length > 0;

    // The waiting seat recedes rather than disappearing. Reading ahead is
    // what it is for; being mistaken for the question in play is not.
    this.alpha = view.active ? 1 : 0.72;

    this.layout(this.w, this.h);
  }

  /** Fill a box of this size, drawn from the panel's own origin. */
  layout(width: number, height: number): void {
    this.w = width;
    this.h = height;
    if (width <= 0 || height <= 0) return;

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
    const label = this.labelText.visible;

    // Sized by height as before, but capped by width too: two panels side by
    // side are each half as wide, and a clue set at the full-width size wraps
    // to four lines and falls out of the box.
    setSize(this.labelText, fit(height * 0.1, width * 0.035, 9, 14));
    setSize(this.promptText, fit(height * 0.11, width * 0.042, 10, 16));
    setSize(this.clueText, fit(height * 0.19, width * 0.062, 13, 30));
    setSize(this.answerText, fit(height * 0.14, width * 0.05, 12, 22));

    for (const t of [this.clueText, this.answerText]) {
      t.style.wordWrap = true;
      t.style.wordWrapWidth = inner;
    }

    const mid = height / 2;
    const centre = width / 2;

    this.labelText.position.set(centre, pad * 0.55);
    this.promptText.position.set(centre, pad * (label ? 1.5 : 0.9));
    // The clue is the thing being read aloud, so it keeps the middle and the
    // answer hangs off the bottom rather than the two sharing the space.
    this.clueText.position.set(
      centre,
      (this.answerText.visible ? mid + 2 : mid + 8) + (label ? pad * 0.3 : 0),
    );
    this.answerText.position.set(
      centre,
      height - pad * 0.9 - this.answerText.height * 0.5,
    );
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
