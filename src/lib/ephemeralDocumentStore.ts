// src/lib/ephemeralDocumentStore.ts
// Hands a document from the library page's "search external literature"
// flow to the reader page without ever writing it to R2/D1.
//
// History of how this is stored, because it's tripped up twice already:
//  1. Started as a plain in-memory Map - broke because /library and /reader
//     are separate route chunks and can each get their own instance of the
//     module, so a write from one page was invisible to the other.
//  2. Switched to sessionStorage - fixed that, but sessionStorage only
//     holds strings, so the file bytes had to be base64-encoded, and
//     sessionStorage's ~5-10MB per-origin quota meant a lot of real PDFs
//     didn't fit ("这份文献文件太大" errors).
//  3. Now uses IndexedDB: a real cross-page browser API (so it doesn't have
//     problem #1), stores the ArrayBuffer directly with no base64 inflation,
//     and has a much larger quota (typically a large fraction of free disk
//     space) so problem #2 goes away too.
import type { StoredMangaDocument } from '@/types';

const DB_NAME = 'MangaTalkEphemeralDocs';
const STORE_NAME = 'documents';
const DB_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // stale entries are cleaned up opportunistically

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

async function cleanupOldEntries(db: IDBDatabase): Promise<void> {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        if ((cursor.value?.savedAt || 0) < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  } catch {
    // best-effort cleanup only
  }
}

/** Returns false if the document couldn't be stored. */
export async function setEphemeralDocument(doc: StoredMangaDocument): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...doc, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    cleanupOldEntries(db).finally(() => db.close());
    return true;
  } catch (e) {
    console.error('[ephemeralDocumentStore] failed to store document', e);
    return false;
  }
}

export async function getEphemeralDocument(id: string): Promise<StoredMangaDocument | undefined> {
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
    const { savedAt, ...doc } = result;
    return doc as StoredMangaDocument;
  } catch (e) {
    console.error('[ephemeralDocumentStore] failed to read document', e);
    return undefined;
  }
}

// Prefixes used by every external literature source in
// /api/external-search - kept as a single list here so it can't drift out
// of sync with the id-generation code in that route.
const EXTERNAL_SOURCE_PREFIXES = [
  'arxiv-',
  'gutenberg-',
  'semanticscholar-',
  'core-',
  'openalex-',
  'crossref-',
  'zenodo-',
  'pmc-',
  'hcommons-',
  'archive-',
  'doaj-',
];

export function isEphemeralDocId(id: string): boolean {
  return EXTERNAL_SOURCE_PREFIXES.some((prefix) => id.startsWith(prefix));
}
