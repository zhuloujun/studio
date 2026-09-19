export interface User {
  email: string;
  passwordHash: string;
}

export interface FailedLoginAttempt {
  count: number;
  firstAttemptTimestamp: number;
  lockedUntil?: number;
}


export interface MangaSubPage { // Primarily for PDF pages rendered as images
  imageDataUrl: string;
  extractedText?: string;
}

export interface Annotation {
  id: string; // Unique ID for the annotation
  targetText: string; // The selected text that was annotated
  startIndex: number; // The character index where the selection starts in the full text
  note: string; // The user's text note
  imageDataUrl?: string; // The optional image for the annotation, as a data URL
  createdAt: number;
  pageNumber?: number; // Which PDF/EPUB page this annotation belongs to
  // A short slice of text immediately before/after targetText at the moment
  // the annotation was created. startIndex alone is fragile across devices:
  // if the same page's text gets re-extracted slightly differently (or the
  // page position isn't synced yet), a raw character offset can point at
  // the wrong occurrence of a common word like "and". Matching against the
  // actual surrounding text instead is robust to that, since it only
  // depends on nearby words still being nearby - not on offsets lining up.
  contextBefore?: string;
  contextAfter?: string;
}

// Base for all stored documents
export interface StoredDocumentBase {
  id: string;
  title: string; // Original file name will be used as title
  fileData: ArrayBuffer; // Store actual file content
  fileUrl?: string; // Streaming URL to fetch/re-fetch the raw bytes from (server-backed documents only)
  originalType: string; // e.g., 'image/png', 'application/pdf', 'application/epub+zip', 'text/plain'
  createdAt: number;
  annotations?: Annotation[]; // Array to hold annotations
}

export interface StoredImageDocument extends StoredDocumentBase {
  type: 'image';
  extractedText?: string; // For OCR'd text
}

export interface StoredPdfDocument extends StoredDocumentBase {
  type: 'pdf';
  numPages?: number;
  ocrTextPerPage?: { [pageNumber: number]: string }; // Added to store OCR text per page
  // The last page read, synced through document metadata (not just
  // browser localStorage) so reopening the same document on a different
  // device lands on the same page instead of showing whatever page that
  // *other* device happened to be on last - previously the reading
  // position was purely per-browser, which made the reader area look like
  // it was showing "different content" across devices when really it was
  // just a different page of the same PDF.
  lastPdfPageNum?: number;
  // For PDF, text extraction will be on-the-fly in the reader or pre-extracted per page if complex.
  // We won't store all 'processedPages' with image data here to save space in IndexedDB.
  // The reader will generate page images as needed.
}

export interface StoredEpubDocument extends StoredDocumentBase {
  type: 'epub';
  // epub.js works directly with the ArrayBuffer (fileData)
}

export interface StoredMobiDocument extends StoredDocumentBase {
  type: 'mobi';
  // Now stores HTML content and TOC
  // Edited TTS-box text per chapter (keyed by spine index), analogous to
  // ocrTextPerPage for PDFs. Edits to the TTS box must NOT overwrite
  // fileData for a MOBI: unlike a .txt file, fileData here is the actual
  // binary MOBI/PalmDB container - replacing it with the edited plain text
  // (as used to happen) destroys the book's structure entirely, so it can
  // no longer be parsed/opened at all afterward.
  mobiTextPerChapter?: { [spineIndex: number]: string };
}

export interface StoredTxtDocument extends StoredDocumentBase {
  type: 'txt';
  // fileData (ArrayBuffer) will be decoded to text in the reader.
}

export interface StoredScratchpadDocument extends StoredDocumentBase {
    type: 'scratchpad';
    // This is a virtual document type, fileData might be empty or hold the text
}


export interface StoredDocxDocument extends StoredDocumentBase {
  type: 'docx';
  // Word documents are parsed to HTML (via mammoth) on open, same pattern as MOBI.
}

export type StoredMangaDocument =
  | StoredImageDocument
  | StoredPdfDocument
  | StoredEpubDocument
  | StoredMobiDocument
  | StoredTxtDocument
  | StoredDocxDocument
  | StoredScratchpadDocument;


export interface TTSSettings {
  type: 'local' | 'cloud';
  voiceURI?: string;
  language: string;
  rate: number;
  pitch: number;
  engine?: 'local' | 'cloud'; // engine can be derived from type, or explicit
  cloudVoiceId?: string; // Add this to store the specific cloud voice ID
}

export interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

export interface FavoriteItem {
  id: string;
  text: string;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
  createdAt: number;
}

export interface NoteFavoriteItem {
    id: string; // Should be the original annotation ID to maintain uniqueness
    annotation: Annotation;
    sourceDocumentId?: string;
    sourceDocumentName?: string;
    favoritedAt: number;
}

export interface MediaFavoriteItem {
  id: string;
  name: string;
  type: 'audio' | 'video';
  fileData: ArrayBuffer; // Populated for freshly-uploaded items; may be empty for items loaded from the list (use fileUrl for playback instead)
  fileUrl?: string; // Streaming URL for playback (preferred over fileData when present)
  originalType: string; // e.g., 'audio/mpeg'
  note: string;
  createdAt: number;
  sourceDocumentName?: string; // e.g., 'Local Upload'
}


// This type might be used by the ReaderPage to hold the currently active document
// It could be identical to StoredMangaDocument or have additional transient reader state
export type ActiveMangaDocument = StoredMangaDocument & {
  // Example of transient state, could be managed within ReaderPage's component state
  // currentPdfPageImage?: string;
  // currentEpubBookInstance?: any; // epub.js Book instance
};

/**
 * A lightweight version of StoredMangaDocument for quick, synchronous loading from localStorage.
 * Contains only the data needed for display in the library list.
 */
export interface MangaDocumentDisplayInfo {
  id: string;
  title: string;
  type: StoredMangaDocument['type'];
  originalType: string;
  createdAt: number;
  numPages?: number;
}

export type PlaybackMode = 'default' | 'loop-single' | 'sequential';
