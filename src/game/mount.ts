import { loadConfig } from "../config";
import * as storage from "../doc/storage";
import { starterDoc, type GameDoc } from "../doc/types";
import { Overlay } from "../ui/Overlay";
import { createGame } from "./game";

/**
 * Route `/`: the game, full-screen, playing whatever this browser has open.
 *
 * It reads the local working copy, never the shared store — that is what
 * `/view` is for. So `npm run dev` opens on the document you were last
 * editing, and a fresh clone opens on `starterDoc()`.
 */
export async function mount(root: HTMLElement): Promise<void> {
  root.classList.add("fullscreen");

  const host = document.createElement("div");
  host.className = "stage-host";
  root.appendChild(host);

  const config = loadConfig();
  const doc = resolveDoc();

  const game = await createGame(host, {
    config,
    doc,
    onTap: (x, y, item) => {
      // Placeholder interaction: proof the pointer reaches the scene. Replace
      // with the game's actual input handling.
      if (item) console.log(`[game] tapped "${item.label}"`);
      else console.log(`[game] tapped empty space at ${f(x)}, ${f(y)}`);
    },
  });

  const overlay = new Overlay(doc.title || "Blank game", "TAP TO START");
  game.app.stage.addChild(overlay);

  function sizeOverlay() {
    overlay.resize(game.app.screen.width, game.app.screen.height);
  }
  game.app.renderer.on("resize", sizeOverlay);
  sizeOverlay();

  overlay.onTap = () => {
    // Everything the browser only allows from a gesture goes here: starting
    // audio, going fullscreen, locking the pointer.
    overlay.hide();
  };

  // "h" outlines each item's hit area, so a mis-aimed tap is debuggable.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "h" && e.key !== "H") return;
    config.game.debugHitArea = !config.game.debugHitArea;
    game.refresh();
  });
}

/** `?id=` picks a saved document; otherwise the most recent, else the starter. */
function resolveDoc(): GameDoc {
  const id = new URLSearchParams(window.location.search).get("id");
  return (id ? storage.load(id) : storage.loadLatest()) ?? starterDoc();
}

function f(v: number): string {
  return v.toFixed(3);
}
