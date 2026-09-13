import { useEffect, useMemo, useRef } from "preact/hooks";
import type { AppConfig } from "../config";
import type { GameDoc } from "../doc/types";
import { createGame, type GameHandle } from "../game/game";
import type { SceneTap } from "../game/Scene";

export interface Selection {
  seat: number;
  index: number;
}

interface Props {
  config: AppConfig;
  doc: GameDoc;
  selection: Selection | null;
  onTap: (tap: SceneTap | null) => void;
}

/**
 * A live pixi scene inside the preact editor.
 *
 * The canvas is booted once and then *updated*, never remounted: rebuilding
 * the Application on every keystroke would drop a WebGL context per edit.
 * Everything that changes per render is read through a ref so the boot effect
 * can have an empty dependency list and mean it.
 *
 * It really is the game, rules and all — the clock is stopped, but the donut
 * shows which letters are playable and where the round would start. Clicking
 * a letter selects it in the form.
 */
export function Preview({ config, doc, selection, onTap }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<GameHandle | null>(null);

  // The preview's clock never starts, so the game's "hide the clue while the
  // clock is stopped" rule would blank the one thing being authored.
  const previewConfig = useMemo(
    () => ({
      ...config,
      game: { ...config.game, hideCluePaused: false },
    }),
    [config],
  );

  const latest = useRef({ doc, selection, onTap });
  latest.current = { doc, selection, onTap };

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let cancelled = false;
    let handle: GameHandle | null = null;

    createGame(el, {
      config: previewConfig,
      doc: latest.current.doc,
      onTap: (tap) => latest.current.onTap(tap),
    }).then((h) => {
      if (cancelled) {
        h.destroy();
        return;
      }
      handle = h;
      game.current = h;
      // Edits during the async boot would otherwise be lost.
      h.setDoc(latest.current.doc);
      apply(h, latest.current.selection);
    });

    return () => {
      cancelled = true;
      handle?.destroy();
      game.current = null;
    };
    // Booting once is the point; `config` is read at mount and stays put.
  }, []);

  useEffect(() => {
    const handle = game.current;
    if (!handle) return;
    handle.setDoc(doc);
    // setDoc restarts the round, so the selection has to be re-applied after.
    apply(handle, selection);
  }, [doc, selection]);

  return <div class="preview" ref={host} />;
}

function apply(handle: GameHandle, selection: Selection | null): void {
  handle.scene.setSelection(selection?.seat ?? null, selection?.index ?? null);
}
