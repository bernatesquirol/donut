import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import { fonts, theme } from "../theme";

/**
 * Full-screen tap gate.
 *
 * Kept even though a blank game has nothing to unlock: browsers refuse to
 * start audio, fullscreen or pointer lock without a gesture, so nearly every
 * game needs one gesture before it can really begin. `onTap` is where that
 * work goes.
 */
export class Overlay extends Container {
  private bg = new Graphics();
  private titleText: Text;
  private subtitleText: Text;

  private w = 0;
  private h = 0;

  /** Invoked when the user taps while the gate is showing. */
  onTap: () => void = () => {};

  constructor(title: string, subtitle: string) {
    super();
    this.addChild(this.bg);

    this.titleText = new Text({
      text: title,
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 34,
        fontWeight: "700",
        fill: theme.textBright,
        align: "center",
      }),
    });
    this.subtitleText = new Text({
      text: subtitle,
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 15,
        letterSpacing: 1.2,
        fill: theme.textDim,
        align: "center",
      }),
    });
    this.titleText.anchor.set(0.5);
    this.subtitleText.anchor.set(0.5);
    this.addChild(this.titleText, this.subtitleText);

    this.eventMode = "static";
    this.on("pointerdown", () => {
      if (this.visible) this.onTap();
    });
  }

  setText(title: string, subtitle: string): void {
    this.titleText.text = title;
    this.subtitleText.text = subtitle;
    this.layout();
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
    if (this.w <= 0) return;
    this.bg
      .clear()
      .rect(0, 0, this.w, this.h)
      .fill({ color: theme.bg, alpha: 0.93 });
    this.titleText.position.set(this.w / 2, this.h / 2 - 18);
    this.subtitleText.position.set(this.w / 2, this.h / 2 + 26);
  }
}
