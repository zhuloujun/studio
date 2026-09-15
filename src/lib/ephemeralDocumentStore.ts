// src/lib/ephemeralDocumentStore.ts
// Hands a document from the library page's "search external literature"
// flow to the reader page without ever writing it to R2/D1.
//
// This used to be a plain in-memory Map, on the assumption that Next.js
// client-side navigation keeps the JS module alive across the transition.
// That assumption doesn't hold reliably: /library and /reader are separate
// route chunks, and depending on how the bundler splits shared modules, each
// chunk can end up with its OWN instance of this module - so a write from
// the library page's copy is invisible to the reader page's copy, and the
// document silently "isn't found" (the reader then falls back to its blank
// scratchpad view, which is what that looked like from the outside).
//
// sessionStorage is a real browser API rather than app-level module state,
// so it doesn't have this problem - it works the same regardless of which
// bundle chunk is asking. It only holds strings, so fileData (an
// ArrayBuffer) is base64-encoded going in and decoded coming back out.
import type { StoredMangaDocument } from '@/types';

const SESSION_KEY_PREFIX = 'mangaTalk_ephemeralDoc_';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Returns false if the document couldn't be stored (e.g. too large for sessionStorage's quota, typically ~5-10MB per origin). */
export function setEphemeralDocument(doc: StoredMangaDocument): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const { fileData, ...metadata } = doc as StoredMangaDocument & { fileData: ArrayBuffer };
    const payload = JSON.stringify({ ...metadata, fileDataBase64: arrayBufferToBase64(fileData) });
    window.sessionStorage.setItem(SESSION_KEY_PREFIX + doc.id, payload);
    return true;
  } catch (e) {
    console.error('[ephemeralDocumentStore] failed to store document (likely too large for sessionStorage)', e);
    return false;
  }
}

export function getEphemeralDocument(id: string): StoredMangaDocument | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.sessionStorage.getItem(SESSION_KEY_PREFIX + id);
  if (!raw) return undefined;
  try {
    const { fileDataBase64, ...rest } = JSON.parse(raw);
    return { ...rest, fileData: base64ToArrayBuffer(fileDataBase64) } as StoredMangaDocument;
  } catch (e) {
    console.error('[ephemeralDocumentStore] failed to parse stored document', e);
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
];

export function isEphemeralDocId(id: string): boolean {
  return EXTERNAL_SOURCE_PREFIXES.some((prefix) => id.startsWith(prefix));
}
