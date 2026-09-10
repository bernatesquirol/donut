import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadConfig, type AppConfig } from "../config";
import { RemoteStore } from "../doc/remote";
import * as storage from "../doc/storage";
import type { GameDoc } from "../doc/types";
import { createGame, type GameHandle } from "../game/game";
import { readVersionFromUrl } from "../persistence";
import { link } from "../router";

/**
 * Route `/view`: one published document, resolved from the URL.
 *
 *   /view?id=<docId>        the catalogued latest version
 *   /view?id=<docId>&v=<hash>   that exact immutable version
 *
 * This is the shareable surface, and it is a different job from `/`: it has to
 * work for someone who has never opened the creator, on a machine with an
 * empty localStorage, from a link. Hence the chrome — a title, a status, an
 * error you can act on — around the same scene the game runs.
 */
export function ViewerApp() {
  const config = useMemo(() => loadConfig(), []);
  const id = new URLSearchParams(window.location.search).get("id");
  const version = readVersionFromUrl();

  // A pinned ?v= always goes to the store: localStorage only ever holds the
  // working copy, which is by definition not a published version.
  const [doc, setDoc] = useState<GameDoc | null>(() =>
    version ? null : id ? storage.load(id) : null,
  );
  const [status, setStatus] = useState(doc ? "" : "loading");

  useEffect(() => {
    if (doc) return;
    if (!id) {
      setStatus("no-id");
      return;
    }
    let cancelled = false;
    const remote = new RemoteStore(config);
    remote
      .fetch(id, version ?? undefined)
      .then((fetched) => {
        if (cancelled) return;
        if (fetched) setDoc(fetched);
        else setStatus("missing");
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[viewer] remote fetch failed", err);
        setStatus(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Resolving once on mount is intended; the id comes from the URL.
  }, []);

  if (!doc) {
    return (
      <div class="screen">
        <Header title="PUBLISHED VIEW" />
        <div class="card">
          {status === "loading" ? (
            <p class="muted">Loading…</p>
          ) : status === "no-id" ? (
            <p class="muted">
              This page shows one published document. Open something in the{" "}
              <a href={link("/creator")}>creator</a> and publish it, then come
              back with <code>?id=…</code>
            </p>
          ) : status === "missing" ? (
            <p class="muted">
              Nothing published under <code>{id}</code>
              {version ? (
                <>
                  {" "}
                  at version <code>{version}</code>
                </>
              ) : null}
              .
            </p>
          ) : (
            <p class="error">{status}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      <Header title={doc.title || "Untitled"} />
      <Stage doc={doc} config={config} />
      <p class="muted">
        {doc.items.length} item{doc.items.length === 1 ? "" : "s"} · published{" "}
        {new Date(doc.updatedAt).toLocaleString()}
        {version ? (
          <>
            {" "}
            · version <code>{version}</code>
          </>
        ) : null}
      </p>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <header class="topbar">
      <h1>{title}</h1>
      <nav>
        <a href={link("/")}>Game</a>
        <a href={link("/creator")}>Creator</a>
      </nav>
    </header>
  );
}

/** The scene, read-only. Same host contract as the creator's preview. */
function Stage({ doc, config }: { doc: GameDoc; config: AppConfig }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let handle: GameHandle | null = null;

    createGame(el, { config, doc }).then((h) => {
      if (cancelled) {
        h.destroy();
        return;
      }
      handle = h;
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [doc]);

  return <div class="preview tall" ref={host} />;
}
