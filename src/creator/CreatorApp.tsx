import { useEffect, useMemo, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { RemoteStore } from "../doc/remote";
import * as storage from "../doc/storage";
import { slugify, type GameDoc } from "../doc/types";
import { link } from "../router";
import { CopyLink } from "./CopyLink";
import { DocPicker } from "./DocPicker";
import { Editor } from "./Editor";

/**
 * The authoring shell: pick a document, edit it, publish it.
 *
 * Saving and publishing are two different things here, and the split is worth
 * keeping in a real game. Save writes the working copy to this browser, is
 * instant and happens on its own. Publish writes an immutable version to
 * shared storage and moves the catalogue pointer, which is the only thing
 * anyone else can see.
 */
/**
 * What to send someone once a round is published.
 *
 * Both links resolve from shared storage, so they work on a machine that has
 * never opened the creator — that is the whole point of publishing. The
 * pinned `&v=` one keeps working even after the round is edited and published
 * again, because versions are immutable and named by hash.
 */
function ShareLinks({ doc, hash }: { doc: GameDoc; hash: string }) {
  const id = encodeURIComponent(doc.id);
  const play = `/?id=${id}`;
  const pinned = `/?id=${id}&v=${encodeURIComponent(hash)}`;
  const view = `/view?id=${id}`;

  return (
    <div class="card">
      <h2>Share this round</h2>
      <ul class="doc-list">
        <CopyLink path={play} label="Host it" />
        <CopyLink path={pinned} label="Host this exact version" />
        <CopyLink path={view} label="Just look at the board" />
      </ul>
      <p class="muted">
        The first two open the console, keyboard and all. Editing this document
        again does not change what they serve until you publish.
      </p>
    </div>
  );
}

export function CreatorApp() {
  const config = useMemo(() => loadConfig(), []);
  const remote = useMemo(() => new RemoteStore(config), [config]);

  const [doc, setDoc] = useState<GameDoc | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [publishState, setPublishState] = useState("");
  /** Hash of the version just published, for the share links below. */
  const [publishedHash, setPublishedHash] = useState("");

  // Autosave a moment after edits stop, so a refresh never loses work.
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => {
      storage.save(doc);
      setSavedAt(new Date().toLocaleTimeString());
      // The links below point at what was published, and an edit means the
      // draft and the published round have parted ways again.
      setPublishState("");
      setPublishedHash("");
    }, 800);
    return () => clearTimeout(timer);
  }, [doc]);

  async function publish(current: GameDoc) {
    setPublishState("Publishing…");
    setPublishedHash("");
    try {
      const hash = await remote.publish(current);
      setPublishedHash(hash);
      setPublishState(
        remote.enabled
          ? `Published ${hash}`
          : `Saved locally as ${hash} (no presign endpoint configured)`,
      );
    } catch (err) {
      // Most likely causes: no presign endpoint reachable, the endpoint
      // refused the key, or crypto.subtle is missing on a plain-HTTP origin.
      setPublishState(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div class="screen">
      <header class="topbar">
        <h1>GAME CREATOR</h1>
        <nav>
          <a href={link("/")}>Game</a>
          {doc && (
            <>
              <a href={link(`/?id=${encodeURIComponent(doc.id)}`)}>
                Play this document
              </a>
              <a href={link(`/view?id=${encodeURIComponent(doc.id)}`)}>
                Published view
              </a>
            </>
          )}
        </nav>
      </header>

      {doc === null ? (
        <DocPicker remote={remote} onOpen={setDoc} />
      ) : (
        <>
          <div class="card">
            <div class="row">
              <button
                onClick={() => {
                  storage.save(doc);
                  setDoc(null);
                  setPublishState("");
                }}
              >
                ← All documents
              </button>
              <span class="grow" />
              <span class={publishState ? "muted grow-text" : "muted"}>
                {publishState ||
                  (savedAt ? `Saved ${savedAt}` : "Not saved yet")}
              </span>
              <button onClick={() => storage.downloadJson(doc, slugify(doc))}>
                Export .json
              </button>
              <button
                onClick={() => {
                  storage.save(doc);
                  publish(doc);
                }}
                title={
                  remote.enabled
                    ? "Write a new version to the shared store"
                    : "No presign endpoint configured; publishing stays local"
                }
              >
                Publish
              </button>
              <button
                class="primary"
                onClick={() => {
                  storage.save(doc);
                  setSavedAt(new Date().toLocaleTimeString());
                }}
              >
                Save
              </button>
            </div>
          </div>

          {publishedHash && <ShareLinks doc={doc} hash={publishedHash} />}

          <Editor
            config={config}
            doc={doc}
            update={(fn) => setDoc((d) => (d ? fn(d) : d))}
          />
        </>
      )}
    </div>
  );
}
