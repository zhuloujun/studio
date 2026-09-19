// src/lib/documentLocalCache.ts
//
// A local (per-browser) cache of full documents (including file bytes),
// keyed by document id. This exists purely so that reopening a document you
// were just reading doesn't have to re-download the file and, for a PDF,
// re-run text extraction across every page from scratch - clicking "阅读器"
// (the reader nav link, which reopens your last-active document) used to
// always do a full network round-trip + re-parse, even when nothing had
// changed since the last time you had it open.
//
// This is purely a speed optimization, not the source of truth - saves
// still go to the server (see indexedDBService.ts), and a cached read is
// always paired with a silent background refresh so the cache doesn't drift
// far from what's actually on the server (e.g. edited from another device).
import type { StoredMangaDocument } from '@/types';

// A background refresh (see getDocumentById in indexedDBService.ts) can take
// a while, and if the user saves an edit *while it's in flight*, the
// refresh's older, pre-edit copy of the document must not be allowed to
// land afterwards and silently wipe out that edit from the cache - that was
// making edits "not save" in a very confusing, hard-to-reproduce way. Each
// write bumps a per-id version counter; a background refresh records the
// version it started at and only applies its result if nothing has written
// to that id's cache since. This is in-memory (per tab) rather than
// persisted, which is fine - it only needs to outlive a single in-flight
// fetch, not a page reload.
const cacheVersions = new Map<string, number>();

export function getCacheVersion(id: string): number {
  return cacheVersions.get(id) || 0;
}

function bumpCacheVersion(id: string): void {
  cacheVersions.set(id, getCacheVersion(id) + 1);
}

const DB_NAME = 'MangaTalkDocumentCache';
const STORE_NAME = 'documents';
const DB_VERSION = 1;
// Keep this modest - each entry can include a full PDF/ebook's file bytes,
// and this is a speed convenience, not a full offline library.
const MAX_CACHED_DOCUMENTS = 8;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedDocument(id: string): Promise<StoredMangaDocument | undefined> {
  if (typeof window === 'undefined') return undefined;
  try {
    const db = await openDb();
    const result = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!result) return undefined;
    const { lastAccessed, ...doc } = result;
    return doc as StoredMangaDocument;
  } catch (e) {
    console.warn('[documentLocalCache] read failed', e);
    return undefined;
  }
}

async function evictLeastRecentlyUsed(db: IDBDatabase): Promise<void> {
  try {
    const entries: { id: string; lastAccessed: number }[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result || []).map((r: any) => ({ id: r.id, lastAccessed: r.lastAccessed || 0 })));
      req.onerror = () => reject(req.error);
    });
    if (entries.length <= MAX_CACHED_DOCUMENTS) return;
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    const toEvict = entries.slice(0, entries.length - MAX_CACHED_DOCUMENTS);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      toEvict.forEach((e) => store.delete(e.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort only
  }
}

export async function setCachedDocument(doc: StoredMangaDocument): Promise<void> {
  if (typeof window === 'undefined') return;
  bumpCacheVersion(doc.id);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...doc, lastAccessed: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    evictLeastRecentlyUsed(db).finally(() => db.close());
  } catch (e) {
    console.warn('[documentLocalCache] write failed', e);
  }
}

// setCachedDocument, but only applies if nothing has written to this id's
// cache since `sinceVersion` (from getCacheVersion, captured before a
// background refresh started). Use this for a background refresh's result
// so it can never clobber a more recent local edit that happened while the
// refresh was in flight.
export async function setCachedDocumentIfNoNewerWrite(
  doc: StoredMangaDocument,
  sinceVersion: number
): Promise<void> {
  if (getCacheVersion(doc.id) !== sinceVersion) return;
  await setCachedDocument(doc);
}

export async function clearCachedDocument(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[documentLocalCache] clear failed', e);
  }
}

export async function clearAllCachedDocuments(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  } catch (e) {
    console.warn('[documentLocalCache] clear-all failed', e);
  }
}
