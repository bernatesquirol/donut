import type { LiveMatch, LiveTransport } from "../../live/types";

/**
 * Firebase Realtime Database as a `LiveTransport`.
 *
 * The SDK is behind a dynamic import and the connection is lazy, so a visitor
 * who never opens a live screen downloads none of it — which matters, because
 * it is larger than the rest of the app put together.
 *
 * Nothing here is secret. A Firebase web config is public by design: it
 * identifies the project, it does not authorise anything. What protects a
 * round is the database rules plus the fact that a room path needs the
 * document's `liveKey`, which is not published anywhere.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
}

export function firebaseConfigured(config: FirebaseConfig): boolean {
  // The database URL is the only one we cannot do without; the rest are
  // needed for the SDK to initialise at all, so demand both.
  return Boolean(config.databaseURL && config.apiKey);
}

/** The pieces of the SDK this file uses, resolved once. */
interface Wired {
  db: import("firebase/database").Database;
  ref: typeof import("firebase/database").ref;
  set: typeof import("firebase/database").set;
  remove: typeof import("firebase/database").remove;
  onValue: typeof import("firebase/database").onValue;
}

/**
 * How long to wait for the clock skew before giving up and assuming none.
 * The host awaits this before its console appears, so it cannot be unbounded
 * — and being a little wrong about the offset is far better than not booting.
 */
const OFFSET_TIMEOUT_MS = 2000;

export class FirebaseTransport implements LiveTransport {
  readonly kind = "firebase" as const;
  readonly enabled: boolean;
  readonly label = "Firebase Realtime Database";

  private wired: Promise<Wired> | null = null;
  private offset: Promise<number> | null = null;

  /** `root` is the top-level key every room lives under. */
  constructor(
    private config: FirebaseConfig,
    private root: string,
  ) {
    this.enabled = firebaseConfigured(config);
  }

  private connect(): Promise<Wired> {
    if (this.wired) return this.wired;
    this.wired = (async () => {
      const [app, database] = await Promise.all([
        import("firebase/app"),
        import("firebase/database"),
      ]);
      // Re-use an existing app: two live screens in one tab would otherwise
      // trip the SDK's duplicate-name guard.
      const existing = app.getApps();
      const instance = existing.length
        ? existing[0]
        : app.initializeApp({
            apiKey: this.config.apiKey,
            authDomain: this.config.authDomain,
            databaseURL: this.config.databaseURL,
            projectId: this.config.projectId,
            appId: this.config.appId,
          });
      return {
        db: database.getDatabase(instance),
        ref: database.ref,
        set: database.set,
        remove: database.remove,
        onValue: database.onValue,
      };
    })();
    return this.wired;
  }

  private path(room: string): string {
    return `${this.root}/${room}`;
  }

  async publish(room: string, match: LiveMatch): Promise<void> {
    const w = await this.connect();
    // Realtime Database rejects `undefined`; a JSON round trip drops any that
    // crept in rather than failing the whole write mid-round.
    await w.set(
      w.ref(w.db, this.path(room)),
      JSON.parse(JSON.stringify(match)),
    );
  }

  subscribe(
    room: string,
    onMatch: (match: LiveMatch | null) => void,
    onError?: (err: Error) => void,
  ): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;

    void this.connect()
      .then((w) => {
        if (cancelled) return;
        stop = w.onValue(
          w.ref(w.db, this.path(room)),
          (snap) => onMatch((snap.val() as LiveMatch | null) ?? null),
          (err) => onError?.(err),
        );
      })
      .catch((err: unknown) => {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }

  /**
   * Firebase measures the skew between this machine and its servers and
   * publishes it at `/.info/serverTimeOffset` — the whole reason a
   * contestant's countdown matches the host's.
   *
   * Read with `onValue` rather than `get`: `.info` is synthesised by the SDK
   * from the connection, not stored, so a one-shot fetch of it has nothing to
   * fetch. (It is not addressable over the REST API at all.) Bounded by a
   * timeout because the host waits on this before it can draw anything.
   */
  serverOffset(): Promise<number> {
    if (this.offset) return this.offset;

    this.offset = this.connect()
      .then(
        (w) =>
          new Promise<number>((resolve) => {
            let settled = false;
            const done = (value: number) => {
              if (settled) return;
              settled = true;
              stop?.();
              clearTimeout(timer);
              resolve(value);
            };

            const timer = setTimeout(() => done(0), OFFSET_TIMEOUT_MS);
            const stop = w.onValue(
              w.ref(w.db, ".info/serverTimeOffset"),
              (snap) => {
                const value = Number(snap.val());
                done(Number.isFinite(value) ? value : 0);
              },
              () => done(0),
            );
          }),
      )
      .catch(() => 0);

    return this.offset;
  }

  async close(room: string): Promise<void> {
    const w = await this.connect();
    await w.remove(w.ref(w.db, this.path(room)));
  }
}
