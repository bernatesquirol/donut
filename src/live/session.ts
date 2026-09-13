import type { MatchView } from "../game/view";
import { liveClockOf, liveOf, viewOfLive } from "./project";
import type { LiveMatch, LiveTransport } from "./types";

/**
 * The host end of a live round: turn each change into one write.
 *
 * The only subtle part is `startedAt`. A clock reading is stale the moment it
 * is sent, so what goes on the wire is the moment the run began — in *server*
 * time, because a contestant's laptop can be minutes out and the countdown
 * would be wrong by exactly that much. `Match` bumps a `runId` whenever it
 * re-anchors, which is how this knows a genuinely new run has started rather
 * than some unrelated change arriving while the clock keeps going.
 */
export interface HostClock {
  running: boolean;
  remainingAtStart: number;
  runId: number;
}

export class HostSession {
  private rev = 0;
  private offsetMs = 0;
  private lastRunId = -1;
  private startedAt: number | null = null;
  private lastError = "";

  constructor(
    private transport: LiveTransport,
    private room: string,
    private title: string,
  ) {}

  get label(): string {
    return this.transport.label;
  }

  get error(): string {
    return this.lastError;
  }

  /** Measure the clock skew once, before anything is published. */
  async open(): Promise<void> {
    this.offsetMs = await this.transport.serverOffset();
  }

  /** Server time, as best this machine can tell. */
  private serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  /** One write. Call on every match change, not every frame. */
  publish(view: MatchView, clock: HostClock): void {
    if (clock.runId !== this.lastRunId) {
      this.lastRunId = clock.runId;
      this.startedAt = clock.running ? this.serverNow() : null;
    } else if (!clock.running) {
      // Paused without re-anchoring: the reading in `remainingAtStart` is
      // already current, and there is no run in progress to time from.
      this.startedAt = null;
    }

    const payload = liveOf(
      view,
      {
        running: clock.running,
        remainingAtStart: clock.remainingAtStart,
        startedAt: this.startedAt,
      },
      ++this.rev,
      this.title,
    );

    this.transport.publish(this.room, payload).catch((err: unknown) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.warn("[live] publish failed", err);
    });
  }

  /** Take the room down. Best-effort: a failed cleanup is not worth a throw. */
  close(): void {
    this.transport.close(this.room).catch(() => {});
  }
}

/**
 * The contestant end: hold the latest payload and inflate it on demand.
 *
 * `view()` is called once per frame rather than once per message, because the
 * clock has to keep counting between messages — the host only writes when
 * something actually happens.
 */
export class ClientSession {
  private live: LiveMatch | null = null;
  private offsetMs = 0;
  private unsubscribe: (() => void) | null = null;
  private lastError = "";

  constructor(
    private transport: LiveTransport,
    private room: string,
  ) {}

  get error(): string {
    return this.lastError;
  }

  /** Has anything arrived yet? */
  get joined(): boolean {
    return this.live !== null;
  }

  /** The raw payload, for anything that needs more than the view. */
  get payload(): LiveMatch | null {
    return this.live;
  }

  async open(onChange: () => void): Promise<void> {
    this.offsetMs = await this.transport.serverOffset();
    this.unsubscribe = this.transport.subscribe(
      this.room,
      (match) => {
        // Out-of-order deliveries would rewind the round on screen.
        if (match && this.live && match.rev < this.live.rev) return;
        this.live = match;
        this.lastError = "";
        onChange();
      },
      (err) => {
        this.lastError = err.message;
        onChange();
      },
    );
  }

  /** Current view, with the clock brought up to the present. */
  view(): MatchView | null {
    return this.live ? viewOfLive(this.live, this.offsetMs) : null;
  }

  /** Just the readings, for the per-frame path. */
  clocks(): number[] {
    if (!this.live) return [];
    const now = Date.now() + this.offsetMs;
    return this.live.seats.map((_, i) => liveClockOf(this.live!, i, now));
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
