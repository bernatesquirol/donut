import type { AppConfig } from "../config";
import { FirebaseTransport, firebaseConfigured } from "../persistence/firebase";
import { LocalTransport } from "./localTransport";
import type { LiveTransport } from "./types";

/**
 * Pick a transport. Firebase when it is configured, this browser when it is
 * not — so every live screen works on a fresh clone, it just only works on
 * one machine. Callers read `.label` to say which they got rather than
 * branching on it.
 */
export function createTransport(config: AppConfig): LiveTransport {
  const fb = config.live.firebase;
  return firebaseConfigured(fb)
    ? new FirebaseTransport(fb, config.live.root)
    : new LocalTransport();
}
