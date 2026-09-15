// src/lib/ephemeralDocumentStore.ts
// Holds a document in memory just long enough to hand it from the library
// page's "search external literature" flow to the reader page, without ever
// writing it to R2/D1. Works because Next.js client-side navigation
// (router.push) doesn't reload the page, so this module-level state survives
// the transition. It intentionally does NOT survive a real page reload -
// that's the point: nothing here is meant to be durable.
import type { StoredMangaDocument } from '@/types';

const store = new Map<string, StoredMangaDocument>();

export function setEphemeralDocument(doc: StoredMangaDocument): void {
  store.set(doc.id, doc);
}

export function getEphemeralDocument(id: string): StoredMangaDocument | undefined {
  return store.get(id);
}

export function isEphemeralDocId(id: string): boolean {
  return id.startsWith('external-');
}
