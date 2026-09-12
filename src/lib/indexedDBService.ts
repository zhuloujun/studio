
// src/lib/indexedDBService.ts
import type { StoredMangaDocument, StoredPdfDocument, MangaDocumentDisplayInfo, MediaFavoriteItem } from '@/types';
import { saveDocumentMetadata } from './localStorageService';
import { getCachedUser } from './authService';

const DB_VERSION = 3; // Incremented version to add media store
const DOC_STORE_NAME = 'documents';
const MEDIA_STORE_NAME = 'media';
const LAST_ACTIVE_DOC_STORE_NAME = 'appState';
const LAST_ACTIVE_DOC_KEY_BASE = 'lastActiveDocIdRead2';

let dbPromises: Map<string, Promise<IDBDatabase>> = new Map();

// --- Caching layer ---
let documentCache: StoredMangaDocument[] | null = null;
let isFetching: Promise<StoredMangaDocument[]> | null = null;

function getDBName(): string | null {
    const user = getCachedUser();
    if (!user) return null;
    const userId = user.email.replace(/[^a-zA-Z0-9]/g, '_');
    return `MangaTalkDB_${userId}`;
}

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error("IndexedDB can only be accessed in the browser."));
  }
  
  const dbName = getDBName();
  if (!dbName) {
    logoutAndClearPromises();
    return Promise.reject(new Error("User not logged in. Cannot access database."));
  }

  if (!dbPromises.has(dbName)) {
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onerror = () => {
        console.error(`[IndexedDBService] DB open error for ${dbName}:`, request.error);
        reject(new Error(`IndexedDB error: ${request.error?.message}`));
        dbPromises.delete(dbName);
      };

      request.onsuccess = () => {
        console.log(`[IndexedDBService] DB ${dbName} opened successfully.`);
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(DOC_STORE_NAME)) {
          db.createObjectStore(DOC_STORE_NAME, { keyPath: 'id' });
        }
        if (event.oldVersion < 2 && !db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
          db.createObjectStore(LAST_ACTIVE_DOC_STORE_NAME, { keyPath: 'key' });
        }
        if (event.oldVersion < 3 && !db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
            db.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'id' });
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

// --- Document Functions ---
export async function saveDocument(doc: StoredMangaDocument): Promise<void> {
  documentCache = null; // Invalidate cache
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.put(doc);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`Failed to save document: ${transaction.error?.message}`));
  });
}

export async function getDocumentById(id: string): Promise<StoredMangaDocument | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as StoredMangaDocument | undefined);
    request.onerror = () => reject(new Error(`Failed to get document by ID: ${request.error?.message}`));
  });
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

  isFetching = new Promise(async (resolve, reject) => {
    try {
        const db = await getDB();
        const transaction = db.transaction(DOC_STORE_NAME, 'readonly');
        const store = transaction.objectStore(DOC_STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const results = request.result as StoredMangaDocument[];
            documentCache = results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            const metadata: MangaDocumentDisplayInfo[] = documentCache.map(doc => {
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
            resolve(documentCache);
        };
        request.onerror = () => {
          isFetching = null;
          reject(new Error(`Failed to get all documents: ${request.error?.message}`));
        };
    } catch (error) {
        isFetching = null;
        reject(error);
    }
  });
  return isFetching;
}

export async function deleteDocumentById(id: string): Promise<void> {
  documentCache = null; // Invalidate cache
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`Failed to delete document: ${transaction.error?.message}`));
  });
}

// --- Media Functions ---
export async function saveMediaItem(item: MediaFavoriteItem): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEDIA_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(MEDIA_STORE_NAME);
        const request = store.put(item);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error(`Failed to save media item: ${transaction.error?.message}`));
    });
}

export async function getAllMediaItems(): Promise<MediaFavoriteItem[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEDIA_STORE_NAME, 'readonly');
        const store = transaction.objectStore(MEDIA_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve((request.result as MediaFavoriteItem[]).sort((a, b) => b.createdAt - a.createdAt));
        request.onerror = () => reject(new Error(`Failed to get all media items: ${request.error?.message}`));
    });
}

export async function deleteMediaItemById(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEDIA_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(MEDIA_STORE_NAME);
        const request = store.delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error(`Failed to delete media item: ${transaction.error?.message}`));
    });
}


// --- Generic User/DB Functions ---

function getDBNameForUser(email: string): string {
    const userId = email.replace(/[^a-zA-Z0-9]/g, '_');
    return `MangaTalkDB_${userId}`;
}

export async function deleteDatabaseForUser(email: string): Promise<void> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error("IndexedDB can only be accessed in the browser."));
    }
    const dbName = getDBNameForUser(email);

    if (dbPromises.has(dbName)) {
        try {
            const db = await dbPromises.get(dbName);
            db.close();
        } catch (e) {
            console.warn(`Could not close DB handle for ${dbName} during deletion:`, e);
        } finally {
            dbPromises.delete(dbName);
        }
    }

    return new Promise((resolve, reject) => {
        console.log(`[IndexedDBService] Deleting database: ${dbName}`);
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => {
            console.log(`[IndexedDBService] Database ${dbName} deleted successfully.`);
            resolve();
        };
        request.onerror = () => {
            console.error(`[IndexedDBService] Error deleting database ${dbName}:`, request.error);
            reject(new Error(`Could not delete database: ${request.error?.message}`));
        };
        request.onblocked = () => {
             console.warn(`[IndexedDBService] Deletion of database ${dbName} is blocked.`);
             reject(new Error(`Database deletion is blocked. Please close other tabs with this app open.`));
        };
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
        const request = docId === null ? store.delete(key) : store.put({ key, value: docId });
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
        request.onsuccess = () => {
            resolve(request.result ? (request.result.value as string) : null);
        };
        request.onerror = () => reject(new Error(`Failed to get last active doc ID: ${request.error?.message}`));
    });
}

export function arrayBufferToBase64DataURL(buffer: ArrayBuffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], {type: type});
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(blob);
  });
}
