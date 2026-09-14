import type { MatchEvent } from "./match";

/**
 * The cues, synthesised rather than loaded.
 *
 * A game show needs about eight noises and none of them is music, so an
 * oscillator and a gain envelope cover the lot — no asset pipeline, no files
 * to lose, and nothing to wait for before the first round can start. Swap in
 * real samples later if you want them; `cue()` is the only entry point the
 * rest of the game uses.
 *
 * Browsers refuse to start an AudioContext outside a gesture, so `unlock()`
 * exists and the tap gate in `mount.ts` is what calls it. Until then every
 * cue is a no-op rather than an error.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor(private volume: number) {}

  /** Call from a real user gesture — a click or a keypress. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    // Autoplay policy suspends a context created too early; a gesture is the
    // only thing that can resume it.
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  get muted(): boolean {
    return this.volume <= 0;
  }

  /** Flip the volume between 0 and whatever it was, for the host's "m" key. */
  toggleMute(): boolean {
    if (this.volume > 0) {
      this.remembered = this.volume;
      this.setVolume(0);
    } else {
      this.setVolume(this.remembered);
    }
    return this.muted;
  }

  private remembered = 0.5;

  /** One noise per match event. Unknown events stay silent on purpose. */
  cue(event: MatchEvent): void {
    switch (event) {
      // A confident two-note rise: the only cue the audience needs to read
      // from across a room.
      case "correct":
        this.blip({ from: 660, to: 880, dur: 0.09, type: "triangle" });
        this.blip({ from: 990, to: 1320, dur: 0.13, at: 0.07, gain: 0.9 });
        break;
      case "wrong":
        this.blip({
          from: 220,
          to: 110,
          dur: 0.34,
          type: "sawtooth",
          gain: 0.5,
        });
        this.blip({
          from: 233,
          to: 116,
          dur: 0.34,
          type: "sawtooth",
          gain: 0.4,
        });
        break;
      // Neither good nor bad, so: flat, short, and out of the way.
      case "pass":
        this.blip({ from: 440, to: 392, dur: 0.16, type: "sine", gain: 0.45 });
        break;
      case "start":
        this.blip({ from: 520, to: 780, dur: 0.12, type: "square", gain: 0.3 });
        break;
      case "stop":
        this.blip({ from: 300, to: 190, dur: 0.14, type: "square", gain: 0.3 });
        break;
      case "switch":
        this.blip({
          from: 700,
          to: 700,
          dur: 0.05,
          type: "square",
          gain: 0.25,
        });
        this.blip({
          from: 940,
          to: 940,
          dur: 0.05,
          at: 0.08,
          type: "square",
          gain: 0.25,
        });
        break;
      // Once a second over the last few seconds; has to be audible without
      // drowning the host reading the next clue.
      case "tick":
        this.blip({
          from: 1200,
          to: 1200,
          dur: 0.03,
          type: "square",
          gain: 0.18,
        });
        break;
      // A clock adjusted by hand. Two clean notes: the host has to hear that
      // the key landed, and nobody should mistake it for a ruling.
      case "time":
        this.blip({ from: 880, to: 880, dur: 0.05, type: "sine", gain: 0.3 });
        this.blip({
          from: 1175,
          to: 1175,
          dur: 0.08,
          at: 0.06,
          type: "sine",
          gain: 0.3,
        });
        break;
      case "timeup":
        for (let i = 0; i < 3; i++) {
          this.blip({
            from: 180,
            to: 140,
            dur: 0.26,
            at: i * 0.3,
            type: "sawtooth",
            gain: 0.55,
          });
        }
        break;
      case "over":
        [523, 659, 784, 1047].forEach((f, i) =>
          this.blip({
            from: f,
            to: f,
            dur: 0.18,
            at: i * 0.13,
            type: "triangle",
            gain: 0.5,
          }),
        );
        break;
    }
  }

  /**
   * One enveloped tone. `from`/`to` slide the pitch, `at` delays it so the
   * cues above can be written as little chords and arpeggios.
   */
  private blip(opts: {
    from: number;
    to: number;
    dur: number;
    at?: number;
    type?: OscillatorType;
    gain?: number;
  }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.volume <= 0) return;

    const start = ctx.currentTime + (opts.at ?? 0);
    const peak = 0.32 * (opts.gain ?? 1);

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "triangle";
    osc.frequency.setValueAtTime(opts.from, start);
    if (opts.to !== opts.from) {
      osc.frequency.exponentialRampToValueAtTime(opts.to, start + opts.dur);
    }

    // A 6ms attack instead of an instant one: a square wave switched on at
    // full gain clicks, and the click is louder than the note.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);

    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + opts.dur + 0.02);
    // Nodes are single-use; dropping the reference lets them be collected.
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}
