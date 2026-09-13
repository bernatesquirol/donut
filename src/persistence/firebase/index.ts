/**
 * Firebase Realtime Database, behind the `LiveTransport` interface in
 * `src/live/types.ts`.
 *
 * Separate from the rest of `src/persistence/` on purpose: that is versioned
 * snapshot storage for *documents*, which are immutable and content-addressed.
 * This is the opposite — one mutable value per live round, overwritten many
 * times a minute and thrown away afterwards.
 */
export { FirebaseTransport, firebaseConfigured } from "./transport";
export type { FirebaseConfig } from "./transport";
