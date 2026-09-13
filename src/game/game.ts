import { Application } from "pixi.js";
import type { AppConfig } from "../config";
import { timeLimitOf, type GameDoc } from "../doc/types";
import { theme } from "../theme";
import { Match, type MatchOptions, type MatchState } from "./match";
import { Scene, type SceneTap } from "./Scene";
import { viewOf } from "./view";

export interface GameOptions {
  config: AppConfig;
  doc: GameDoc;
  onTap?: (tap: SceneTap | null) => void;
  /**
   * After every match change, before the frame that shows it. This is where
   * a live round publishes from — the scene has already been given its view,
   * so a slow publish cannot hold up the host's own screen.
   */
  onChange?: (state: MatchState) => void;
}

export interface GameHandle {
  /** For anything that has to reach the stage — an overlay, a filter, a HUD. */
  app: Application;
  scene: Scene;
  /** The rules. Bind `onEvent` to make noise; call the actions from keys. */
  match: Match;
  /** Swap the document, which restarts the round. */
  setDoc(doc: GameDoc): void;
  /** Re-run layout and re-read the config after a runtime toggle. */
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
 * The `Match` is created here rather than in the route, so every surface
 * shows a donut that obeys the rules. Only `/` binds a keyboard to it.
 *
 * Note what crosses into the scene: a `MatchView`, never the `MatchState`.
 * The state holds every answer, and keeping that boundary here means a new
 * screen cannot accidentally be handed one — see `view.ts`.
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

  let doc = opts.doc;

  const scene = new Scene(opts.config);
  if (opts.onTap) scene.onTap = opts.onTap;
  app.stage.addChild(scene);

  const match = new Match(doc, matchOptions(doc, opts.config));
  match.onChange = (state) => {
    scene.setState(viewOf(state, doc, opts.config));
    opts.onChange?.(state);
  };

  scene.setTitle(doc.title);
  scene.setState(viewOf(match.snapshot, doc, opts.config));

  function apply(): void {
    const w = Math.max(1, Math.round(host.clientWidth));
    const h = Math.max(1, Math.round(host.clientHeight));
    app.renderer.resize(w, h);
    scene.resize(w, h);
  }
  apply();

  const observer = new ResizeObserver(apply);
  observer.observe(host);

  app.ticker.add((ticker) => {
    // The match reads the wall clock itself; the scene wants the readings
    // every frame and a delta for its animations.
    match.tick();
    scene.setClocks(match.snapshot.seats.map((s) => s.remainingMs));
    scene.update(ticker.deltaMS);
  });

  return {
    app,
    scene,
    match,
    setDoc(next) {
      doc = next;
      scene.setTitle(next.title);
      // A new document is a new round: there is no sensible way to carry
      // rulings across an edit that may have moved or removed the letters.
      match.setDoc(next, matchOptions(next, opts.config));
    },
    refresh() {
      scene.setState(viewOf(match.snapshot, doc, opts.config));
      scene.refresh();
      apply();
    },
    destroy() {
      observer.disconnect();
      // removeView tears the canvas out of the DOM with the renderer.
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

function matchOptions(doc: GameDoc, config: AppConfig): MatchOptions {
  return {
    timeLimit: timeLimitOf(doc, config.game.timeLimit),
    strikeLimit: config.game.strikes,
    warnAt: config.game.warnAt,
  };
}
