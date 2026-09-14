
// src/lib/indexedDBService.ts
//
// Document and media *content* now live server-side (Cloudflare R2 for file
// bytes, D1 for metadata) via the /api/documents and /api/media endpoints -
// see src/app/api/documents and src/app/api/media. This file keeps its
// original name and exported function signatures so library/media/reader
// pages did not need to change, but internally it now talks to those APIs
// instead of the browser's IndexedDB.
//
// The "last active document id" (which doc you had open) is small, purely
// local UI convenience state, so that part alone still uses real IndexedDB.
import type { StoredMangaDocument, StoredPdfDocument, MangaDocumentDisplayInfo, MediaFavoriteItem } from '@/types';
import { saveDocumentMetadata } from './localStorageService';
import { getCachedUser } from './authService';

const DB_VERSION = 1;
const LAST_ACTIVE_DOC_STORE_NAME = 'appState';
const LAST_ACTIVE_DOC_KEY_BASE = 'lastActiveDocIdRead2';

let dbPromises: Map<string, Promise<IDBDatabase>> = new Map();

// --- Caching layer for the document list ---
let documentCache: StoredMangaDocument[] | null = null;
let isFetching: Promise<StoredMangaDocument[]> | null = null;

// --- base64 helpers (browser-safe) ---
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function getDBName(): string | null {
  const user = getCachedUser();
  if (!user) return null;
  const userId = user.email.replace(/[^a-zA-Z0-9]/g, '_');
  return `MangaTalkDB_${userId}`;
}

// Only used now for the small "last active document id" store.
function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB can only be accessed in the browser.'));
  }

  const dbName = getDBName();
  if (!dbName) {
    return Promise.reject(new Error('User not logged in. Cannot access database.'));
  }

  if (!dbPromises.has(dbName)) {
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`IndexedDB error: ${request.error?.message}`));
        dbPromises.delete(dbName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
          db.createObjectStore(LAST_ACTIVE_DOC_STORE_NAME, { keyPath: 'key' });
        }
      };
    });
    dbPromises.set(dbName, promise);
  }
  return dbPromises.get(dbName)!;
}

export function logoutAndClearPromises() {
  dbPromises.clear();
  documentCache = null;
  isFetching = null;
}

// --- Document Functions (R2 + D1 backed via /api/documents) ---

export async function saveDocument(doc: StoredMangaDocument): Promise<void> {
  documentCache = null; // Invalidate cache

  const { fileData, ...metadata } = doc as StoredMangaDocument & { fileData: ArrayBuffer };
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append('file', new Blob([fileData], { type: (doc as any).originalType || 'application/octet-stream' }));

  const res = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: form });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.success) {
    throw new Error(data.message || '保存文档失败。');
  }
}

export async function getDocumentById(id: string): Promise<StoredMangaDocument | undefined> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, { credentials: 'include' });
  if (res.status === 404) return undefined;
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.success || !data.document) return undefined;

  const { fileDataBase64, ...rest } = data.document;
  return { ...rest, fileData: base64ToArrayBuffer(fileDataBase64) } as StoredMangaDocument;
}

export async function getAllDocuments(forceRefresh: boolean = false): Promise<StoredMangaDocument[]> {
  const user = getCachedUser();
  if (!user) return [];

  if (documentCache && !forceRefresh) {
    return documentCache;
  }
  if (isFetching) {
    return isFetching;
  }

  isFetching = (async () => {
    try {
      const res = await fetch('/api/documents', { credentials: 'include' });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!data.success) throw new Error(data.message || '获取文档列表失败。');

      // Note: the list endpoint returns metadata only (no fileData) to stay
      // fast/small - callers that need the actual file bytes for a specific
      // document should use getDocumentById(id).
      const results = (data.documents || []) as StoredMangaDocument[];
      documentCache = results;

      const metadata: MangaDocumentDisplayInfo[] = documentCache.map((doc) => {
        const meta: MangaDocumentDisplayInfo = {
          id: doc.id,
          title: doc.title,
          type: doc.type,
          originalType: doc.originalType,
          createdAt: doc.createdAt,
        };
        if (doc.type === 'pdf') {
          meta.numPages = (doc as StoredPdfDocument).numPages;
        }
        return meta;
      });
      saveDocumentMetadata(metadata);

      isFetching = null;
      return documentCache;
    } catch (error) {
      isFetching = null;
      throw error;
    }
  })();
  return isFetching;
}

export async function deleteDocumentById(id: string): Promise<void> {
  documentCache = null; // Invalidate cache
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.success) {
    throw new Error(data.message || '删除文档失败。');
  }
}

// --- Media Functions (R2 + D1 backed via /api/media) ---

export async function saveMediaItem(item: MediaFavoriteItem): Promise<void> {
  const { fileData, ...metadata } = item;
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append('file', new Blob([fileData], { type: item.originalType || 'application/octet-stream' }));

  const res = await fetch('/api/media', { method: 'POST', credentials: 'include', body: form });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.success) {
    throw new Error(data.message || '保存媒体失败。');
  }
}

export async function getAllMediaItems(): Promise<MediaFavoriteItem[]> {
  const res = await fetch('/api/media', { credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.success) {
    throw new Error(data.message || '获取媒体列表失败。');
  }

  // Note: list items carry a streaming fileUrl instead of the raw bytes -
  // loading every media file's full content up front (especially video) is
  // what used to crash the app. Playback should use item.fileUrl directly.
  return (data.items || []).map((item: any) => ({
    ...item,
    fileData: new ArrayBuffer(0),
  })) as MediaFavoriteItem[];
}

export async function deleteMediaItemById(id: string): Promise<void> {
  const res = await fetch(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.success) {
    throw new Error(data.message || '删除媒体失败。');
  }
}

// --- Generic User/DB Functions (local "last active doc" state only) ---

function getDBNameForUser(email: string): string {
  const userId = email.replace(/[^a-zA-Z0-9]/g, '_');
  return `MangaTalkDB_${userId}`;
}

export async function deleteDatabaseForUser(email: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB can only be accessed in the browser.'));
  }
  const dbName = getDBNameForUser(email);

  if (dbPromises.has(dbName)) {
    try {
      const db = await dbPromises.get(dbName);
      db?.close();
    } catch (e) {
      console.warn(`Could not close DB handle for ${dbName} during deletion:`, e);
    } finally {
      dbPromises.delete(dbName);
    }
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Could not delete database: ${request.error?.message}`));
    request.onblocked = () => reject(new Error('Database deletion is blocked. Please close other tabs with this app open.'));
  });
}

function getLastActiveDocKey(): string | null {
  const user = getCachedUser();
  if (!user) return null;
  return `${LAST_ACTIVE_DOC_KEY_BASE}_${user.email}`;
}

export async function saveLastActiveDocId(docId: string | null): Promise<void> {
  const key = getLastActiveDocKey();
  if (!key) return;

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    docId === null ? store.delete(key) : store.put({ key, value: docId });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`Transaction error for last active doc ID: ${transaction.error?.message}`));
  });
}

export async function getLastActiveDocId(): Promise<string | null> {
  const key = getLastActiveDocKey();
  if (!key) return null;

  const db = await getDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
      return resolve(null);
    }
    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? (request.result.value as string) : null);
    request.onerror = () => reject(new Error(`Failed to get last active doc ID: ${request.error?.message}`));
  });
}

export function arrayBufferToBase64DataURL(buffer: ArrayBuffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: type });
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(blob);
  });
}
