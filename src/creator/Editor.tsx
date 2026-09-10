import { useState } from "preact/hooks";
import type { AppConfig } from "../config";
import { clamp01, newItem, type DocItem, type GameDoc } from "../doc/types";
import { Preview } from "./Preview";

interface Props {
  config: AppConfig;
  doc: GameDoc;
  /** Apply a change. Immutable in, immutable out — the preview diffs on it. */
  update: (fn: (doc: GameDoc) => GameDoc) => void;
}

/**
 * The editing surface: fields on the left, the real scene on the right.
 *
 * The preview is the actual game, not a drawing of it, and placing an item by
 * clicking it is the point. Authoring tools that only edit numbers stay
 * plausible far longer than they should.
 */
export function Editor({ config, doc, update }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function patchItem(id: string, patch: Partial<DocItem>) {
    update((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  }

  function addItem() {
    const item = newItem(`item ${doc.items.length + 1}`, 0.5, 0.5);
    update((d) => ({ ...d, items: [...d.items, item] }));
    setSelectedId(item.id);
  }

  function removeItem(id: string) {
    update((d) => ({ ...d, items: d.items.filter((it) => it.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  /** A tap on the preview: pick an item, or move the picked one here. */
  function onTap(x: number, y: number, item: DocItem | null) {
    if (item) {
      setSelectedId(item.id);
      return;
    }
    if (selectedId) patchItem(selectedId, { x: clamp01(x), y: clamp01(y) });
  }

  return (
    <div class="editor">
      <div class="editor-side">
        <div class="card">
          <h2>Document</h2>
          <label class="field">
            <span>Title</span>
            <input
              type="text"
              value={doc.title}
              onInput={(e) =>
                update((d) => ({
                  ...d,
                  title: (e.currentTarget as HTMLInputElement).value,
                }))
              }
            />
          </label>
          <p class="muted">
            id <code>{doc.id}</code>
          </p>
        </div>

        <div class="card">
          <h2>Items</h2>
          {doc.items.length === 0 && (
            <p class="muted">
              Nothing in this document yet. Add an item, then click the preview
              to place it.
            </p>
          )}

          {doc.items.map((item) => (
            <div
              key={item.id}
              class={"item-row" + (item.id === selectedId ? " selected" : "")}
              onClick={() => setSelectedId(item.id)}
            >
              <span
                class="swatch"
                style={`background: hsl(${item.hue} 50% 45%)`}
              />
              <input
                type="text"
                value={item.label}
                placeholder="label"
                onInput={(e) =>
                  patchItem(item.id, {
                    label: (e.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <input
                class="hue"
                type="range"
                min="0"
                max="359"
                value={item.hue}
                title="Hue"
                onInput={(e) =>
                  patchItem(item.id, {
                    hue: Number((e.currentTarget as HTMLInputElement).value),
                  })
                }
              />
              <code class="muted pos">
                {item.x.toFixed(2)}, {item.y.toFixed(2)}
              </code>
              <button
                class="sm danger"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(item.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}

          <div class="row" style="margin-top:12px">
            <button onClick={addItem}>Add item</button>
            <span class="grow" />
            <span class="muted">
              {selectedId
                ? "Click the preview to place the selected item"
                : "Select an item to place it"}
            </span>
          </div>
        </div>
      </div>

      <div class="editor-main">
        <Preview
          config={config}
          doc={doc}
          selectedId={selectedId}
          onTap={onTap}
        />
        <p class="muted">
          The preview runs the same scene as the game, driven by the same
          document.
        </p>
      </div>
    </div>
  );
}
