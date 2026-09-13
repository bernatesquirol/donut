import { Application } from "pixi.js";
import type { AppConfig } from "../config";
import { theme } from "../theme";
import { Scene } from "./Scene";

export interface BoardHandle {
  app: Application;
  scene: Scene;
  /** Called once per frame. Push the clock readings in from here. */
  onFrame: (deltaMS: number) => void;
  destroy(): void;
}

/**
 * A scene with no rules behind it.
 *
 * `createGame` builds a `Match` because the host console needs one. A
 * contestant's screen must not have one: the rules would need the document,
 * the document holds the answers, and the whole point of the live projection
 * is that those never reach this machine. So this boots the same renderer
 * with nothing but a view to draw.
 */
export async function createBoard(
  host: HTMLElement,
  config: AppConfig,
): Promise<BoardHandle> {
  const app = new Application();
  await app.init({
    background: theme.bg,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
  });
  host.appendChild(app.canvas);
  app.stage.eventMode = "static";

  const scene = new Scene(config);
  app.stage.addChild(scene);

  function apply(): void {
    const w = Math.max(1, Math.round(host.clientWidth));
    const h = Math.max(1, Math.round(host.clientHeight));
    app.renderer.resize(w, h);
    scene.resize(w, h);
  }
  apply();

  const observer = new ResizeObserver(apply);
  observer.observe(host);

  const handle: BoardHandle = {
    app,
    scene,
    onFrame: () => {},
    destroy() {
      observer.disconnect();
      app.destroy({ removeView: true }, { children: true });
    },
  };

  app.ticker.add((ticker) => {
    handle.onFrame(ticker.deltaMS);
    scene.update(ticker.deltaMS);
  });

  return handle;
}
