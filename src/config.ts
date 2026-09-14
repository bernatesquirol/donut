import qs from "qs";

/**
 * Every tunable in one place. Any leaf can be overridden from the URL query
 * string using dotted paths, e.g.
 *
 *   ?game.timeLimit=90&game.strikes=2&game.showAnswer=off
 *
 * Booleans also accept a bare flag (`?game.showAnswer`) and on/off/yes/no.
 * Unknown keys and unparseable values are warned about and ignored, so a
 * fat-fingered URL degrades to the defaults instead of breaking the app.
 *
 * Add a game's knobs here rather than scattering constants: the override
 * machinery below is type-driven, so a new leaf is tunable from the URL the
 * moment you give it a default.
 */
export const DEFAULT_CONFIG = {
  game: {
    /**
     * Seconds on each contestant's clock, overriding whatever the document
     * says. 0 keeps the document's own limit, which is the normal case — set
     * this from the URL to run a short round without re-authoring anything:
     *
     *   /?game.timeLimit=30
     */
    timeLimit: 0,
    /**
     * Wrong answers a contestant gets in one turn before the table passes.
     * 1 — the default — means any mistake costs the turn.
     *
     * Counted per turn rather than per round, so it resets whenever they lose
     * the table. Raise it for a gentler round: ?game.strikes=2
     */
    strikes: 1,
    /** Rosco diameter as a fraction of the space one contestant is given. */
    roscoSize: 0.94,
    /**
     * Print the expected answer under the clue. On for a host reading from
     * the same screen; off when the screen is also facing the contestants.
     * Toggle at runtime with "a".
     */
    showAnswer: true,
    /**
     * Hide the clue on the contestants' screens and on `/view` whenever the
     * clock is stopped, so a pause is not free thinking time.
     *
     * The host's console is exempt whatever this says — see `redactionFor` —
     * because stopping the clock is what a host does in order to adjudicate,
     * or to read the next clue, and neither works off a blank panel. Turn
     * this off to leave the clue up on the other screens too.
     */
    hideCluePaused: true,
    /** Seconds left when the clock turns red and starts ticking audibly. */
    warnAt: 15,
    /**
     * Seconds the host's clock keys put on — or take off — a contestant's
     * clock. Both directions use the same step, so a mis-key is one press
     * back: ?game.timeStep=30
     */
    timeStep: 10,
    /** Master volume for the cues, 0..1. 0 mutes. */
    volume: 0.5,
  },
  live: {
    /**
     * Firebase Realtime Database holds the state of a round in progress, so
     * the host console and the contestants' screens all see the same thing.
     * Every value is inlined into the bundle at build time from
     * VITE_FIREBASE_*, and none of them is a secret: a web config identifies
     * a project, it does not authorise anything.
     *
     * Leave them unset and the live screens fall back to a same-browser
     * transport — still usable for a rehearsal on one machine.
     */
    firebase: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? "",
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
      appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
    },
    /**
     * Top-level database key every room lives under. Change it per game, or
     * two games share one set of rooms.
     */
    root: "donut-rooms",
  },
  persistence: {
    /**
     * URL of the presign endpoint. Empty keeps everything in localStorage.
     * Defaults from VITE_PRESIGN_ENDPOINT at build time; override per-visit
     * with ?persistence.presignEndpoint=...
     *
     * The endpoint is expected to authorise the caller itself and to validate
     * the requested key prefix. Nothing secret is held on the client.
     */
    presignEndpoint: import.meta.env.VITE_PRESIGN_ENDPOINT ?? "",
    /**
     * Bucket key prefix every document lives under. The presign endpoint
     * validates this prefix, so it has to match what the endpoint allows —
     * change it per game, or two games share one catalogue.
     */
    prefix: "donut/docs",
    /** Give up on a presign request after this many milliseconds. */
    timeoutMs: 10000,
  },
};

export type AppConfig = typeof DEFAULT_CONFIG;

type Mutable = Record<string, unknown>;

/** Parse the query string over the defaults. */
export function loadConfig(search: string = window.location.search): AppConfig {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
  const overrides = qs.parse(search, {
    ignoreQueryPrefix: true,
    allowDots: true,
    depth: 4,
  }) as Mutable;

  applyOverrides(config as unknown as Mutable, overrides, []);
  return config;
}

function applyOverrides(
  target: Mutable,
  overrides: Mutable,
  path: string[],
): void {
  for (const [key, raw] of Object.entries(overrides)) {
    const here = [...path, key].join(".");

    if (!(key in target)) {
      // Routes carry their own params (?id=, ?v=); only warn about things
      // that look like settings, so a normal link is not noisy.
      if (path.length > 0) warn(`unknown setting "${here}"`);
      continue;
    }

    const current = target[key];
    if (isGroup(current)) {
      if (!isGroup(raw)) {
        warn(`"${here}" is a group of settings, not a single value`);
        continue;
      }
      applyOverrides(current, raw, [...path, key]);
      continue;
    }

    if (typeof raw !== "string") {
      warn(`"${here}" expects a single value`);
      continue;
    }

    const coerced = coerce(current, raw);
    if (coerced === undefined) {
      warn(`"${here}" cannot be ${JSON.stringify(raw)}`);
      continue;
    }
    target[key] = coerced;
  }
}

/** Coerce a query-string value to the type of the default it replaces. */
function coerce(current: unknown, raw: string): unknown {
  if (typeof current === "boolean") {
    const v = raw.trim().toLowerCase();
    // A bare `?game.debugHitArea` arrives as an empty string.
    if (v === "" || v === "1" || v === "true" || v === "yes" || v === "on") {
      return true;
    }
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
    return undefined;
  }
  if (typeof current === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof current === "string") return raw;
  return undefined;
}

function isGroup(value: unknown): value is Mutable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function warn(message: string): void {
  console.warn(`[config] ${message}; using the default`);
}
