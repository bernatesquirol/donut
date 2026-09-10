import qs from "qs";

/**
 * Every tunable in one place. Any leaf can be overridden from the URL query
 * string using dotted paths, e.g.
 *
 *   ?game.itemSize=0.2&game.bob=0&game.debugHitArea
 *
 * Booleans also accept a bare flag (`?game.debugHitArea`) and on/off/yes/no.
 * Unknown keys and unparseable values are warned about and ignored, so a
 * fat-fingered URL degrades to the defaults instead of breaking the app.
 *
 * Add a game's knobs here rather than scattering constants: the override
 * machinery below is type-driven, so a new leaf is tunable from the URL the
 * moment you give it a default.
 */
export const DEFAULT_CONFIG = {
  game: {
    /** Item size as a fraction of the stage's shorter side. */
    itemSize: 0.14,
    /** Idle bob amplitude in px. 0 stills the scene. */
    bob: 5,
    /** Seconds for one full bob cycle. */
    bobPeriod: 2.4,
    /** Outline each item's hit area. Toggle at runtime with "h". */
    debugHitArea: false,
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
    prefix: "blank-game/docs",
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
