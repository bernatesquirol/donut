/**
 * Shared storage for published documents.
 *
 * Layout under one prefix (`config.persistence.prefix`):
 *
 *   <prefix>/catalogue.json            listing: id, title, updatedAt, hash
 *   <prefix>/<docId>/index.json        VersionMeta[] for that document
 *   <prefix>/<docId>/snapshots/<hash>.json
 *   <prefix>/<docId>/<name>            raw attachments (images, audio, ...)
 *
 * Each document is its own versioned project, so editing one never rewrites
 * another and every document keeps an independent history you can revert to.
 * The catalogue exists because the adapter can list *versions within a
 * project* but has no way to enumerate projects — without it, nothing could
 * discover what has been published.
 *
 * With no presign endpoint configured this still works, against a separate
 * localStorage namespace, so callers never branch on availability. Check
 * `.enabled` only to explain to the user that a publish stays on this machine.
 */
import type { AppConfig } from "../config";
import {
  HttpPresignClient,
  LocalStorageAdapter,
  S3Adapter,
  VersionedRepo,
  type StorageAdapter,
  type VersionMeta,
} from "../persistence";
import { parseDoc, type GameDoc } from "./types";

const CATALOGUE = "catalogue.json";
/** The single file each snapshot holds. Snapshots are `Record<name, text>`. */
const SNAPSHOT_FILE = "doc.json";

export interface CatalogueEntry {
  id: string;
  title: string;
  /** ISO timestamp of the last publish. */
  updatedAt: string;
  /** Hash of the most recently published version. */
  hash: string;
}

/**
 * Turn an opaque cross-origin failure into something actionable.
 *
 * When a presigned response carries no Access-Control-Allow-Origin, the
 * browser rejects the fetch with a bare "Failed to fetch" TypeError — and the
 * devtools network row shows the underlying status, which is often a perfectly
 * normal 404 for an index.json that does not exist yet. That combination sends
 * you chasing the wrong thing, so name the likely cause.
 */
function explain(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(
      "The browser could not read the storage response. This is almost " +
        "always a missing CORS rule on the bucket: presigned URLs work from " +
        "curl, but a browser needs Access-Control-Allow-Origin on the " +
        `response to read it. (underlying: ${err.message})`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class RemoteStore {
  private adapter: StorageAdapter;
  /** Repo pointed at the collection root, used only for the catalogue. */
  private root: VersionedRepo;

  readonly enabled: boolean;

  constructor(private config: AppConfig) {
    const endpoint = config.persistence.presignEndpoint;
    this.enabled = Boolean(endpoint);

    this.adapter = this.enabled
      ? new S3Adapter({
          presigner: new HttpPresignClient({
            endpoint,
            timeoutMs: config.persistence.timeoutMs,
          }),
        })
      : new LocalStorageAdapter("remote-sim");

    this.root = new VersionedRepo(this.adapter, config.persistence.prefix);
  }

  private repoFor(id: string): VersionedRepo {
    return new VersionedRepo(
      this.adapter,
      `${this.config.persistence.prefix}/${id}`,
    );
  }

  // ------------------------------------------------------------- catalogue

  async listCatalogue(): Promise<CatalogueEntry[]> {
    let raw: string | null;
    try {
      raw = await this.root.loadObject(CATALOGUE);
    } catch (err) {
      throw explain(err);
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as CatalogueEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("[remote] catalogue is not readable", err);
      return [];
    }
  }

  private async writeCatalogue(entries: CatalogueEntry[]): Promise<void> {
    const sorted = [...entries].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    await this.root.saveObject(CATALOGUE, JSON.stringify(sorted, null, 2));
  }

  // --------------------------------------------------------------- publish

  /**
   * Write a new immutable version and point the catalogue at it. Returns the
   * content hash, which is stable: republishing unchanged work stores nothing
   * new.
   */
  async publish(doc: GameDoc): Promise<string> {
    const stamped: GameDoc = { ...doc, updatedAt: new Date().toISOString() };
    try {
      const hash = await this.repoFor(stamped.id).save(
        { [SNAPSHOT_FILE]: JSON.stringify(stamped) },
        { label: stamped.title || stamped.id },
      );

      const entry: CatalogueEntry = {
        id: stamped.id,
        title: stamped.title,
        updatedAt: stamped.updatedAt,
        hash,
      };
      const others = (await this.listCatalogue()).filter(
        (e) => e.id !== stamped.id,
      );
      await this.writeCatalogue([entry, ...others]);
      return hash;
    } catch (err) {
      throw explain(err);
    }
  }

  // ------------------------------------------------------------------ read

  /** Load a published document; omit `hash` for the catalogued latest. */
  async fetch(id: string, hash?: string): Promise<GameDoc | null> {
    let wanted = hash;
    if (!wanted) {
      const entry = (await this.listCatalogue()).find((e) => e.id === id);
      // Fall back to the newest entry in the document's own index, which
      // covers a publish whose catalogue write did not land.
      wanted = entry?.hash ?? (await this.versions(id))[0]?.hash;
    }
    if (!wanted) return null;

    let snapshot;
    try {
      snapshot = await this.repoFor(id).load(wanted);
    } catch (err) {
      throw explain(err);
    }
    const raw = snapshot?.[SNAPSHOT_FILE];
    if (!raw) return null;
    return parseDoc(JSON.parse(raw));
  }

  /** Version history for one document, newest first. */
  async versions(id: string): Promise<VersionMeta[]> {
    return this.repoFor(id).history();
  }

  // ----------------------------------------------------------------- assets

  /**
   * Upload an attachment's bytes — a sprite sheet, a sound, a photo. Name the
   * key after a content hash (`hashBytes`) and this is idempotent.
   *
   * Attachments live outside the snapshot: they are far too large to sit
   * inside a versioned JSON document, and they are immutable for the same
   * reason snapshots are, so they need no history of their own.
   */
  async putAsset(docId: string, key: string, blob: Blob): Promise<void> {
    if (!this.enabled) {
      throw new Error(
        "Uploads need a presign endpoint: there is nowhere local to put a " +
          "file this size. Set persistence.presignEndpoint.",
      );
    }
    try {
      await this.repoFor(docId).saveBlob(key, blob);
    } catch (err) {
      throw explain(err);
    }
  }

  /** Fetch an attachment's bytes, or null when the object is gone. */
  async getAsset(docId: string, key: string): Promise<Blob | null> {
    try {
      return await this.repoFor(docId).loadBlob(key);
    } catch (err) {
      throw explain(err);
    }
  }

  /**
   * Drop a document from the catalogue. The snapshots stay: they are
   * immutable and content-addressed, so any `?v=` link keeps resolving.
   */
  async unpublish(id: string): Promise<void> {
    const remaining = (await this.listCatalogue()).filter((e) => e.id !== id);
    await this.writeCatalogue(remaining);
  }
}
