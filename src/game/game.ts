import { Application } from "pixi.js";
import type { AppConfig } from "../config";
import type { DocItem, GameDoc } from "../doc/types";
import { theme } from "../theme";
import { Scene } from "./Scene";

export interface GameOptions {
  config: AppConfig;
  doc: GameDoc;
  onTap?: (x: number, y: number, item: DocItem | null) => void;
}

export interface GameHandle {
  /** For anything that has to reach the stage — an overlay, a filter, a HUD. */
  app: Application;
  scene: Scene;
  setDoc(doc: GameDoc): void;
  /** Re-run layout after a config change (e.g. a debug toggle). */
  refresh(): void;
  destroy(): void;
}

/**
 * Boot a pixi canvas into `host` and keep it sized to that element.
 *
 * The size comes from the host rather than the window so the same function
 * serves the full-screen route, the creator's preview box and the published
 * view. That is the whole reason this is separate from `mount.ts`: a game you
 * cannot embed is a game you cannot author against.
 *
 * Always `destroy()` — preact effects re-run, and a leaked Application keeps
 * its ticker and its WebGL context alive.
 */
export async function createGame(
  host: HTMLElement,
  opts: GameOptions,
): Promise<GameHandle> {
  const app = new Application();
  await app.init({
    background: theme.bg,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    // Sized by the observer below; these are just the first frame.
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
  });
  host.appendChild(app.canvas);

  app.stage.eventMode = "static";

  const scene = new Scene(opts.config);
  if (opts.onTap) scene.onTap = opts.onTap;
  app.stage.addChild(scene);
  scene.setDoc(opts.doc);

  function apply(): void {
    const w = Math.max(1, Math.round(host.clientWidth));
    const h = Math.max(1, Math.round(host.clientHeight));
    app.renderer.resize(w, h);
    scene.resize(w, h);
  }
  apply();

  const observer = new ResizeObserver(apply);
  observer.observe(host);

  app.ticker.add((ticker) => scene.update(ticker.deltaMS));

  return {
    app,
    scene,
    setDoc: (doc) => scene.setDoc(doc),
    refresh: apply,
    destroy() {
      observer.disconnect();
      // removeView tears the canvas out of the DOM with the renderer.
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
