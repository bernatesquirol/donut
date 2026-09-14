import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import { fonts, metrics, theme } from "../theme";

export interface GuideRow {
  label: string;
  description: string;
}

/**
 * Full-screen shortcut card, and the gesture gate on the way in.
 *
 * One widget for both jobs on purpose. Browsers will not start audio without
 * a gesture, so a game with sound needs a gate anyway — and the most useful
 * thing to put in front of a host who has not run this before is the list of
 * keys they are about to need. Re-open it mid-round with the help key.
 */
export class KeyGuide extends Container {
  private bg = new Graphics();
  private titleText: Text;
  private subtitleText: Text;
  private keys: Text[] = [];
  private notes: Text[] = [];

  private w = 0;
  private h = 0;

  /** Tapped, or dismissed with a key. */
  onDismiss: () => void = () => {};

  constructor(private rows: GuideRow[]) {
    super();
    this.addChild(this.bg);

    this.titleText = label(32, theme.textBright, "700", "center");
    this.subtitleText = label(14, theme.textDim, "600", "center");
    this.addChild(this.titleText, this.subtitleText);

    for (const row of rows) {
      const key = label(13, theme.accent, "700", "right");
      key.text = row.label;
      const note = label(13, theme.textBright, "600", "left");
      note.text = row.description;
      this.keys.push(key);
      this.notes.push(note);
      this.addChild(key, note);
    }

    this.eventMode = "static";
    this.on("pointerdown", () => {
      if (this.visible) this.onDismiss();
    });
  }

  setHeader(title: string, subtitle: string): void {
    this.titleText.text = title;
    this.subtitleText.text = subtitle;
    this.layout();
  }

  get open(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.eventMode = "static";
  }

  hide(): void {
    this.visible = false;
    // Without this the invisible overlay keeps swallowing every pointer event
    // meant for the scene beneath it.
    this.eventMode = "none";
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.layout();
  }

  private layout(): void {
    if (this.w <= 0 || this.h <= 0) return;

    this.bg
      .clear()
      .rect(0, 0, this.w, this.h)
      .fill({ color: theme.bg, alpha: 0.95 });

    const n = Math.max(1, this.rows.length);
    const headerH = Math.max(this.h * 0.12, 56);
    // The list is the part that has to fit, and with this many keys on the
    // card it is the row height that gives way on a short window: a list
    // whose last few shortcuts are off the bottom of the screen is worse
    // than a tight one.
    const room = (this.h - headerH - metrics.panelPad * 2) / n;
    const rowH = clamp(Math.min(this.h * 0.055, room), 11, 26);
    const listH = n * rowH;

    const titleSize = clamp(this.h * 0.05, 18, 34);
    setSize(this.titleText, titleSize);
    setSize(this.subtitleText, clamp(this.h * 0.022, 11, 15));

    const top = Math.max(metrics.panelPad, (this.h - listH - headerH) / 2);
    this.titleText.position.set(this.w / 2, top + titleSize * 0.6);
    this.subtitleText.position.set(this.w / 2, top + titleSize * 1.5);

    // Keys right-aligned against the middle, descriptions left-aligned after
    // it: one vertical rule to read down instead of a ragged two columns.
    const gutter = clamp(this.w * 0.012, 8, 20);
    const centre = Math.min(this.w * 0.42, 260);
    const size = clamp(rowH * 0.56, 10, 15);
    let y = top + headerH;

    for (let i = 0; i < n; i++) {
      setSize(this.keys[i], size);
      setSize(this.notes[i], size);
      this.keys[i].position.set(centre - gutter, y);
      this.notes[i].position.set(centre + gutter, y);
      y += rowH;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function label(
  size: number,
  fill: number,
  weight: "600" | "700",
  align: "left" | "center" | "right",
): Text {
  const text = new Text({
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
  text.anchor.set(align === "left" ? 0 : align === "right" ? 1 : 0.5, 0.5);
  return text;
}

function setSize(text: Text, size: number): void {
  if (text.style.fontSize === size) return;
  text.style.fontSize = size;
}
