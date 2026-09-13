import type { LiveMatch, LiveTransport } from "./types";

/**
 * A stand-in transport that never leaves the browser.
 *
 * `storage` events fire in every *other* tab on the origin, which is exactly
 * the shape of this problem: the host writes, the contestant screens listen.
 * So the whole two-screen flow can be developed and tested on one machine with
 * no project, no keys and no network — and because it implements the same
 * interface, nothing above it knows the difference.
 *
 * It is also the graceful fallback when Firebase is not configured: the live
 * screens still work, they just only work on this computer.
 */
export class LocalTransport implements LiveTransport {
  readonly kind = "local" as const;
  readonly enabled = true;
  readonly label = "this browser only — no Firebase configured";

  constructor(private prefix = "donut.live.") {}

  private key(room: string): string {
    return this.prefix + room;
  }

  private read(room: string): LiveMatch | null {
    try {
      const raw = localStorage.getItem(this.key(room));
      return raw ? (JSON.parse(raw) as LiveMatch) : null;
    } catch {
      return null;
    }
  }

  publish(room: string, match: LiveMatch): Promise<void> {
    try {
      localStorage.setItem(this.key(room), JSON.stringify(match));
    } catch (err) {
      // A full quota should not take the round down with it.
      console.warn("[live] could not write the local room", err);
    }
    return Promise.resolve();
  }

  subscribe(
    room: string,
    onMatch: (match: LiveMatch | null) => void,
  ): () => void {
    // Late joiners need the current value, not just the next change.
    onMatch(this.read(room));

    const key = this.key(room);
    const handler = (e: StorageEvent) => {
      if (e.key !== null && e.key !== key) return;
      onMatch(this.read(room));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }

  /** One clock for every tab, so there is nothing to correct. */
  serverOffset(): Promise<number> {
    return Promise.resolve(0);
  }

  close(room: string): Promise<void> {
    localStorage.removeItem(this.key(room));
    return Promise.resolve();
  }
}
