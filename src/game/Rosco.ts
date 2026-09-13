import {
  Circle,
  Container,
  FederatedPointerEvent,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import { fonts, theme } from "../theme";
import type { Ruling } from "./match";
import type { LetterView, SeatView } from "./view";

/**
 * One contestant's donut: their alphabet in a ring, their clock in the hole.
 *
 * Everything a host has to read at a glance lives here — whose turn it is,
 * which letter is on the table, how each letter was ruled, and how much clock
 * is left. The ring of remaining time is drawn just inside the letters because
 * a bar somewhere else on screen is a second thing to look at, and there is no
 * time to look twice.
 *
 * Sized by `resize(diameter)`; it draws itself centred on its own origin and
 * knows nothing about the stage.
 *
 * Two inputs, and the split matters: `setSeat` is structure and arrives when
 * something happens, `setClock` is a number and arrives every frame. A live
 * round runs the clock off a shared anchor, so its reading changes constantly
 * while nothing else does.
 */
export class Rosco extends Container {
  private timeRing = new Graphics();
  private discs = new Container();
  private letters: LetterDisc[] = [];

  private nameText: Text;
  private clockText: Text;
  private scoreText: Text;

  private seat: SeatView | null = null;
  private remainingMs = 0;
  private isActive = false;
  private diameter = 0;
  /** Seconds of accumulated time, for the active letter's pulse. */
  private elapsed = 0;
  /** Last clock string pushed into the Text, to avoid re-rasterising it. */
  private shownClock = "";
  private warnAtMs = 15000;

  /** A letter was clicked. The creator uses this to select one for editing. */
  onPick: (index: number) => void = () => {};

  constructor() {
    super();

    this.nameText = label(13, theme.textDim, "700");
    this.clockText = label(44, theme.textBright, "700");
    this.scoreText = label(13, theme.textDim, "600");

    this.addChild(this.timeRing, this.discs);
    this.addChild(this.nameText, this.clockText, this.scoreText);
  }

  /**
   * Point at a contestant. Discs are reconciled by position rather than
   * rebuilt, so a re-render costs nothing when only a ruling changed.
   */
  setSeat(seat: SeatView, warnAtMs: number): void {
    const rebuild = seat.letters.length !== this.letters.length;
    this.seat = seat;
    this.warnAtMs = warnAtMs;
    this.remainingMs = seat.remainingMs;

    if (rebuild) {
      for (const disc of this.letters) disc.destroy({ children: true });
      this.letters = seat.letters.map((letter, index) => {
        const disc = new LetterDisc(letter, () => this.onPick(index));
        this.discs.addChild(disc);
        return disc;
      });
      this.layout();
    } else {
      seat.letters.forEach((letter, i) => this.letters[i].setLetter(letter));
    }

    this.render();
  }

  /** The clock reading for this frame. Cheap by design. */
  setClock(remainingMs: number): void {
    this.remainingMs = remainingMs;
  }

  /** Which letter the creator has open in its form, if any. */
  setSelected(index: number | null): void {
    this.letters.forEach((disc, i) => disc.setSelected(i === index));
  }

  setActive(active: boolean): void {
    if (active === this.isActive) return;
    this.isActive = active;
    this.render();
  }

  resize(diameter: number): void {
    if (diameter === this.diameter) return;
    this.diameter = diameter;
    this.layout();
    this.render();
  }

  /** One frame: the clock readout and the pulse under the active letter. */
  update(deltaMS: number): void {
    this.elapsed += deltaMS / 1000;
    const seat = this.seat;
    if (!seat) return;

    // A half-second sine, only on the active donut: a pulse on both would be
    // two things blinking and no signal.
    const pulse = this.isActive
      ? 0.5 + 0.5 * Math.sin(this.elapsed * Math.PI * 2)
      : 0;
    if (seat.index >= 0) this.letters[seat.index]?.setPulse(pulse);

    this.drawClock();
  }

  // --- drawing ----------------------------------------------------------

  private get radius(): number {
    return this.diameter / 2;
  }

  /** Radius of the circle the letter discs sit on. */
  private get ringRadius(): number {
    return this.radius - this.discRadius - 1;
  }

  /**
   * Disc radius: whichever is smaller of "the ring is full" and a cap, so a
   * short alphabet gets big letters but not comically big ones.
   */
  private get discRadius(): number {
    const n = Math.max(1, this.letters.length);
    const packed = this.radius * Math.sin(Math.PI / n) * 0.88;
    return Math.max(4, Math.min(packed, this.radius * 0.15));
  }

  private layout(): void {
    if (this.diameter <= 0) return;

    const r = this.ringRadius;
    const size = this.discRadius;
    const n = Math.max(1, this.letters.length);

    this.letters.forEach((disc, i) => {
      // Clockwise from the top, so A is where a reader expects it.
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      disc.place(Math.cos(angle) * r, Math.sin(angle) * r, size);
    });

    const d = this.diameter;
    setSize(this.nameText, Math.max(10, d * 0.052));
    setSize(this.clockText, Math.max(18, d * 0.17));
    setSize(this.scoreText, Math.max(10, d * 0.05));

    this.nameText.position.set(0, -d * 0.145);
    this.clockText.position.set(0, -d * 0.01);
    this.scoreText.position.set(0, d * 0.125);

    // The clock string is unchanged but its font size is not.
    this.shownClock = "";
  }

  /** Everything that only changes when the match does. */
  private render(): void {
    const seat = this.seat;
    if (!seat || this.diameter <= 0) return;

    this.nameText.text = seat.player.toUpperCase();
    this.nameText.style.fill = this.isActive ? theme.accent : theme.textDim;

    const total = seat.letters.filter((l) => l.inPlay).length;
    const left = total - seat.correct - seat.wrong;
    this.scoreText.text = `${seat.correct} right · ${seat.wrong} wrong · ${left} left`;

    this.letters.forEach((disc, i) => {
      disc.setRuling(seat.letters[i].ruling, i === seat.index, this.isActive);
      if (i !== seat.index) disc.setPulse(0);
    });

    // Redrawn here as well as per-frame so a paused donut is never blank.
    this.drawClock();
  }

  private drawClock(): void {
    const seat = this.seat;
    if (!seat || this.diameter <= 0) return;

    const ms = this.remainingMs;
    const text = clockLabel(ms);
    const urgent = ms <= this.warnAtMs && ms > 0;

    if (text !== this.shownClock) {
      this.shownClock = text;
      this.clockText.text = text;
    }
    this.clockText.style.fill = seat.done
      ? theme.textDim
      : urgent
        ? theme.danger
        : this.isActive
          ? theme.textBright
          : theme.textDim;

    const fraction = Math.max(0, Math.min(1, ms / Math.max(1, seat.limitMs)));
    const r = this.ringRadius - this.discRadius - this.diameter * 0.022;
    const width = Math.max(2, this.diameter * 0.014);

    const g = this.timeRing.clear();
    if (r <= width) return;

    g.circle(0, 0, r).stroke({ width, color: theme.trackBorder, alpha: 0.7 });
    if (fraction <= 0) return;

    // Drains clockwise from the top, mirroring the way the letters run. The
    // moveTo is load-bearing: `arc` joins the path's current point to the
    // start of the sweep, which otherwise draws a spoke out of the middle.
    const from = -Math.PI / 2;
    g.moveTo(Math.cos(from) * r, Math.sin(from) * r);
    g.arc(0, 0, r, from, from + fraction * Math.PI * 2).stroke({
      width,
      color: urgent
        ? theme.danger
        : this.isActive
          ? theme.accent
          : theme.textDim,
      cap: "round",
      alpha: this.isActive || urgent ? 1 : 0.5,
    });
  }
}

/** One letter of the alphabet, as a disc on the ring. */
class LetterDisc extends Container {
  private bg = new Graphics();
  /** Not `label`: pixi's Container already declares that as a string. */
  private caption: Text;

  private view: LetterView;
  private onTable = false;
  private hot = false;
  private selected = false;
  private pulse = 0;
  private size = 0;

  constructor(view: LetterView, onPick: () => void) {
    super();
    this.view = view;
    this.caption = label(12, theme.textBright, "700");
    this.caption.text = view.letter;
    this.addChild(this.bg, this.caption);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      onPick();
    });
  }

  setLetter(view: LetterView): void {
    const same =
      view.letter === this.view.letter && view.inPlay === this.view.inPlay;
    this.view = view;
    if (same) return;
    this.caption.text = view.letter;
    this.redraw();
  }

  setSelected(selected: boolean): void {
    if (selected === this.selected) return;
    this.selected = selected;
    this.redraw();
  }

  setRuling(ruling: Ruling, onTable: boolean, hot: boolean): void {
    if (
      ruling === this.view.ruling &&
      onTable === this.onTable &&
      hot === this.hot
    ) {
      return;
    }
    this.view = { ...this.view, ruling };
    this.onTable = onTable;
    this.hot = hot;
    this.redraw();
  }

  setPulse(pulse: number): void {
    // Only the disc on the table animates, and only while its donut is live.
    if (!this.onTable || !this.hot) {
      if (this.pulse === 0) return;
      this.pulse = 0;
      this.redraw();
      return;
    }
    // Quantised: a redraw per frame per letter is a lot of Graphics churn for
    // a glow nobody can see moving in 1/16th steps.
    const stepped = Math.round(pulse * 16) / 16;
    if (stepped === this.pulse) return;
    this.pulse = stepped;
    this.redraw();
  }

  place(x: number, y: number, size: number): void {
    this.position.set(x, y);
    this.size = size;
    this.hitArea = new Circle(0, 0, size);
    setSize(this.caption, Math.max(8, size * 1.15));
    this.redraw();
  }

  private redraw(): void {
    const s = this.size;
    if (s <= 0) return;

    const paint = this.view.inPlay ? PAINT[this.view.ruling] : BLANK;

    // The letter on the table is drawn bigger and ringed, so it reads before
    // the colours do — the host is looking for "where am I", not "how did
    // that go".
    const scale = this.onTable ? 1.3 : 1;
    const radius = s * scale;
    const dim = this.hot ? 1 : 0.55;

    const g = this.bg.clear();
    g.circle(0, 0, radius).fill({ color: paint.fill, alpha: dim });
    g.circle(0, 0, radius).stroke({
      width: this.onTable ? Math.max(2, s * 0.16) : Math.max(1, s * 0.09),
      color: this.onTable ? theme.spot : paint.border,
      alpha: this.onTable ? 0.35 + 0.65 * dim : dim,
    });

    // Drawn outside the disc so it survives the on-table ring sitting on it.
    if (this.selected) {
      g.circle(0, 0, radius + s * 0.3).stroke({
        width: Math.max(1, s * 0.11),
        color: theme.accent,
        alpha: 0.9,
      });
    }

    if (this.onTable && this.pulse > 0) {
      g.circle(0, 0, radius + s * (0.18 + 0.3 * this.pulse)).stroke({
        width: Math.max(1, s * 0.1),
        color: theme.spot,
        alpha: 0.42 * (1 - this.pulse),
      });
    }

    this.caption.style.fill = paint.text;
    this.caption.alpha = this.onTable ? 1 : dim;
    this.caption.scale.set(scale);
  }
}

interface Paint {
  fill: number;
  border: number;
  text: number;
}

/** One colour per ruling. Passed is amber because it is not a mistake yet. */
const PAINT: Record<Ruling, Paint> = {
  open: {
    fill: theme.trackBg,
    border: theme.trackBorder,
    text: theme.textBright,
  },
  correct: { fill: 0x11463d, border: theme.accent, text: theme.accent },
  wrong: { fill: 0x4a1526, border: theme.danger, text: theme.danger },
  passed: { fill: 0x40320f, border: theme.warn, text: theme.warn },
};

/** A letter with no clue written: present, but not in play. */
const BLANK: Paint = {
  fill: theme.bg,
  border: theme.panelBorder,
  text: 0x39404e,
};

/** m:ss, or s.t under ten seconds where tenths start to matter. */
export function clockLabel(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 10) return total.toFixed(1);
  const mins = Math.floor(total / 60);
  const secs = Math.ceil(total % 60);
  // Ceil can roll 59.6 up to 60; carry it rather than printing "1:60".
  return secs === 60
    ? `${mins + 1}:00`
    : `${mins}:${secs.toString().padStart(2, "0")}`;
}

function label(size: number, fill: number, weight: "600" | "700"): Text {
  const text = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: fonts.ui,
      fontSize: size,
      fontWeight: weight,
      fill,
      align: "center",
    }),
  });
  text.anchor.set(0.5);
  return text;
}

function setSize(text: Text, size: number): void {
  if (text.style.fontSize === size) return;
  text.style.fontSize = size;
}
