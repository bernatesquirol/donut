import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import type { AppConfig } from "../config";
import type { DocItem, GameDoc } from "../doc/types";
import { fonts, metrics, theme } from "../theme";

/**
 * The playing surface: this is the file a real game replaces.
 *
 * It exists to define the contract the rest of the starter is built around,
 * and the contract is deliberately small:
 *
 *   setDoc()  the authored document is the only input
 *   resize()  the host owns the size; the scene never reads the window
 *   update()  one tick, given a delta in ms
 *   onTap     pointer events out, in document coordinates
 *
 * Everything downstream — the route at `/`, the creator's live preview, the
 * published view — drives it through exactly those four, so a scene rewrite
 * needs no changes anywhere else.
 *
 * What it draws is placeholder: each document item as a labelled tile at its
 * normalised position, bobbing so it is obvious the ticker is live, flashing
 * on tap so it is obvious hit-testing works.
 */
export class Scene extends Container {
  private frame = new Graphics();
  private layer = new Container();
  private hint: Text;

  private tiles = new Map<string, Tile>();
  private doc: GameDoc | null = null;

  private w = 0;
  private h = 0;
  private elapsed = 0;

  /**
   * A tap on the scene. `item` is null when it landed on empty space; `x` and
   * `y` are 0..1 document coordinates, ready to write straight back into a
   * document.
   */
  onTap: (x: number, y: number, item: DocItem | null) => void = () => {};

  constructor(private config: AppConfig) {
    super();
    this.addChild(this.frame, this.layer);

    this.hint = new Text({
      text: "No items yet — add some in the creator",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 14,
        fill: theme.textDim,
        align: "center",
      }),
    });
    this.hint.anchor.set(0.5);
    this.addChild(this.hint);

    this.eventMode = "static";
    this.on("pointertap", (e: FederatedPointerEvent) => {
      const p = e.getLocalPosition(this);
      this.onTap(
        this.w > 0 ? p.x / this.w : 0.5,
        this.h > 0 ? p.y / this.h : 0.5,
        null,
      );
    });
  }

  /**
   * Swap in a document. Tiles are reconciled by item id rather than rebuilt,
   * so the creator's live preview does not restart every animation on each
   * keystroke.
   */
  setDoc(doc: GameDoc): void {
    this.doc = doc;
    const seen = new Set<string>();

    for (const item of doc.items) {
      seen.add(item.id);
      const existing = this.tiles.get(item.id);
      if (existing) {
        existing.setItem(item);
        continue;
      }
      const tile = new Tile(item, (tapped) => {
        // Stop the scene's own background handler from also firing: a tap is
        // either on an item or on empty space, never both.
        this.onTap(tapped.x, tapped.y, tapped);
      });
      this.tiles.set(item.id, tile);
      this.layer.addChild(tile);
    }

    for (const [id, tile] of this.tiles) {
      if (seen.has(id)) continue;
      tile.destroy({ children: true });
      this.tiles.delete(id);
    }

    this.hint.visible = doc.items.length === 0;
    this.layout();
  }

  /** Highlight one item, or none. Used by the creator to show the selection. */
  setHighlight(itemId: string | null): void {
    for (const [id, tile] of this.tiles) tile.setHighlight(id === itemId);
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.layout();
  }

  /** One frame. `deltaMS` comes from the pixi ticker. */
  update(deltaMS: number): void {
    this.elapsed += deltaMS / 1000;
    const { bob, bobPeriod } = this.config.game;
    let i = 0;
    for (const tile of this.tiles.values()) {
      // A per-tile phase offset, so they do not all rise and fall together.
      const phase = (this.elapsed / bobPeriod + i * 0.17) * Math.PI * 2;
      tile.setBob(Math.sin(phase) * bob);
      tile.tick(deltaMS);
      i++;
    }
  }

  private layout(): void {
    if (this.w <= 0 || this.h <= 0) return;

    this.frame
      .clear()
      .roundRect(1, 1, this.w - 2, this.h - 2, metrics.radius)
      .fill({ color: theme.bg })
      .stroke({ width: 1, color: theme.panelBorder, alignment: 1 });

    this.hint.position.set(this.w / 2, this.h / 2);

    const size = Math.round(
      Math.min(this.w, this.h) * this.config.game.itemSize,
    );
    for (const item of this.doc?.items ?? []) {
      this.tiles.get(item.id)?.place(item.x * this.w, item.y * this.h, size, {
        debugHitArea: this.config.game.debugHitArea,
      });
    }
  }
}

/** One document item on the stage. */
class Tile extends Container {
  private bg = new Graphics();
  /** Not `label`: pixi's Container already declares that as a string. */
  private caption: Text;
  private item: DocItem;

  private size = 0;
  private baseY = 0;
  /** Seconds left on the tap flash. */
  private flash = 0;
  private highlighted = false;
  private debugHitArea = false;

  constructor(item: DocItem, onTap: (item: DocItem) => void) {
    super();
    this.item = item;
    this.addChild(this.bg);

    this.caption = new Text({
      text: item.label,
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 14,
        fontWeight: "600",
        fill: theme.textBright,
      }),
    });
    this.caption.anchor.set(0.5);
    this.addChild(this.caption);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.flash = 0.35;
      this.redraw();
      onTap(this.item);
    });
  }

  setItem(item: DocItem): void {
    this.item = item;
    this.caption.text = item.label;
    this.redraw();
  }

  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.redraw();
  }

  place(
    x: number,
    y: number,
    size: number,
    opts: { debugHitArea: boolean },
  ): void {
    this.size = size;
    this.baseY = y;
    this.position.set(x, y);
    this.debugHitArea = opts.debugHitArea;
    this.hitArea = new Rectangle(-size / 2, -size / 2, size, size);
    this.redraw();
  }

  setBob(offset: number): void {
    this.position.y = this.baseY + offset;
  }

  tick(deltaMS: number): void {
    if (this.flash <= 0) return;
    this.flash = Math.max(0, this.flash - deltaMS / 1000);
    this.redraw();
  }

  private redraw(): void {
    const s = this.size;
    if (s <= 0) return;

    // Hue from the document, lightness from the interaction state: one colour
    // ramp covers idle, selected and just-tapped without three palettes.
    const lightness = 0.3 + this.flash * 0.9 + (this.highlighted ? 0.12 : 0);
    const fill = hsl(this.item.hue, 0.5, Math.min(0.92, lightness));
    const border = this.highlighted
      ? theme.accent
      : hsl(this.item.hue, 0.6, 0.62);

    const g = this.bg.clear();
    g.roundRect(-s / 2, -s / 2, s, s, metrics.radius)
      .fill({ color: fill })
      .stroke({
        width: this.highlighted ? 2 : 1,
        color: border,
        alignment: 0,
      });

    if (this.debugHitArea) {
      g.rect(-s / 2, -s / 2, s, s).stroke({
        width: 1,
        color: theme.danger,
        alpha: 0.8,
      });
    }
  }
}

/** HSL to a pixi colour int; `s` and `l` are 0..1. */
function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];

  const to255 = (v: number) => Math.round((v + m) * 255);
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}
