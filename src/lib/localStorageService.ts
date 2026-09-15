
import type { TTSSettings, FavoriteItem, MangaDocumentDisplayInfo, NoteFavoriteItem, Annotation, MediaFavoriteItem, PlaybackMode } from '@/types';
import { getCachedUser } from './authService';

// --- KEY GENERATION ---
// All keys are now functions that generate user-specific keys.

const getUserId = (): string | null => {
    const user = getCachedUser();
    return user ? user.email : null;
};

const getUserKey = (baseKey: string): string | null => {
    const userId = getUserId();
    if (!userId) return null;
    return `${baseKey}_${userId}`;
};

const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const FAVORITE_ITEMS_KEY = 'mangaTalk_favoriteItems_v1';
const NOTE_FAVORITES_KEY = 'mangaTalk_noteFavorites_v1';
const MEDIA_FAVORITES_KEY = 'mangaTalk_mediaFavorites_v1';
const SCRATCHPAD_TEXT_KEY = 'mangaTalk_scratchpadText_v1';
const SCRATCHPAD_ANNOTATIONS_KEY = 'mangaTalk_scratchpadAnnotations_v1';
const DOC_METADATA_CACHE_KEY = 'mangaTalk_docMetadataCache_v1';
const TTS_TEXT_SIZE_KEY = 'mangaTalk_ttsTextSize_v1';
const PDF_MANGA_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v3';
const EPUB_MANGA_DOCUMENT_CFI_KEY = 'mangaTalk_epubDocumentCfi_v1';
const REMEMBERED_EMAIL_KEY = 'mangaTalk_rememberedEmail_v1';
// New keys for separate TTS settings for notes page
const NOTE_FAVORITES_ORIGINAL_TTS_SETTINGS_KEY = 'mangaTalk_noteFavsOriginalTts_v1';
const NOTE_FAVORITES_NOTE_TTS_SETTINGS_KEY = 'mangaTalk_noteFavsNoteTts_v1';
const FAVORITES_PLAYBACK_MODE_KEY = 'mangaTalk_favoritesPlaybackMode_v1';
const NOTES_PLAYBACK_MODE_KEY = 'mangaTalk_notesPlaybackMode_v1';
const MEDIA_PLAYBACK_MODE_KEY = 'mangaTalk_mediaPlaybackMode_v1';
const READING_AREA_BG_KEY = 'mangaTalk_readingAreaBg_v2'; // Changed to v2 for new data type
const EXTERNAL_SEARCH_CACHE_KEY = 'mangaTalk_externalSearchCache_v1';


const ALL_USER_SPECIFIC_BASE_KEYS = [
    TTS_SETTINGS_KEY,
    FAVORITE_ITEMS_KEY,
    NOTE_FAVORITES_KEY,
    MEDIA_FAVORITES_KEY,
    SCRATCHPAD_TEXT_KEY,
    SCRATCHPAD_ANNOTATIONS_KEY,
    DOC_METADATA_CACHE_KEY,
    TTS_TEXT_SIZE_KEY,
    PDF_MANGA_DOCUMENT_PAGE_STATES_KEY,
    EPUB_MANGA_DOCUMENT_CFI_KEY,
    NOTE_FAVORITES_ORIGINAL_TTS_SETTINGS_KEY, // Add to cleanup list
    NOTE_FAVORITES_NOTE_TTS_SETTINGS_KEY, // Add to cleanup list
    FAVORITES_PLAYBACK_MODE_KEY,
    NOTES_PLAYBACK_MODE_KEY,
    MEDIA_PLAYBACK_MODE_KEY,
    READING_AREA_BG_KEY,
    EXTERNAL_SEARCH_CACHE_KEY,
];


// --- HELPERS ---

const safeLocalStorageGet = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error);
    return defaultValue;
  }
};

const safeLocalStorageSet = (key: string, value: any): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error: any) {
    let specificMessage = `Error setting localStorage key "${key}"`;
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || (error.message && error.message.toLowerCase().includes('quota')))) {
      specificMessage = `Error setting localStorage key "${key}": QUOTA_EXCEEDED_ERROR. Browser's Local Storage is FULL.`;
    }
    console.error(specificMessage, error);
    return false;
  }
};

// --- DATA CLEANUP ---

export const removeAllDataForUser = (email: string): void => {
    if (typeof window === 'undefined' || !email) return;
    console.log(`[LocalStorageService] Removing all data for user: ${email}`);
    for (const baseKey of ALL_USER_SPECIFIC_BASE_KEYS) {
        // Construct the user-specific key and remove it.
        const userKey = `${baseKey}_${email}`;
        window.localStorage.removeItem(userKey);
    }
};

// --- Reading Area Background ---
export const loadReadingAreaBg = (): string => {
    const key = getUserKey(READING_AREA_BG_KEY);
    if (!key) return '#ffffff'; // Default to white color
    return safeLocalStorageGet<string>(key, '#ffffff');
};

export const saveReadingAreaBg = (color: string): boolean => {
    const key = getUserKey(READING_AREA_BG_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, color);
};

// --- PDF Page Index ---
export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  const key = getUserKey(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY);
  if (!key || !docId) return undefined;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(key, {});
  return states[docId];
};
export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): boolean => {
  const key = getUserKey(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY);
  if (!key || !docId) return false;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(key, {});
  states[docId] = pageIndex;
  return safeLocalStorageSet(key, states);
};

// --- EPUB CFI (Location) ---
export const loadCurrentEpubCfiForDoc = (docId: string): string | undefined => {
    const key = getUserKey(EPUB_MANGA_DOCUMENT_CFI_KEY);
    if (!key || !docId) return undefined;
    const states = safeLocalStorageGet<{ [docId: string]: string }>(key, {});
    return states[docId];
};
export const saveCurrentEpubCfiForDoc = (docId: string, cfi: string): boolean => {
    const key = getUserKey(EPUB_MANGA_DOCUMENT_CFI_KEY);
    if (!key || !docId) return false;
    const states = safeLocalStorageGet<{ [docId: string]: string }>(key, {});
    states[docId] = cfi;
    return safeLocalStorageSet(key, states);
};


// TTS Settings (shared)
export const defaultTTSSettings: TTSSettings = {
  type: 'local',
  language: 'en-US',
  rate: 1,
  pitch: 1,
  voiceURI: undefined,
  engine: 'local',
};
export const loadTTSSettings = (): TTSSettings => {
  const key = getUserKey(TTS_SETTINGS_KEY);
  if (!key) return defaultTTSSettings;
  const settings = safeLocalStorageGet<TTSSettings>(key, defaultTTSSettings);
  return { ...defaultTTSSettings, ...settings };
};
export const saveTTSSettings = (settings: TTSSettings): boolean => {
  const key = getUserKey(TTS_SETTINGS_KEY);
  if (!key) return false;
  return safeLocalStorageSet(key, settings);
};

// --- New TTS Settings for Notes Favorites ---
export const loadOriginalTextTTSSettings = (): TTSSettings => {
    const key = getUserKey(NOTE_FAVORITES_ORIGINAL_TTS_SETTINGS_KEY);
    if (!key) return defaultTTSSettings;
    const settings = safeLocalStorageGet<TTSSettings>(key, defaultTTSSettings);
    return { ...defaultTTSSettings, ...settings };
};
export const saveOriginalTextTTSSettings = (settings: TTSSettings): boolean => {
    const key = getUserKey(NOTE_FAVORITES_ORIGINAL_TTS_SETTINGS_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, settings);
};
export const loadYourNoteTTSSettings = (): TTSSettings => {
    const key = getUserKey(NOTE_FAVORITES_NOTE_TTS_SETTINGS_KEY);
    if (!key) return defaultTTSSettings;
    const settings = safeLocalStorageGet<TTSSettings>(key, defaultTTSSettings);
    return { ...defaultTTSSettings, ...settings };
};
export const saveYourNoteTTSSettings = (settings: TTSSettings): boolean => {
    const key = getUserKey(NOTE_FAVORITES_NOTE_TTS_SETTINGS_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, settings);
};


// Favorites Page (Text Snippets) specific storage
export const loadFavoriteItems = (): FavoriteItem[] => {
    const key = getUserKey(FAVORITE_ITEMS_KEY);
    if (!key) return [];
    return safeLocalStorageGet<FavoriteItem[]>(key, []);
};
export const saveFavoriteItems = (items: FavoriteItem[]): boolean => {
    const key = getUserKey(FAVORITE_ITEMS_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, items);
};
export const addFavoriteItem = (item: FavoriteItem): boolean => {
    const items = loadFavoriteItems();
    items.unshift(item); // Add new to the beginning
    return saveFavoriteItems(items);
};
export const deleteFavoriteItem = (itemId: string): boolean => {
    let items = loadFavoriteItems();
    items = items.filter(item => item.id !== itemId);
    return saveFavoriteItems(items);
};

// Notes Favorites (Annotations) specific storage
export const loadNoteFavorites = (): NoteFavoriteItem[] => {
    const key = getUserKey(NOTE_FAVORITES_KEY);
    if (!key) return [];
    return safeLocalStorageGet<NoteFavoriteItem[]>(key, []);
};
export const saveNoteFavorites = (items: NoteFavoriteItem[]): boolean => {
    const key = getUserKey(NOTE_FAVORITES_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, items);
};
export const saveNoteFavorite = (item: NoteFavoriteItem): boolean => {
    const items = loadNoteFavorites();
    // Prevent duplicates by checking ID
    if (items.some(fav => fav.id === item.id)) {
        return true; // Already exists, do nothing
    }
    items.unshift(item); // Add new to the beginning
    return saveNoteFavorites(items);
};
export const deleteNoteFavorite = (annotationId: string): boolean => {
    let items = loadNoteFavorites();
    items = items.filter(item => item.id !== annotationId);
    return saveNoteFavorites(items);
};

// Media Favorites (Audio/Video) specific storage
export const loadMediaFavorites = (): MediaFavoriteItem[] => {
    const key = getUserKey(MEDIA_FAVORITES_KEY);
    if (!key) return [];
    return safeLocalStorageGet<MediaFavoriteItem[]>(key, []);
};
export const saveMediaFavorites = (items: MediaFavoriteItem[]): boolean => {
    const key = getUserKey(MEDIA_FAVORITES_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, items);
};
export const addMediaFavorite = (item: MediaFavoriteItem): boolean => {
    const items = loadMediaFavorites();
    items.unshift(item); // Add new to the beginning
    return saveMediaFavorites(items);
};
export const deleteMediaFavorite = (itemId: string): boolean => {
    let items = loadMediaFavorites();
    items = items.filter(item => item.id !== itemId);
    return saveMediaFavorites(items);
};


// Scratchpad Text and Annotations
export const loadScratchpadText = (): string => {
  const key = getUserKey(SCRATCHPAD_TEXT_KEY);
  if (!key) return '';
  return safeLocalStorageGet<string>(key, '');
};
export const saveScratchpadText = (text: string): boolean => {
  const key = getUserKey(SCRATCHPAD_TEXT_KEY);
  if (!key) return false;
  return safeLocalStorageSet(key, text);
};
export const loadScratchpadAnnotations = (): Annotation[] => {
  const key = getUserKey(SCRATCHPAD_ANNOTATIONS_KEY);
  if (!key) return [];
  return safeLocalStorageGet<Annotation[]>(key, []);
};
export const saveScratchpadAnnotations = (annotations: Annotation[]): boolean => {
  const key = getUserKey(SCRATCHPAD_ANNOTATIONS_KEY);
  if (!key) return false;
  return safeLocalStorageSet(key, annotations);
};
export const clearScratchpad = (): void => {
  const textKey = getUserKey(SCRATCHPAD_TEXT_KEY);
  const annKey = getUserKey(SCRATCHPAD_ANNOTATIONS_KEY);
  if (typeof window === 'undefined') return;
  if(textKey) window.localStorage.removeItem(textKey);
  if(annKey) window.localStorage.removeItem(annKey);
}


// Document Metadata Cache
export const loadDocumentMetadata = (): MangaDocumentDisplayInfo[] => {
  const key = getUserKey(DOC_METADATA_CACHE_KEY);
  if (!key) return [];
  return safeLocalStorageGet<MangaDocumentDisplayInfo[]>(key, []);
};
export const saveDocumentMetadata = (metadata: MangaDocumentDisplayInfo[]): boolean => {
  const key = getUserKey(DOC_METADATA_CACHE_KEY);
  if (!key) return false;
  return safeLocalStorageSet(key, metadata);
};

// TTS Text Size
export const defaultTtsTextSize = 14;
export const loadTtsTextSize = (): number => {
  const key = getUserKey(TTS_TEXT_SIZE_KEY);
  if (!key) return defaultTtsTextSize;
  return safeLocalStorageGet<number>(key, defaultTtsTextSize);
};
export const saveTtsTextSize = (size: number): boolean => {
  const key = getUserKey(TTS_TEXT_SIZE_KEY);
  if (!key) return false;
  return safeLocalStorageSet(key, size);
};

// Remember Me for Login
export const saveRememberedEmail = (email: string): boolean => {
  return safeLocalStorageSet(REMEMBERED_EMAIL_KEY, email);
};
export const getRememberedEmail = (): string | null => {
  return safeLocalStorageGet<string | null>(REMEMBERED_EMAIL_KEY, null);
};
export const clearRememberedEmail = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
};

// Playback Modes
export const loadFavoritesPlaybackMode = (): PlaybackMode => {
    const key = getUserKey(FAVORITES_PLAYBACK_MODE_KEY);
    if (!key) return 'default';
    return safeLocalStorageGet<PlaybackMode>(key, 'default');
};
export const saveFavoritesPlaybackMode = (mode: PlaybackMode): boolean => {
    const key = getUserKey(FAVORITES_PLAYBACK_MODE_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, mode);
};
export const loadNotesPlaybackMode = (): PlaybackMode => {
    const key = getUserKey(NOTES_PLAYBACK_MODE_KEY);
    if (!key) return 'default';
    return safeLocalStorageGet<PlaybackMode>(key, 'default');
};
export const saveNotesPlaybackMode = (mode: PlaybackMode): boolean => {
    const key = getUserKey(NOTES_PLAYBACK_MODE_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, mode);
};
export const loadMediaPlaybackMode = (): PlaybackMode => {
    const key = getUserKey(MEDIA_PLAYBACK_MODE_KEY);
    if (!key) return 'default';
    return safeLocalStorageGet<PlaybackMode>(key, 'default');
};
export const saveMediaPlaybackMode = (mode: PlaybackMode): boolean => {
    const key = getUserKey(MEDIA_PLAYBACK_MODE_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, mode);
};

// --- External literature search cache ---
// Keeps the last search's query + results around so refreshing the library
// page (or navigating away and back) doesn't lose them. This is scoped to
// this browser only, same as everything else in this file.
interface ExternalSearchCache<T> {
    query: string;
    results: T[];
    savedAt: number;
}

export const loadExternalSearchCache = <T,>(): ExternalSearchCache<T> | null => {
    const key = getUserKey(EXTERNAL_SEARCH_CACHE_KEY);
    if (!key) return null;
    return safeLocalStorageGet<ExternalSearchCache<T> | null>(key, null);
};

export const saveExternalSearchCache = <T,>(query: string, results: T[]): boolean => {
    const key = getUserKey(EXTERNAL_SEARCH_CACHE_KEY);
    if (!key) return false;
    return safeLocalStorageSet(key, { query, results, savedAt: Date.now() });
};
