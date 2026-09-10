import { useEffect, useRef } from "preact/hooks";
import type { AppConfig } from "../config";
import { createGame, type GameHandle } from "../game/game";
import type { DocItem, GameDoc } from "../doc/types";

interface Props {
  config: AppConfig;
  doc: GameDoc;
  selectedId: string | null;
  onTap: (x: number, y: number, item: DocItem | null) => void;
}

/**
 * A live pixi scene inside the preact editor.
 *
 * The canvas is booted once and then *updated*, never remounted: rebuilding
 * the Application on every keystroke would drop a WebGL context per edit.
 * Everything that changes per render is read through a ref so the boot effect
 * can have an empty dependency list and mean it.
 */
export function Preview({ config, doc, selectedId, onTap }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<GameHandle | null>(null);

  const latest = useRef({ doc, selectedId, onTap });
  latest.current = { doc, selectedId, onTap };

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let cancelled = false;
    let handle: GameHandle | null = null;

    createGame(el, {
      config,
      doc: latest.current.doc,
      onTap: (x, y, item) => latest.current.onTap(x, y, item),
    }).then((h) => {
      if (cancelled) {
        h.destroy();
        return;
      }
      handle = h;
      game.current = h;
      // Edits during the async boot would otherwise be lost.
      h.setDoc(latest.current.doc);
      h.scene.setHighlight(latest.current.selectedId);
    });

    return () => {
      cancelled = true;
      handle?.destroy();
      game.current = null;
    };
    // Booting once is the point; `config` is read at mount and stays put.
  }, []);

  useEffect(() => {
    game.current?.setDoc(doc);
    // setDoc reconciles tiles, so the highlight has to be re-applied after it.
    game.current?.scene.setHighlight(selectedId);
  }, [doc, selectedId]);

  return <div class="preview" ref={host} />;
}
