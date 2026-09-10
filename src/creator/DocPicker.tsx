import { useEffect, useMemo, useState } from "preact/hooks";
import type { RemoteStore, CatalogueEntry } from "../doc/remote";
import * as storage from "../doc/storage";
import { newDoc, type GameDoc } from "../doc/types";

interface Props {
  remote: RemoteStore;
  onOpen: (doc: GameDoc) => void;
}

/**
 * First step: start a document, reopen a local one, or pull down something
 * already published.
 *
 * The two lists are kept apart because they answer different questions. Local
 * is "what am I working on"; published is "what has anyone seen". A document
 * can easily be in one and not the other.
 */
export function DocPicker({ remote, onOpen }: Props) {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const local = useMemo(() => storage.listDocs(), [revision]);

  const [published, setPublished] = useState<CatalogueEntry[] | null>(null);

  useEffect(() => {
    if (!remote.enabled) return;
    remote
      .listCatalogue()
      .then(setPublished)
      .catch((err) => {
        console.warn("[creator] could not read the catalogue", err);
        setPublished([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [remote, revision]);

  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      onOpen(await storage.readJsonFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    input.value = "";
  }

  async function openPublished(entry: CatalogueEntry) {
    setError("");
    try {
      const doc = await remote.fetch(entry.id, entry.hash);
      if (doc) onOpen(doc);
      else setError(`"${entry.title || entry.id}" could not be read back.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div class="card">
        <h2>New document</h2>
        <div class="row">
          <button class="primary" onClick={() => onOpen(newDoc("Untitled"))}>
            Start a blank document
          </button>
          <label class="file-button">
            Import .json
            <input
              type="file"
              accept="application/json"
              onChange={importFile}
            />
          </label>
        </div>
        {error && <p class="error">{error}</p>}
      </div>

      <div class="card">
        <h2>On this machine</h2>
        {local.length === 0 ? (
          <p class="muted">Nothing saved here yet.</p>
        ) : (
          <ul class="doc-list">
            {local.map((entry) => (
              <li key={entry.id}>
                <button
                  class="link"
                  onClick={() => {
                    const doc = storage.load(entry.id);
                    if (doc) onOpen(doc);
                    else setError(`"${entry.id}" could not be read.`);
                  }}
                >
                  {entry.title || entry.id}
                </button>
                <span class="grow" />
                <code class="muted">{entry.id}</code>
                <button
                  class="sm danger"
                  onClick={() => {
                    storage.remove(entry.id);
                    setRevision((r) => r + 1);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="card">
        <h2>Published</h2>
        {!remote.enabled ? (
          <p class="muted">
            No presign endpoint configured, so nothing is shared. Set
            VITE_PRESIGN_ENDPOINT, or pass
            <code> ?persistence.presignEndpoint=…</code>
          </p>
        ) : published === null ? (
          <p class="muted">Reading the catalogue…</p>
        ) : published.length === 0 ? (
          <p class="muted">Nothing published yet.</p>
        ) : (
          <ul class="doc-list">
            {published.map((entry) => (
              <li key={entry.id}>
                <button class="link" onClick={() => openPublished(entry)}>
                  {entry.title || entry.id}
                </button>
                <span class="grow" />
                <span class="muted">
                  {new Date(entry.updatedAt).toLocaleString()}
                </span>
                <code class="muted">{entry.hash}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
