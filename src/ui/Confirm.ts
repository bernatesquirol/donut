import {
  CanvasTextMetrics,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import { fonts, metrics, theme } from "../theme";

/**
 * The only keys that mean yes, compared case-insensitively. Everything else
 * — `N`, Escape, and any other key — means no.
 *
 * Note what is not in here: Enter. That is the whole reason this is spelled
 * out rather than being "the obvious one". Enter is `markCorrect`, the key a
 * host presses more than all the others put together, and a dialog that read
 * it as yes would be a dialog that throws the round away the first time
 * someone mis-keys `R` and carries on ruling.
 */
const YES = ["y"];

export interface ConfirmRequest {
  title: string;
  /** What it will cost. Wrapped, so it can be a sentence. */
  detail: string;
  /** Wording on the destructive button, e.g. "RESTART". */
  confirm: string;
  /** Wording on the safe one, e.g. "KEEP PLAYING". */
  cancel: string;
}

/**
 * A yes/no card over the stage, for the actions a round does not survive.
 *
 * The host's keyboard is built for speed — every ruling is one key and none
 * of them asks twice, because a clock is running while they are pressed.
 * That is right for the rulings, all of which `undo` covers, and wrong for
 * `reset`, which empties the undo history along with everything else. So
 * exactly one key goes through here.
 *
 * Cancelling is the default in every direction: `N`, Escape, a tap outside
 * the card, or any key that is not `Y`. Only the two deliberate gestures —
 * `Y`, or a tap on the button that says what will happen — go through.
 *
 * The caller keeps the policy. This asks and reports; stopping the clock
 * first, and doing the thing afterwards, belong to whoever knew it was worth
 * asking about.
 */
export class Confirm extends Container {
  private backdrop = new Graphics();
  private card = new Graphics();
  private titleText: Text;
  private detailText: Text;
  private yes: Choice;
  private no: Choice;

  /** Non-null exactly while the card is up. Called once, then cleared. */
  private settle: ((ok: boolean) => void) | null = null;

  private w = 0;
  private h = 0;

  constructor() {
    super();

    this.titleText = label(24, theme.textBright, "700");
    this.detailText = label(13, theme.textDim, "600");
    this.yes = new Choice(theme.danger, () => this.answer(true));
    this.no = new Choice(theme.textDim, () => this.answer(false));

    this.addChild(this.backdrop, this.card);
    this.addChild(this.titleText, this.detailText, this.no, this.yes);

    // A tap that missed the card is a tap that missed the button that says
    // what will happen, so it means no.
    this.backdrop.eventMode = "static";
    this.backdrop.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.answer(false);
    });

    this.hide();
  }

  get open(): boolean {
    return this.settle !== null;
  }

  /**
   * Put the question up. `settle` is called exactly once, with the answer —
   * including when the card is dismissed rather than answered, and including
   * when a second `ask` replaces this one.
   */
  ask(request: ConfirmRequest, settle: (ok: boolean) => void): void {
    // Nothing should be able to leave an earlier caller waiting forever.
    this.answer(false);

    this.settle = settle;
    this.titleText.text = request.title;
    this.detailText.text = request.detail;
    this.yes.set(`Y   ${request.confirm.toUpperCase()}`);
    this.no.set(`N   ${request.cancel.toUpperCase()}`);

    this.visible = true;
    this.eventMode = "static";
    this.layout();
  }

  /**
   * Offer a key to the card. Every key is consumed while it is up — the
   * caller has already decided the keyboard belongs here — and every key
   * that is not `Y` means no.
   */
  handleKey(key: string): void {
    if (!this.open) return;
    this.answer(YES.includes(key.toLowerCase()));
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.backdrop.hitArea = new Rectangle(0, 0, width, height);
    this.layout();
  }

  private answer(ok: boolean): void {
    const settle = this.settle;
    if (!settle) return;
    // Cleared before the callback: it may well ask something else.
    this.settle = null;
    this.hide();
    settle(ok);
  }

  private hide(): void {
    this.visible = false;
    // Without this the invisible overlay keeps swallowing every pointer
    // event meant for the scene beneath it.
    this.eventMode = "none";
  }

  private layout(): void {
    if (!this.visible || this.w <= 0 || this.h <= 0) return;

    this.backdrop
      .clear()
      .rect(0, 0, this.w, this.h)
      .fill({ color: theme.bg, alpha: 0.9 });

    const pad = metrics.panelPad;
    const cardW = clamp(this.w * 0.6, 260, 560);
    const inner = Math.max(80, cardW - pad * 2);
    const gap = pad * 0.6;

    setSize(this.titleText, clamp(this.h * 0.038, 16, 26));
    setSize(this.detailText, clamp(this.h * 0.022, 11, 15));
    const titleH = measure(this.titleText, inner);
    const detailH = measure(this.detailText, inner);
    const buttonH = clamp(this.h * 0.062, 34, 48);

    // Measured rather than proportioned: how tall the detail wraps to
    // depends on where its words happen to break, and a card sized by ratio
    // either clips the sentence or floats the buttons miles below it.
    const cardH = pad * 3 + titleH + gap + detailH + pad + buttonH;
    const x = (this.w - cardW) / 2;
    const y = (this.h - cardH) / 2;

    this.card
      .clear()
      .roundRect(x, y, cardW, cardH, metrics.radius + 4)
      .fill({ color: theme.panelBg })
      .stroke({ width: 1.5, color: theme.panelBorder, alignment: 0 });

    const centre = x + cardW / 2;
    let cursor = y + pad * 1.5;
    this.titleText.position.set(centre, cursor + titleH / 2);
    cursor += titleH + gap;
    this.detailText.position.set(centre, cursor + detailH / 2);
    cursor += detailH + pad;

    // Safe on the left, destructive on the right: the same order as the two
    // keys under them on the card, and the same order as everywhere else a
    // dialog asks this.
    const buttonW = (inner - gap) / 2;
    this.no.position.set(x + pad, cursor);
    this.no.layout(buttonW, buttonH);
    this.yes.position.set(x + pad + buttonW + gap, cursor);
    this.yes.layout(buttonW, buttonH);
  }
}

/** One of the two answers, as a button you can also tap. */
class Choice extends Container {
  private bg = new Graphics();
  private caption: Text;

  constructor(
    private tone: number,
    onPick: () => void,
  ) {
    super();
    this.caption = label(13, tone, "700");
    this.addChild(this.bg, this.caption);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointertap", (e: FederatedPointerEvent) => {
      // Or the backdrop underneath would read the same tap as "no".
      e.stopPropagation();
      onPick();
    });
  }

  set(text: string): void {
    this.caption.text = text;
  }

  layout(width: number, height: number): void {
    this.hitArea = new Rectangle(0, 0, width, height);
    this.bg
      .clear()
      .roundRect(0, 0, width, height, metrics.radius - 2)
      .fill({ color: theme.trackBg })
      .stroke({ width: 1.5, color: this.tone, alignment: 0 });

    setSize(this.caption, clamp(height * 0.34, 11, 15));
    this.caption.position.set(width / 2, height / 2);
  }
}

/** Wrapped height of what a `Text` currently says, without rendering it. */
function measure(t: Text, wrapWidth: number): number {
  if (!t.text) return 0;
  t.style.wordWrap = true;
  t.style.wordWrapWidth = wrapWidth;
  return CanvasTextMetrics.measureText(t.text, t.style, undefined, true).height;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function label(size: number, fill: number, weight: "600" | "700"): Text {
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
