'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, useContext, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
// Use dynamic imports for epubjs types to avoid build issues
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, FileText, ScanText, Trash2, Edit, Repeat, X, MessageSquarePlus, ImagePlus, Pencil, Expand, Shrink, Menu, Check, Settings, FileEdit, ListTree, Palette } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverClose,
} from "@/components/ui/popover";

import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import { saveFavoriteItemRemote, saveNoteFavoriteRemote } from '@/lib/authService';
import * as IndexedDBService from '@/lib/indexedDBService';
import { initMobiFile, type Mobi, type MobiSpine, type MobiTocItem } from '@lingo-reader/mobi-parser';
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument, StoredMobiDocument, FavoriteItem, Annotation, NoteFavoriteItem } from '@/types';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import DOMPurify from 'dompurify';

const PUNCTUATION_REGEX = /[.,?!,。？！，、\n\r"“„”'‘’`*_{}\[\]()#&@:;~<>/\\|\-—–^%$《》]/g;

// pdf.js's getTextContent() returns text items in the order they were
// written into the PDF's content stream, which for a lot of real-world
// documents - academic papers above all - does NOT match visual reading
// order. Two-column layouts in particular are frequently interleaved
// line-by-line between the left and right column in the stream, so simply
// joining the items in-order produces scrambled text that reads like it
// belongs to a different document entirely. This reconstructs a much closer
// approximation of true reading order: group items into lines by vertical
// position, then split lines into "full width" (titles, captions, single
// column paragraphs) vs. column-width lines, and flatten each left/right
// column band (the run of narrow lines between two full-width lines) in
// top-to-bottom, left-then-right order.
function extractReadableTextFromPdfPage(
  textContent: { items: any[] },
  pageWidth: number
): string {
  type TextItem = { str: string; x: number; y: number; width: number; height: number };

  const items: TextItem[] = textContent.items
    .filter((it: any) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it: any) => ({
      str: it.str as string,
      x: it.transform[4] as number,
      y: it.transform[5] as number,
      width: (it.width as number) || 0,
      height: (it.height as number) || Math.abs((it.transform[3] as number) || 10),
    }));

  if (items.length === 0) return '';
  if (!pageWidth || pageWidth <= 0) {
    // Fall back to plain in-order join if we don't have page dimensions to
    // reason about columns with.
    return items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  }

  // Group items into lines: items whose baseline y is within a small
  // tolerance of each other belong to the same visual line.
  const sortedByY = [...items].sort((a, b) => b.y - a.y);
  const lines: TextItem[][] = [];
  for (const item of sortedByY) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) <= 3);
    if (line) line.push(item);
    else lines.push([item]);
  }
  lines.forEach((line) => line.sort((a, b) => a.x - b.x));

  const joinLine = (line: TextItem[]): string => {
    let result = '';
    let prevEnd: number | null = null;
    for (const item of line) {
      if (prevEnd !== null) {
        const gap = item.x - prevEnd;
        if (gap > item.height * 0.15 && !result.endsWith(' ')) result += ' ';
      }
      result += item.str;
      prevEnd = item.x + item.width;
    }
    return result;
  };

  const columnSplitX = pageWidth / 2;
  const wideThreshold = pageWidth * 0.6;
  const outputLines: string[] = [];
  let pendingLeft: TextItem[][] = [];
  let pendingRight: TextItem[][] = [];

  const flushColumns = () => {
    for (const line of pendingLeft) outputLines.push(joinLine(line));
    for (const line of pendingRight) outputLines.push(joinLine(line));
    pendingLeft = [];
    pendingRight = [];
  };

  for (const line of lines) {
    const minX = line[0].x;
    const last = line[line.length - 1];
    const maxX = last.x + last.width;
    const lineWidth = maxX - minX;

    if (lineWidth >= wideThreshold) {
      flushColumns();
      outputLines.push(joinLine(line));
    } else {
      const centerX = (minX + maxX) / 2;
      if (centerX < columnSplitX) pendingLeft.push(line);
      else pendingRight.push(line);
    }
  }
  flushColumns();

  return outputLines.join('\n').replace(/[ \t]+/g, ' ').trim();
}

type SpeechOrigin = 'main' | 'repeat' | null;

type TtsAreaState = 'hidden' | 'caption' | 'fullscreen';

type TocItem = {
  id: string;
  label: string;
  level: number;
  href: string;
};


const groupVoicesByLanguage = (voices: TTSVoice[]) => {
  return voices.reduce((acc, voice) => {
    const lang = voice.lang || 'Unknown';
    if (!acc[lang]) {
      acc[lang] = [];
    }
    acc[lang].push(voice);
    return acc;
  }, {} as Record<string, TTSVoice[]>);
};

type SelectionForAnnotation = {
  text: string;
  startIndex: number;
} | null;

function ReaderPageComponent({ docId, isMobile }: { docId: string | null; isMobile: boolean | undefined }) {
  const { toast } = useToast();
  const router = useRouter();
  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const readerDict = dictionary.reader;
  const favDict = dictionary.favorites;

  const [activeDoc, setActiveDoc] = useState<ActiveMangaDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);

  const [pdfDocProxy, setPdfDocProxy] = useState<PDFDocumentProxy | null>(null);
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPageImage, setPdfPageImage] = useState<string | null>(null);
  // Continuous-scroll PDF viewing: renders every page up front into this
  // array and displays them stacked in one scrollable column, instead of
  // the single-page-at-a-time view. TTS/OCR text tracking (which the normal
  // per-page view handles) isn't wired up for this mode - it's a pure
  // reading view for people who'd rather scroll through the whole document
  // than click next/prev for every page.
  const [isContinuousScroll, setIsContinuousScroll] = useState(true);
  const [continuousPageImages, setContinuousPageImages] = useState<(string | null)[]>([]);
  const [isRenderingContinuous, setIsRenderingContinuous] = useState(false);
  const [isRenderingPdfPage, setIsRenderingPdfPage] = useState(false);
  const [pdfPageIsTextBased, setPdfPageIsTextBased] = useState(true);
  const [isPdfTextView, setIsPdfTextView] = useState(false);
  const [pdfTextContent, setPdfTextContent] = useState<string | null>(null);
  const [viewScale, setViewScale] = useState(1);

  const [touchStart, setTouchStart] = useState({ x: 0, y: 0 });

  const epubViewerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false);
  const [epubPageIsImage, setEpubPageIsImage] = useState(false);
  const epubImageForOcrRef = useRef<string | null>(null);
  const [epubTotalPages, setEpubTotalPages] = useState(0);
  const [epubCurrentPageNum, setEpubCurrentPageNum] = useState(1);
  const [isEpubPaginating, setIsEpubPaginating] = useState(true);
  const [isEpubReadyForJumping, setIsEpubReadyForJumping] = useState(false);
  const [epubToc, setEpubToc] = useState<any[]>([]); // For EPUB table of contents
  const [isTocOpen, setIsTocOpen] = useState(false);


  const [txtContent, setTxtContent] = useState<string>("");
  const [mobiHtmlContent, setMobiHtmlContent] = useState<string>("");
  const [mobiToc, setMobiToc] = useState<TocItem[]>([]);
  const [docxHtmlContent, setDocxHtmlContent] = useState<string>("");
  const mobiBookRef = useRef<Mobi | null>(null);
  const [mobiSpine, setMobiSpine] = useState<MobiSpine>([]);
  const [mobiCurrentIndex, setMobiCurrentIndex] = useState(0);

  const flattenMobiToc = useCallback((items: MobiTocItem[], level = 1): TocItem[] => {
    const result: TocItem[] = [];
    items.forEach((item, index) => {
      result.push({ id: `mobi-toc-${level}-${index}`, label: item.label, level, href: item.href });
      if (item.children?.length) {
        result.push(...flattenMobiToc(item.children, level + 1));
      }
    });
    return result;
  }, []);

  const loadMobiChapter = useCallback((chapterIndex: number) => {
    const book = mobiBookRef.current;
    if (!book || chapterIndex < 0 || chapterIndex >= mobiSpine.length) return false;
    const chapter = book.loadChapter(mobiSpine[chapterIndex].id);
    if (!chapter) return false;
    setMobiCurrentIndex(chapterIndex);
    setMobiHtmlContent(chapter.html);
    const plainText = new DOMParser().parseFromString(chapter.html, 'text/html').body.textContent || "";
    setCurrentTextForTTS(plainText);
    if (mainHighlightedContentRef.current) mainHighlightedContentRef.current.scrollTop = 0;
    return true;
  }, [mobiSpine]);
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null);
  
  const [scratchpadText, setScratchpadText] = useState<string>('');
  const [scratchpadAnnotations, setScratchpadAnnotations] = useState<Annotation[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastSpokenTextRef = useRef<string>('');

  const [isPerformingOcr, setIsPerformingOcr] = useState(false);
  const [currentTextForTTS, setCurrentTextForTTS] = useState<string>("");
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechOrigin, setSpeechOrigin] = useState<SpeechOrigin>(null);
  const [highlightedSegmentIndex, setHighlightedSegmentIndex] = useState<number>(-1);
  // For the "repeat playback" (重复播放) button: highlights the exact
  // selected character range within currentTextForTTS, since a manual
  // selection rarely lines up with the sentence-level textSegments used
  // for normal playback highlighting.
  const [manualHighlightRange, setManualHighlightRange] = useState<{ start: number; end: number } | null>(null);
  const [ttsTextSize, setTtsTextSize] = useState<number>(LocalStorageService.loadTtsTextSize());
  const [ttsAreaState, setTtsAreaState] = useState<TtsAreaState>('hidden');
  const [isEditingTtsText, setIsEditingTtsText] = useState(false);
  const [isTtsBarVisible, setIsTtsBarVisible] = useState(false);


  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const mainHighlightedContentRef = useRef<HTMLDivElement | null>(null);
  const ttsBoxHighlightedContentRef = useRef<HTMLDivElement | null>(null);


  const isMountedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isPausedRef = useRef(false);
  const segmentIndexRef = useRef(0);
  
  const [selectionForAnnotation, setSelectionForAnnotation] = useState<SelectionForAnnotation>(null);

  const mainTextAreaRef = useRef<HTMLTextAreaElement | null>(null); 
  const ttsBoxTextAreaRef = useRef<HTMLTextAreaElement | null>(null); 

  const [jumpDialogInfo, setJumpDialogInfo] = useState<{
    open: boolean;
    type: 'pdf' | 'epub' | null;
    currentPage: number;
    totalPages: number;
  }>({ open: false, type: null, currentPage: 0, totalPages: 0 });
  const jumpToPageInput = useRef("");

  const [annotationDialog, setAnnotationDialog] = useState({
    open: false,
    id: null as string | null,
    note: '',
    imageDataUrl: '',
    isSaving: false,
  });
  const annotationImageInputRef = useRef<HTMLInputElement | null>(null);
  const [viewingAnnotation, setViewingAnnotation] = useState<Annotation | null>(null);
  const [annotationToDelete, setAnnotationToDelete] = useState<Annotation | null>(null);

  const [readingAreaBg, setReadingAreaBg] = useState<string>(LocalStorageService.loadReadingAreaBg());

  useEffect(() => {
    LocalStorageService.saveReadingAreaBg(readingAreaBg);
  }, [readingAreaBg]);


  const textSegments = useMemo(() => {
    if (!currentTextForTTS) return [];
    const parts = currentTextForTTS.split(/([.?!,。？！，、\n]+)/g);
    const segments = [];
    for (let i = 0; i < parts.length; i += 2) {
      const text = parts[i];
      const delimiter = parts[i + 1] || '';
      if (text || delimiter) {
        segments.push(text + delimiter);
      }
    }
    return segments.filter(s => s.length > 0);
  }, [currentTextForTTS]);
  
  
const getCharPosition = (container: HTMLElement, charIndex: number): { top: number, left: number } | null => {
    if (!container || charIndex < 0) return null;

    const range = document.createRange();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let currentNode: Node | null = null;
    let currentOffset = 0;

    while ((currentNode = walker.nextNode())) {
        const nodeLength = currentNode.textContent?.length || 0;
        if (currentOffset + nodeLength >= charIndex) {
            const finalCharIndexInNode = charIndex - currentOffset;

            // This is the fix: ensure the calculated index is not out of bounds for the current node.
            if (finalCharIndexInNode < 0 || finalCharIndexInNode > nodeLength) {
                console.error(`Calculated invalid index ${finalCharIndexInNode} for node with length ${nodeLength}`);
                // This annotation can't be placed, return null to avoid a crash.
                return null;
            }

            try {
                range.setStart(currentNode, finalCharIndexInNode);
                range.collapse(true);
                const rect = range.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                return {
                    top: rect.top - containerRect.top + container.scrollTop,
                    left: rect.left - containerRect.left + container.scrollLeft,
                };
            } catch (e) {
                console.error(`Error setting range for charIndex ${charIndex}:`, e);
                return null; // Gracefully fail for this annotation
            }
        }
        currentOffset += nodeLength;
    }

    return null; // charIndex is out of bounds
};

// An annotation's `startIndex` is only reliable as long as the surrounding
// text hasn't changed shape since it was created - but it very much can:
// switching a PDF page between extracted-text and OCR'd text, editing the
// TTS box text, or (previously) a non-deterministic text-extraction order
// all shift where a given piece of text now sits. Trusting a stale
// startIndex blindly is exactly what let a note added on "MSTO" end up
// rendered next to unrelated text after a refresh. This re-locates the
// annotation's target text in the current text whenever the stored index no
// longer points at it, and returns null (rather than a wrong guess) when
// the text genuinely isn't there anymore.
function resolveAnnotationPosition(text: string, ann: Annotation): number | null {
    if (!text || !ann.targetText) return null;
    if (ann.startIndex >= 0) {
        const direct = text.substring(ann.startIndex, ann.startIndex + ann.targetText.length);
        if (direct === ann.targetText) return ann.startIndex;
    }
    const idx = text.indexOf(ann.targetText);
    return idx === -1 ? null : idx;
}

const AnnotationMarkers = ({ containerRef, annotations, text }: { containerRef: React.RefObject<HTMLElement>, annotations: Annotation[], text: string }) => {
    const [positions, setPositions] = useState<Record<string, { top: number, left: number } | null>>({});

    useEffect(() => {
        if (containerRef.current && annotations.length > 0 && text) {
            const newPositions: Record<string, { top: number, left: number } | null> = {};
            annotations.forEach(ann => {
                // Use the end of the target text for positioning the marker,
                // resolved against the current text rather than trusting a
                // possibly-stale stored index.
                const resolvedStart = resolveAnnotationPosition(text, ann);
                if (resolvedStart === null) { newPositions[ann.id] = null; return; }
                const finalCharIndex = resolvedStart + ann.targetText.length - 1;
                newPositions[ann.id] = getCharPosition(containerRef.current!, finalCharIndex);
            });
            setPositions(newPositions);
        } else if (annotations.length === 0) {
            setPositions({}); // Clear positions if no annotations
        }
    }, [annotations, containerRef, text]); // Rerun when text changes to re-evaluate positions

    if (annotations.length === 0) return null;

    return (
        <>
            {annotations.map((annotation, index) => {
                const pos = positions[annotation.id];
                if (!pos) return null;

                return (
                    <sup
                        key={annotation.id}
                        className="absolute w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs leading-none cursor-pointer z-10"
                        style={{ top: pos.top, left: pos.left, transform: 'translate(0, -50%)' }}
                        onClick={(e) => { e.stopPropagation(); setViewingAnnotation(annotation); }}
                    >
                        {index + 1}
                    </sup>
                );
            })}
        </>
    );
};

const sortedAnnotations = useMemo(() => {
    const allAnnotations: Annotation[] = activeDoc?.annotations || scratchpadAnnotations;
    
    if (activeDoc?.type === 'pdf' && !isPdfTextView) {
        const pageNum = currentPdfPageNum;
        // Filtering by page number alone isn't enough: if the text shown for
        // this page has since changed (OCR replacing extracted text, a
        // manual edit, etc.) a stale startIndex can land on completely
        // unrelated content. Drop annotations whose target text can no
        // longer be found anywhere in the current page text at all -
        // resolveAnnotationPosition (used by AnnotationMarkers below) will
        // relocate the ones that can still be found but have moved.
        return allAnnotations
            .filter(ann => ann.pageNumber === pageNum && resolveAnnotationPosition(currentTextForTTS, ann) !== null)
            .sort((a, b) => a.startIndex - b.startIndex);
    }

    // For text views (PDF text, EPUB, TXT, Scratchpad)
    const currentText = activeDoc ? currentTextForTTS : scratchpadText;
    if (currentText) {
        return allAnnotations
            // Keep the annotation as long as its text can still be found
            // somewhere in the current text, even if it has shifted position
            // (resolveAnnotationPosition relocates it) - only drop it once
            // the text it was attached to is genuinely gone.
            .filter(ann => resolveAnnotationPosition(currentText, ann) !== null)
            .sort((a, b) => a.startIndex - b.startIndex);
    }

    return [];

}, [activeDoc, scratchpadText, scratchpadAnnotations, currentTextForTTS, currentPdfPageNum, isPdfTextView]);


const getSelectedText = useCallback((): { text: string; startIndex: number | null } => {
    if (typeof window === 'undefined') {
        return { text: '', startIndex: null };
    }

    let activeElement: HTMLTextAreaElement | HTMLDivElement | null = null;
    if (document.activeElement === mainTextAreaRef.current) {
        activeElement = mainTextAreaRef.current;
    } else if (document.activeElement === ttsBoxTextAreaRef.current) {
        activeElement = ttsBoxTextAreaRef.current;
    }

    if (activeElement && 'selectionStart' in activeElement && activeElement.selectionStart !== activeElement.selectionEnd) {
        return {
            text: activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd),
            startIndex: activeElement.selectionStart,
        };
    }
  
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return { text: '', startIndex: null };

    const getSelectionDetails = (container: HTMLElement): { text: string; startIndex: number } | null => {
        if (!selection.rangeCount || !container.contains(selection.anchorNode)) {
            return null;
        }

        const range = selection.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(container);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        
        const startIndex = preSelectionRange.toString().length;
        const text = range.toString();

        return { text, startIndex };
    };

    const mainContainer = mainHighlightedContentRef.current;
    if(mainContainer) {
      const details = getSelectionDetails(mainContainer);
      if (details) return details;
    }

    const ttsContainer = ttsBoxHighlightedContentRef.current;
     if(ttsContainer && ttsContainer.contains(selection.anchorNode)) {
      const details = getSelectionDetails(ttsContainer);
      if (details) return details;
    }
    
    if (activeDoc?.type === 'epub' && epubRenditionRef.current) {
        try {
            const epubWindow = epubRenditionRef.current.getContents()?.[0]?.window;
            if (epubWindow && epubWindow.getSelection()?.toString()) {
                const epubSelection = epubWindow.getSelection();
                if(epubSelection) {
                  return { text: epubSelection.toString(), startIndex: null };
                }
            }
        } catch (e) { console.warn("Could not get selection from EPUB iframe", e); }
    }
  
    return { text: selection.toString(), startIndex: null };
}, [activeDoc?.type]);


  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
    }
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeDoc && !isLoadingDoc) {
      LocalStorageService.saveScratchpadText(scratchpadText);
      LocalStorageService.saveScratchpadAnnotations(scratchpadAnnotations);
    }
  }, [scratchpadText, scratchpadAnnotations, activeDoc, isLoadingDoc]);


  const stopSpeech = useCallback((resetUIState = true) => {
    isSpeakingRef.current = false;
    isPausedRef.current = false;
    if (isMountedRef.current) {
        setHighlightedSegmentIndex(-1);
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
        try { audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
      }
    }
    if (utteranceRef.current) {
      utteranceRef.current.onend = null; utteranceRef.current.onboundary = null; utteranceRef.current.onerror = null; utteranceRef.current = null;
    }
    if (resetUIState && isMountedRef.current) {
      setIsSpeaking(false); setIsPaused(false); setIsLoadingTTS(false); setSpeechOrigin(null);
      setManualHighlightRange(null);
    }
  }, []);

  const updateOcrSourceFromImage = useCallback((imageElement: HTMLImageElement) => {
    if (!isMountedRef.current) return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = imageElement.naturalWidth;
        canvas.height = imageElement.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(imageElement, 0, 0);
            epubImageForOcrRef.current = canvas.toDataURL('image/png');
            setCurrentTextForTTS(readerDict.ocrImage);
        } else {
            throw new Error("Could not get canvas context.");
        }
    } catch (e) {
        console.error("Error creating OCR source from image:", e);
        epubImageForOcrRef.current = null;
        setCurrentTextForTTS("Could not prepare image for OCR.");
    } finally {
        if (isMountedRef.current) {
            setEpubPageIsImage(true);
        }
    }
  }, [readerDict.ocrImage]);

  const processEpubView = useCallback(async (view: any) => {
    if (!isMountedRef.current || !view?.document?.body) {
        return;
    }

    try {
        const contentBody = view.document.body;
        const imageElement = contentBody.querySelector('img') || contentBody.querySelector('image');

        if (imageElement) {
            imageElement.crossOrigin = "anonymous";
            if (imageElement.complete && imageElement.naturalWidth > 0) {
                updateOcrSourceFromImage(imageElement);
            } else {
                setCurrentTextForTTS(readerDict.loadingContent);
                setEpubPageIsImage(true); 
                imageElement.onload = () => updateOcrSourceFromImage(imageElement);
                imageElement.onerror = () => {
                    if (!isMountedRef.current) return;
                    epubImageForOcrRef.current = null;
                    const pageText = (contentBody.innerText || "").trim();
                    setCurrentTextForTTS(pageText || "Could not load image. No fallback text found.");
                    setEpubPageIsImage(false);
                };
            }
        } else { 
            epubImageForOcrRef.current = null;
            const pageText = (contentBody.innerText || "").trim();
            if (isMountedRef.current) {
                setCurrentTextForTTS(pageText || "This page has no text or image content.");
                setEpubPageIsImage(false);
            }
        }
    } catch (error) {
        console.error("Error processing EPUB view:", error);
        if (isMountedRef.current) {
            setCurrentTextForTTS("Error analyzing page content.");
            setEpubPageIsImage(false); 
        }
    }
  }, [updateOcrSourceFromImage, readerDict.loadingContent]);

  useEffect(() => {
    let isStale = false;
    
    const loadDocument = async () => {
      if (!docId) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (isStale) return;
        if (lastActiveId) {
            router.replace(`/reader?docId=${lastActiveId}`, { scroll: false }); 
        } else {
            setActiveDoc(null);
            setIsLoadingDoc(false);
            const savedText = LocalStorageService.loadScratchpadText();
            const savedAnnotations = LocalStorageService.loadScratchpadAnnotations();
            setScratchpadText(savedText);
            setScratchpadAnnotations(savedAnnotations);
            setCurrentTextForTTS(savedText);
        }
        return;
      }

      try {
        const doc = await IndexedDBService.getDocumentById(docId);
        if (isStale) return;

        if (!doc) {
          setDocErrorMessage(`Document with ID "${docId}" not found.`);
          await IndexedDBService.saveLastActiveDocId(null);
          setIsLoadingDoc(false);
          return;
        }
        
        setActiveDoc(doc as ActiveMangaDocument);
        await IndexedDBService.saveLastActiveDocId(docId);
        
        switch (doc.type) {
          case 'pdf':
            setIsLoadingDoc(true);
            try {
              const pdf = await getDocument({
                data: doc.fileData.slice(0),
                // Without these, PDFs using embedded/non-standard fonts or
                // certain embedded images can render with garbled layout or
                // missing content in pdf.js's canvas renderer.
                cMapUrl: '/pdfjs/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: '/pdfjs/standard_fonts/',
              }).promise;
              if (isStale) { try { pdf.destroy(); } catch(e){} return; }

              const pagePromises = [];
              for (let i = 1; i <= pdf.numPages; i++) {
                pagePromises.push(
                  pdf.getPage(i).then(page =>
                    page.getTextContent().then(textContent => {
                      const pageWidth = page.getViewport({ scale: 1 }).width;
                      const text = extractReadableTextFromPdfPage(textContent, pageWidth);
                      page.cleanup();
                      return text;
                    })
                  )
                );
              }
              const pageTexts = await Promise.all(pagePromises);
              if (isStale) { pdf.destroy(); return; }
              const allText = pageTexts.join('\n\n').trim();

              // Always keep the extracted full text around so the manual
              // "switch to text view" button works, but default to the
              // canvas/page-image view for every PDF - that's the only mode
              // that preserves the original visual layout (columns, images,
              // exact positioning). The previous behavior auto-switched to a
              // flattened plain-text view whenever a PDF had "enough" text
              // per page, which silently threw away the original formatting
              // for anything that wasn't a scanned/image-only PDF - not
              // something the reader should decide for the user.
              if (allText.length > 0) {
                setPdfTextContent(allText);
              }
              setIsPdfTextView(false);
              setPdfDocProxy(pdf);
              setPdfTotalPages(pdf.numPages);
              const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(doc.id);
              setCurrentPdfPageNum((savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1);
            } catch (pdfError: any) {
              if (isStale) return;
              console.error("Error processing PDF:", pdfError);
              setDocErrorMessage(`Error processing PDF: ${pdfError.message}`);
            } finally {
              if (isMountedRef.current) setIsLoadingDoc(false);
            }
            break;
          
            case 'epub':
              setIsEpubLoading(true);
              setIsEpubPaginating(true);
              setIsEpubReadyForJumping(false);

              try {
                  const ePubModule = await import('epubjs');
                  const book = ePubModule.default(doc.fileData);
                  epubBookRef.current = book;
            
                  if (isStale) return;
                  if (!epubViewerRef.current) throw new Error("EPUB viewer element not ready.");
            
                  const rendition = book.renderTo("epub-viewer", { width: "100%", height: "100%", flow: "paginated", spread: "none" });
                  epubRenditionRef.current = rendition;

                  rendition.on('displayed', async (view: any) => {
                     await book.ready;
                     const toc = book.navigation.toc;
                     if(isMountedRef.current) setEpubToc(toc);
                  });

                  const generateEpubPagination = async (b: Book) => {
                      if (!isMountedRef.current || isStale) return;
                      try {
                          await b.ready;
                          if (isStale || !isMountedRef.current) return;
                          await b.locations.generate(1650);
                          if (isStale || !isMountedRef.current) return;
                          
                          setEpubTotalPages(b.locations.length());
                          setIsEpubReadyForJumping(true); 
                      } catch (e: any) {
                          if (isStale) return;
                          console.error("EPUB pagination failed:", e.message);
                          setEpubTotalPages(0);
                          setIsEpubReadyForJumping(false); 
                      } finally {
                          if (isMountedRef.current) setIsEpubPaginating(false);
                      }
                  };

                  rendition.on('relocated', (location: any) => {
                      if (!isMountedRef.current || !epubBookRef.current?.locations || !epubBookRef.current.navigation) return;
                      
                      const currentDocId = (activeDoc as ActiveMangaDocument | null)?.id;
                      if (currentDocId) {
                          LocalStorageService.saveCurrentEpubCfiForDoc(currentDocId, location.start.cfi);
                      }

                      if (epubBookRef.current.locations.length() > 0) {
                          const percentage = epubBookRef.current.locations.percentageFromCfi(location.start.cfi);
                          const total = epubTotalPages || epubBookRef.current.locations.length();
                          const pageNum = Math.max(1, Math.round(percentage * total));
                          setEpubCurrentPageNum(pageNum);
                      }
                      
                      processEpubView(epubRenditionRef.current?.getContents()?.[0]);
                  });
                  
                  generateEpubPagination(book);

                  const lastLocation = LocalStorageService.loadCurrentEpubCfiForDoc(doc.id); 
                  await rendition.display(lastLocation || undefined);

              } catch (e: any) {
                  if (isStale) return;
                  console.error("Error processing EPUB:", e);
                  setDocErrorMessage(`Error processing EPUB: ${e.message}`);
              } finally {
                  if (isMountedRef.current) setIsEpubLoading(false);
              }
              setIsLoadingDoc(false);
              break;

          case 'image':
            const imgBlob = new Blob([doc.fileData], { type: doc.originalType });
            const imgUrl = URL.createObjectURL(imgBlob);
            currentImageObjectUrlRef.current = imgUrl;
            setDisplayedImageSrc(imgUrl);
            setCurrentTextForTTS((doc as StoredImageDocument).extractedText || "Image loaded. Perform OCR to extract text.");
            setIsLoadingDoc(false);
            break;
            
          case 'txt':
            const text = new TextDecoder().decode(doc.fileData);
            setTxtContent(text);
            setCurrentTextForTTS(text);
            setIsLoadingDoc(false);
            break;

          case 'mobi':
            try {
                const mobiBook = await initMobiFile(new Uint8Array(doc.fileData.slice(0)));
                if (isStale) { mobiBook.destroy(); return; }
                if (mobiBookRef.current) mobiBookRef.current.destroy();
                mobiBookRef.current = mobiBook;

                const spine = mobiBook.getSpine();
                setMobiSpine(spine);
                setMobiToc(flattenMobiToc(mobiBook.getToc()));

                if (spine.length > 0) {
                    const firstChapter = mobiBook.loadChapter(spine[0].id);
                    if (firstChapter) {
                        setMobiCurrentIndex(0);
                        setMobiHtmlContent(firstChapter.html);
                        const plainText = new DOMParser().parseFromString(firstChapter.html, 'text/html').body.textContent || "";
                        setCurrentTextForTTS(plainText);
                    }
                }
            } catch (mobiError: any) {
                if (isStale) return;
                console.error("Error parsing MOBI:", mobiError);
                setDocErrorMessage(`Error parsing MOBI: ${mobiError.message}`);
            }
            setIsLoadingDoc(false);
            break;

          case 'docx':
            try {
                const mammoth = (await import('mammoth')).default;
                // mammoth preserves paragraphs, headings, bold/italic, lists, tables,
                // and embedded images (as inline data URLs) - this keeps the original
                // Word formatting intact instead of flattening it to plain text.
                const mammothOptions = {
                  arrayBuffer: doc.fileData.slice(0),
                  // mammoth's defaults already map Word's built-in Heading 1-3,
                  // bold/italic/underline, lists, tables, hyperlinks, and
                  // embedded images. This adds a few more common Word styles
                  // it doesn't map by default, so more of the original
                  // structure survives the conversion to HTML.
                  styleMap: [
                    "p[style-name='Title'] => h1.doc-title:fresh",
                    "p[style-name='Subtitle'] => h2.doc-subtitle:fresh",
                    "p[style-name='Heading 4'] => h4:fresh",
                    "p[style-name='Heading 5'] => h5:fresh",
                    "p[style-name='Heading 6'] => h6:fresh",
                    "p[style-name='Quote'] => blockquote:fresh",
                    "p[style-name='Intense Quote'] => blockquote.doc-intense:fresh",
                  ],
                };
                const { value: docxHtml, messages: docxMessages } = await mammoth.convertToHtml(mammothOptions);
                if (docxMessages?.length) {
                  console.warn('[DOCX conversion notes]', docxMessages);
                }
                if (isStale) return;
                setDocxHtmlContent(docxHtml);
                const plainText = new DOMParser().parseFromString(docxHtml, 'text/html').body.textContent || "";
                setCurrentTextForTTS(plainText);
            } catch (docxError: any) {
                if (isStale) return;
                console.error("Error parsing DOCX:", docxError);
                setDocErrorMessage(`Error parsing Word document: ${docxError.message}`);
            }
            setIsLoadingDoc(false);
            break;

          default:
            setIsLoadingDoc(false);
            break;
        }
      } catch (err: any) {
        if (isStale) return;
        console.error("Error loading document:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setIsLoadingDoc(false);
        setActiveDoc(null);
      }
    };
    
    stopSpeech(true);
    setDocErrorMessage(null);
    setActiveDoc(null);
    setIsLoadingDoc(true);
    setTxtContent("");
    setMobiHtmlContent("");
    setMobiToc([]);
    setMobiSpine([]);
    setMobiCurrentIndex(0);
    setDocxHtmlContent("");
    setIsContinuousScroll(true);
    setContinuousPageImages([]);
    setDisplayedImageSrc(null);
    setIsEpubLoading(false);
    setCurrentTextForTTS("");
    setEpubTotalPages(0);
    setEpubCurrentPageNum(1);
    setIsEpubPaginating(true);
    setIsEpubReadyForJumping(false);
    
    
    loadDocument();
    
    return () => {
      isStale = true;
      stopSpeech(true);

      if (pdfDocProxy) {
        try { pdfDocProxy.destroy(); } catch (e) { console.warn("Non-critical error destroying PDF proxy", e); }
        setPdfDocProxy(null);
      }
      if (mobiBookRef.current) {
        try { mobiBookRef.current.destroy(); } catch (e) { console.warn("Non-critical error destroying MOBI book", e); }
        mobiBookRef.current = null;
      }
      setPdfTextContent(null);
      setIsPdfTextView(false);
      
      if (currentImageObjectUrlRef.current) {
        URL.revokeObjectURL(currentImageObjectUrlRef.current);
        currentImageObjectUrlRef.current = null;
      }
      
      if (epubRenditionRef.current) {
        epubRenditionRef.current.destroy();
        epubRenditionRef.current = null;
      }
      if (epubBookRef.current) {
          epubBookRef.current.destroy();
          epubBookRef.current = null;
      }
      if (epubViewerRef.current) {
        epubViewerRef.current.innerHTML = '';
      }
      
      setEpubPageIsImage(false);
      epubImageForOcrRef.current = null;
    };
  }, [docId, router, processEpubView, stopSpeech]);


  useEffect(() => {
    if (activeDoc?.type !== 'pdf' || isPdfTextView || !pdfDocProxy || !currentPdfPageNum) return;

    let isStale = false;
    const renderPage = async () => {
        stopSpeech(true); 
        setIsRenderingPdfPage(true); 
        setPdfPageImage(null); 
        setPdfPageIsTextBased(true); 
        setCurrentTextForTTS(`${readerDict.loadingContent} ${currentPdfPageNum}...`);
        LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

        try {
            const page: PDFPageProxy = await pdfDocProxy.getPage(currentPdfPageNum);
            if (isStale) { if (page) page.cleanup(); return; }
            
            // Render at a resolution that accounts for the device's pixel
            // density and the zoom slider's max (5x), so the page stays
            // sharp instead of being stretched up from a low-res canvas -
            // the earlier fixed 2.0 scale looked visibly blurry on
            // retina/high-DPI screens and at higher zoom levels.
            const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
            const renderScale = 2.5 * dpr;
            const viewport = page.getViewport({ scale: renderScale });
            const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
            canvas.height = viewport.height; canvas.width = viewport.width;
            if (context) {
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
            }
            if (context) await page.render({ canvasContext: context, viewport }).promise;
            if (isStale || !isMountedRef.current) { if (page) page.cleanup(); return; }
            setPdfPageImage(canvas.toDataURL('image/png'));

            const pdfDocFromState = activeDoc as StoredPdfDocument;
            if (pdfDocFromState.ocrTextPerPage?.[currentPdfPageNum]) {
                setCurrentTextForTTS(pdfDocFromState.ocrTextPerPage[currentPdfPageNum]);
                setPdfPageIsTextBased(false);
            } else {
                const textContent = await page.getTextContent();
                const pageWidthPt = page.getViewport({ scale: 1 }).width;
                const pageText = extractReadableTextFromPdfPage(textContent, pageWidthPt);
                if (pageText) {
                    setCurrentTextForTTS(pageText); 
                    setPdfPageIsTextBased(true);
                } else {
                    setCurrentTextForTTS(readerDict.ocrPage); 
                    setPdfPageIsTextBased(false);
                }
            }
            if (page) page.cleanup();
        } catch (e: any) {
            if (isStale || !isMountedRef.current) return;
            setDocErrorMessage(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
        } finally {
            if (isMountedRef.current) { 
                setIsLoadingDoc(false); 
                setIsRenderingPdfPage(false); 
            }
        }
    };

    renderPage();
    return () => { isStale = true; };
  }, [pdfDocProxy, currentPdfPageNum, activeDoc, isPdfTextView, stopSpeech, readerDict.loadingContent, readerDict.ocrPage]);

  // Renders every page up front for continuous-scroll mode. Only runs while
  // that mode is actually on, and bails out cleanly if the user switches
  // pages/documents/back to paged mode mid-render.
  useEffect(() => {
    if (!isContinuousScroll || activeDoc?.type !== 'pdf' || isPdfTextView || !pdfDocProxy || pdfTotalPages < 1) return;

    let isStale = false;
    const renderAll = async () => {
      setIsRenderingContinuous(true);
      setContinuousPageImages(new Array(pdfTotalPages).fill(null));
      const contDpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const renderScale = 1.8 * contDpr; // a bit lower base than the single-page view - rendering every page at once is heavier - but still DPR-aware so pages aren't blurry on retina screens
      for (let pageNum = 1; pageNum <= pdfTotalPages; pageNum++) {
        if (isStale) return;
        try {
          const page: PDFPageProxy = await pdfDocProxy.getPage(pageNum);
          if (isStale) { page.cleanup(); return; }
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          if (context) {
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
          }
          if (context) await page.render({ canvasContext: context, viewport }).promise;
          if (isStale) { page.cleanup(); return; }
          const dataUrl = canvas.toDataURL('image/png');
          setContinuousPageImages((prev) => {
            const next = [...prev];
            next[pageNum - 1] = dataUrl;
            return next;
          });
          page.cleanup();
        } catch (e) {
          console.error(`Error rendering page ${pageNum} for continuous scroll:`, e);
        }
      }
      if (!isStale) setIsRenderingContinuous(false);
    };

    renderAll();
    return () => { isStale = true; };
  }, [isContinuousScroll, pdfDocProxy, activeDoc, isPdfTextView, pdfTotalPages]);


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) {
      toast({ variant: 'destructive', title: readerDict.ocrError, description: readerDict.noActiveDoc });
      return;
    }
    if (!isMountedRef.current) return;
    stopSpeech(true);
    setIsPerformingOcr(true);
    setCurrentTextForTTS(commonDict.loading);

    try {
      let dataUrlToProcess: string | null = null;
      const currentActiveDoc = activeDoc;

      if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
        dataUrlToProcess = pdfPageImage;
      } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id) as StoredImageDocument | null;
        if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) throw new Error('Image data missing from IndexedDB.');
        dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
      } else if (currentActiveDoc.type === 'epub' && epubPageIsImage) {
        dataUrlToProcess = epubImageForOcrRef.current;
        if (!dataUrlToProcess) {
          throw new Error(readerDict.epubOcrMissing);
        }
      }

      if (!dataUrlToProcess) {
        throw new Error(readerDict.noImageData);
      }

      const result = await performOCR(dataUrlToProcess);
      if (!isMountedRef.current) return;

      if ('extractedText' in result) {
        const ocrText = result.extractedText || readerDict.ocrNoText;
        setCurrentTextForTTS(ocrText);
        toast({ title: readerDict.ocrSuccess, description: readerDict.ocrSuccessDesc });

        if (currentActiveDoc.type === 'pdf' || currentActiveDoc.type === 'image') {
          const docFromDB = await IndexedDBService.getDocumentById(currentActiveDoc.id);
          if (docFromDB) {
            let updatedDocForSave: StoredMangaDocument = { ...docFromDB };
            if (updatedDocForSave.type === 'image') {
              (updatedDocForSave as StoredImageDocument).extractedText = ocrText;
            } else if (updatedDocForSave.type === 'pdf' && currentPdfPageNum) {
              const ocrPages = { ...((updatedDocForSave as StoredPdfDocument).ocrTextPerPage || {}), [currentPdfPageNum]: ocrText };
              (updatedDocForSave as StoredPdfDocument).ocrTextPerPage = ocrPages;
              if (isMountedRef.current) setPdfPageIsTextBased(false);
            }
            await IndexedDBService.saveDocument(updatedDocForSave);
            if (isMountedRef.current && activeDoc?.id === updatedDocForSave.id) {
              setActiveDoc(updatedDocForSave as ActiveMangaDocument);
            }
          }
        }
      } else {
        throw new Error(result.error || 'OCR failed with an unknown error.');
      }
    } catch (e: any) {
      if (isMountedRef.current) {
        setCurrentTextForTTS(readerDict.ocrFailed);
        setDocErrorMessage(readerDict.ocrFailedDesc.replace('{message}', e.message));
        toast({ variant: 'destructive', title: readerDict.ocrFailed, description: e.message });
      }
    } finally {
      if (isMountedRef.current) setIsPerformingOcr(false);
    }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast, epubPageIsImage, readerDict, commonDict]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      const engine = loadedSettings.engine || loadedSettings.type || 'local';
      if (isMountedRef.current) {
          const merged = {
              ...loadedSettings,
              engine: engine,
              type: engine
          };
          if (merged.engine === 'cloud' && (!merged.language || !merged.cloudVoiceId)) {
              const defaultLocale = 'en-US';
              merged.language = defaultLocale;
              if (edgeTTSLanguageVoices[defaultLocale].voices.length > 0) {
                merged.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
              }
          }
          setTtsSettings(prev => ({...prev, ...merged}));
      }
    }
  }, []);

  useEffect(() => {
    LocalStorageService.saveTtsTextSize(ttsTextSize);
  }, [ttsTextSize]);

  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis && isMountedRef.current) {
        setAvailableVoices(prevVoices => {
            const newRawVoices = window.speechSynthesis.getVoices();
            const getSignature = (voices: (TTSVoice | SpeechSynthesisVoice)[]) => 
                [...voices].map(v => `${v.voiceURI}|${v.name}|${v.lang}`).sort().join(';');
            
            if (getSignature(prevVoices) === getSignature(newRawVoices)) {
                return prevVoices;
            }
            console.log("[TTS] Voices updated.");
            return newRawVoices.map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
        });
    }
  }, []);

  useEffect(() => {
    populateVoiceList(); 
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList; 
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
      stopSpeech(true);
    };
  }, [populateVoiceList, stopSpeech]);
  
  useEffect(() => {
    if (ttsSettings.engine !== 'local' || availableVoices.length === 0 || !isMountedRef.current) return;

    const currentVoiceIsValid = availableVoices.some(v => v.voiceURI === ttsSettings.voiceURI);

    if (currentVoiceIsValid) {
        const selectedVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (selectedVoice && selectedVoice.lang !== ttsSettings.language) {
             setTtsSettings(prev => ({...prev, language: selectedVoice.lang}));
        }
        return; 
    }
    
    const defaultVoice =
        availableVoices.find(v => v.lang === ttsSettings.language && v.default) || 
        availableVoices.find(v => v.lang === ttsSettings.language) || 
        availableVoices.find(v => v.default && v.lang) || 
        availableVoices[0]; 

    if (defaultVoice) {
        setTtsSettings(prev => ({
            ...prev,
            voiceURI: defaultVoice.voiceURI,
            language: defaultVoice.lang,
        }));
    }
  }, [ttsSettings.engine, ttsSettings.voiceURI, ttsSettings.language, availableVoices]);

  useEffect(() => {
      LocalStorageService.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);


  useEffect(() => {
    let player = new Audio(); 
    audioPlayerRef.current = player;
    const handleAudioEnded = () => {
        if (audioPlayerRef.current === player && isSpeaking && isMountedRef.current) {
          if (ttsSettings.engine === 'local') {
          } else if (ttsSettings.engine === 'cloud' && isSpeakingRef.current) {
            if (speechOrigin === 'repeat') {
              // A one-off "repeat playback" clip finished - just clear the
              // highlight/speaking state, don't continue into main playback.
              isSpeakingRef.current = false;
              setIsSpeaking(false);
              setSpeechOrigin(null);
              setManualHighlightRange(null);
            } else {
              segmentIndexRef.current++;
              if (isMountedRef.current) _startSpeech('main', 0, true);
            }
          }
        }
    };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking && isMountedRef.current) { setIsLoadingTTS(false); } };
    const handleAudioError = () => { if (audioPlayerRef.current === player && isSpeaking && isMountedRef.current) { toast({variant: "destructive", title: readerDict.audioError, description: readerDict.failedToPlay}); stopSpeech(true); } };
    player.addEventListener('ended', handleAudioEnded); player.addEventListener('playing', handleAudioPlaying); player.addEventListener('error', handleAudioError);
    return () => {
        player.removeEventListener('ended', handleAudioEnded); player.removeEventListener('playing', handleAudioPlaying); player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause();
        player.src = "";
        player = null;
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, speechOrigin, stopSpeech, toast, readerDict.audioError, readerDict.failedToPlay]);
  
  const HighlightableContent = React.forwardRef<HTMLDivElement, {
    text: string;
    textSegments: string[];
    highlightedSegmentIndex: number;
    isSpeaking: boolean;
    isPaused: boolean;
    className?: string;
    children?: React.ReactNode;
    isHtml?: boolean;
    // When set (during "repeat playback" of a manual selection), highlights
    // this exact [start, end) character range in `text` instead of the
    // sentence-level segment used for normal playback.
    manualHighlightRange?: { start: number; end: number } | null;
}>(({ text, textSegments, highlightedSegmentIndex, isSpeaking, isPaused, className, children, isHtml, manualHighlightRange }, ref) => {
    if (isHtml) {
        // MOBI is now paginated by chapter (via the mobi-parser library's
        // spine/TOC), not by pixel-width CSS columns - so it renders as a
        // normal scrollable block here, same as DOCX.
        return (
            <div
                ref={ref}
                className={cn(
                    "max-w-none w-full h-full overflow-y-auto select-text relative leading-relaxed " +
                    "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 " +
                    "[&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:indent-8 [&_strong]:font-bold [&_em]:italic " +
                    "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:indent-0 [&_img]:max-w-full [&_img]:h-auto",
                    className
                )}
                dangerouslySetInnerHTML={{ __html: text }}
            />
        );
    }

    let content;
    if (manualHighlightRange && (isSpeaking || isPaused)) {
        const { start, end } = manualHighlightRange;
        if (start < 0 || end <= start || start >= text.length) {
            content = <>{text}</>;
        } else {
            const safeEnd = Math.min(end, text.length);
            content = (
                <>
                    {text.slice(0, start)}
                    <span className="text-green-600 bg-green-600/10">{text.slice(start, safeEnd)}</span>
                    {text.slice(safeEnd)}
                </>
            );
        }
    } else if (isSpeaking || isPaused) {
        if (highlightedSegmentIndex < 0 || !textSegments[highlightedSegmentIndex]) {
            content = <>{text}</>;
        } else {
            let currentIndex = 0;
            content = textSegments.map((segment, index) => {
                const segmentStart = currentIndex;
                const segmentEnd = segmentStart + segment.length;
                currentIndex = segmentEnd;

                if (index === highlightedSegmentIndex) {
                    return <span key={index} className="text-green-600 bg-green-600/10">{segment}</span>;
                }
                return segment;
            });
        }
    } else {
        content = <>{text}</>;
    }

    return (
        <div ref={ref} className={cn("relative w-full h-full", className)}>
            <div className="w-full h-full whitespace-pre-wrap select-text">
                {content}
            </div>
            {children}
        </div>
    );
});
HighlightableContent.displayName = 'HighlightableContent';

  useEffect(() => {
    if (isSpeaking && !isPaused && highlightedSegmentIndex > -1) {
      const scrollContainer = scrollContainerRef.current;
      const contentContainer = mainHighlightedContentRef.current;

      if (scrollContainer && contentContainer) {
          const element = contentContainer.querySelector('span');
          if (element) {
              const elementRect = element.getBoundingClientRect();
              const containerRect = scrollContainer.getBoundingClientRect();
              if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
          }
      }
    }
  }, [highlightedSegmentIndex, isSpeaking, isPaused]);

  useEffect(() => {
    if (isSpeaking && !isPaused && highlightedSegmentIndex > -1) {
      const ttsBoxContainer = ttsBoxHighlightedContentRef.current;

      if (ttsBoxContainer) {
          const element = ttsBoxContainer.querySelector('span');
          if (element) {
              const elementRect = element.getBoundingClientRect();
              const containerRect = ttsBoxContainer.getBoundingClientRect();
              if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
          }
      }
    }
  }, [highlightedSegmentIndex, isSpeaking, isPaused]);


  const _startSpeech = useCallback(async (origin: SpeechOrigin, startIndex = 0, _isContinuing = false) => {
    if (!_isContinuing) {
        const textToPlay = currentTextForTTS?.trim();
        if (!textToPlay) {
            toast({variant: "destructive", title: readerDict.noText, description: readerDict.noTextToRead});
            stopSpeech(true);
            return;
        }
        
        const invalidMessages = ["loading...", "performing ocr..."];
        if(invalidMessages.some(msg => textToPlay.toLowerCase().includes(msg))) {
            toast({variant: "destructive", title: readerDict.cannotPlay, description: readerDict.waitForAction});
            stopSpeech(true);
            return;
        }
        stopSpeech(false);
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        setIsPaused(false);
        isPausedRef.current = false;
        setSpeechOrigin(origin);
        
        // This is the restored logic to handle starting from a selection.
        if (startIndex > 0) {
            let charCount = 0;
            let startSegment = 0;
            for (let i = 0; i < textSegments.length; i++) {
                if (startIndex < charCount + textSegments[i].length) {
                    startSegment = i;
                    break;
                }
                charCount += textSegments[i].length;
            }
            segmentIndexRef.current = startSegment;
        } else {
            segmentIndexRef.current = 0;
        }
    }
    
    if (!isSpeakingRef.current || segmentIndexRef.current >= textSegments.length) {
        if (isMountedRef.current) stopSpeech(true);
        return;
    }
    
    if (isMountedRef.current) setIsLoadingTTS(true);

    const currentIndex = segmentIndexRef.current;
    if (isMountedRef.current) {
      setHighlightedSegmentIndex(currentIndex);
    }
    const segmentText = textSegments[currentIndex].replace(PUNCTUATION_REGEX, ' ').trim();
    
    if (!segmentText) { 
        segmentIndexRef.current++;
        _startSpeech(origin, 0, true);
        return;
    }
    
    if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            toast({ variant: "destructive", title: readerDict.ttsError, description: readerDict.browserNotSupported });
            stopSpeech(true);
            return;
        }
        const utterance = new SpeechSynthesisUtterance(segmentText);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;
        const systemVoices = window.speechSynthesis.getVoices();
        let voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voiceToUse) utterance.voice = voiceToUse;

        utterance.onend = () => {
            if (utteranceRef.current === utterance && isSpeakingRef.current && !isPausedRef.current) {
              segmentIndexRef.current++;
              setTimeout(() => _startSpeech(origin, 0, true), 50); 
            }
        };
        utterance.onerror = (event) => {
            if (isMountedRef.current && event.error !== 'canceled' && event.error !== 'interrupted') {
                console.error("SpeechSynthesis Error:", event.error);
                toast({ variant: "destructive", title: readerDict.ttsError, description: event.error || "An unknown error occurred." });
                stopSpeech(true);
            }
        };
        utteranceRef.current = utterance;
        if(isMountedRef.current) setIsLoadingTTS(false);
        window.speechSynthesis.speak(utterance);
    } else { 
      try {
        const result = await getCloudSpeech(segmentText, ttsSettings.language, ttsSettings.cloudVoiceId);
        if(!isMountedRef.current) return;
        if ('audioUrl' in result && audioPlayerRef.current) {
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play(); 
        } else if ('error' in result) {
            toast({ variant: "destructive", title: readerDict.cloudTtsError, description: result.error });
            if(isMountedRef.current) stopSpeech(true);
        }
      } catch (e: any) {
        if(isMountedRef.current) {
            toast({ variant: "destructive", title: readerDict.cloudTtsFailed, description: e.message });
            stopSpeech(true);
        }
      }
    }
  }, [ttsSettings, stopSpeech, toast, textSegments, currentTextForTTS, readerDict, isSpeaking]);

  const speakTextOnce = useCallback(async (text: string, range?: { start: number; end: number } | null) => {
    stopSpeech(true);

    const cleanedText = text.replace(PUNCTUATION_REGEX, ' ').trim();
    if (!cleanedText) {
        toast({ title: 'No Text to Speak', description: 'Your selection contains only punctuation.' });
        return;
    }

    lastSpokenTextRef.current = cleanedText;
    setIsLoadingTTS(true);
    // Drive the same isSpeaking/isPaused/speechOrigin state main playback
    // uses, so the reading area shows the same green highlight - but with
    // an explicit character range (rather than a segment index) since a
    // manual selection rarely lines up with sentence-level textSegments.
    setSpeechOrigin('repeat');
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;
    setManualHighlightRange(range ?? null);

    const finishRepeat = () => {
        if (!isMountedRef.current) return;
        setIsLoadingTTS(false);
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        setSpeechOrigin(null);
        setManualHighlightRange(null);
    };

    if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            toast({ variant: "destructive", title: readerDict.ttsError, description: readerDict.browserNotSupported });
            finishRepeat(); return;
        }
        const utterance = new SpeechSynthesisUtterance(cleanedText);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;
        const voiceToUse = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voiceToUse) {
            const systemVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceToUse.voiceURI);
            if (systemVoice) utterance.voice = systemVoice;
        }
        utterance.onend = () => { if (utteranceRef.current === utterance) finishRepeat(); };
        utterance.onerror = (event) => {
            if (utteranceRef.current === utterance && isMountedRef.current && event.error !== 'canceled' && event.error !== 'interrupted') {
                toast({ variant: "destructive", title: readerDict.ttsError, description: event.error || "Speech failed." });
            }
            if (utteranceRef.current === utterance) finishRepeat();
        };
        utteranceRef.current = utterance;
        setTimeout(() => { if(isMountedRef.current) window.speechSynthesis.speak(utterance); }, 50);
    } else {
      try {
        const result = await getCloudSpeech(cleanedText, ttsSettings.language, ttsSettings.cloudVoiceId);
        if (!isMountedRef.current) return;
        if ('audioUrl' in result && audioPlayerRef.current) {
          audioPlayerRef.current.src = result.audioUrl;
          await audioPlayerRef.current.play();
          // isLoadingTTS is cleared by the 'playing' listener, and
          // isSpeaking/speechOrigin/manualHighlightRange are cleared by the
          // 'ended' listener (both set up in the audio element effect).
        } else if ('error' in result) {
          toast({ variant: "destructive", title: readerDict.cloudTtsError, description: result.error });
          finishRepeat();
        }
      } catch (error: any) {
        if (!isMountedRef.current) return;
        toast({ variant: "destructive", title: readerDict.cloudTtsFailed, description: error.message });
        finishRepeat();
      }
    }
  }, [ttsSettings, availableVoices, stopSpeech, toast, readerDict.ttsError, readerDict.browserNotSupported, readerDict.cloudTtsError, readerDict.cloudTtsFailed]);

  const playPauseSpeech = () => {
    if (!isMountedRef.current) return;
    
    if (isSpeaking) {
      if (isPaused) {
        isPausedRef.current = false;
        if (ttsSettings.engine === 'local' && window.speechSynthesis) { window.speechSynthesis.resume(); } 
        else { audioPlayerRef.current?.play().catch(() => stopSpeech(true)); }
        setIsPaused(false);
      } else {
        isPausedRef.current = true;
        if (ttsSettings.engine === 'local' && window.speechSynthesis) { window.speechSynthesis.pause(); } 
        else { audioPlayerRef.current?.pause(); }
        setIsPaused(true);
      }
    } else {
      const selectionInfo = getSelectedText();
      const startIndex = selectionInfo?.startIndex ?? 0;
      _startSpeech('main', startIndex);
    }
  };
  
  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    if(!isMountedRef.current) return;
    stopSpeech(true);

    setTtsSettings(prev => {
        let newSettings = { ...prev };

        if (key === 'voiceURI' && value) {
            const selectedVoice = availableVoices.find(v => v.voiceURI === value);
            if (selectedVoice) {
                newSettings.voiceURI = selectedVoice.voiceURI;
                newSettings.language = selectedVoice.lang;
            }
        } else {
            (newSettings[key] as any) = value;
        }
        
        if (key === 'engine') {
            newSettings.type = value as 'local' | 'cloud';
            if (value === 'cloud') {
                const currentLang = newSettings.language;
                const cloudLangData = edgeTTSLanguageVoices[currentLang];
                if (!cloudLangData) {
                    const defaultLocale = 'en-US';
                    newSettings.language = defaultLocale;
                    newSettings.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
                } else if (!newSettings.cloudVoiceId?.startsWith(currentLang)) {
                    newSettings.cloudVoiceId = cloudLangData.voices[0].id;
                }
            } else if (value === 'local') {
                const currentVoice = availableVoices.find(v => v.voiceURI === newSettings.voiceURI);
                if (!currentVoice) {
                    const defaultVoice = availableVoices.find(v => v.default) || availableVoices[0];
                    if (defaultVoice) {
                        newSettings.voiceURI = defaultVoice.voiceURI;
                        newSettings.language = defaultVoice.lang;
                    }
                }
            }
        }
        
        if (key === 'language' && newSettings.engine === 'cloud') {
            const newLang = value as string;
            const langVoices = edgeTTSLanguageVoices[newLang]?.voices;
            if (langVoices && langVoices.length > 0) {
                newSettings.cloudVoiceId = langVoices[0].id;
            } else {
                newSettings.cloudVoiceId = undefined;
            }
        }

        return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    if (!isMountedRef.current) return;
    const selectionInfo = getSelectedText();
    const textToFavorite = selectionInfo.text || currentTextForTTS;
    
    if (textToFavorite) {
      const sourceName = activeDoc ? activeDoc.title : readerDict.scratchpad;
      const sourceId = activeDoc ? activeDoc.id : 'scratchpad';
      saveFavoriteItemRemote({
        id: Date.now().toString(),
        text: textToFavorite,
        sourceDocumentId: sourceId,
        sourceDocumentName: sourceName,
        createdAt: Date.now()
      });
      toast({ title: favDict.title, description: `"${textToFavorite.substring(0, 50)}..." added.` });
    } else {
      toast({ variant: "destructive", title: "No Valid Text to Favorite", description: "Please ensure text is available to be favorited." });
    }
  };

  const navigatePdf = (direction: 'prev' | 'next') => {
    if (isRenderingPdfPage || isLoadingDoc) return;
    
    setCurrentPdfPageNum(prevPageNum => {
        if (!pdfDocProxy) return prevPageNum;

        let newPage = prevPageNum;
        if (direction === 'prev' && prevPageNum > 1) {
            newPage = prevPageNum - 1;
        } else if (direction === 'next' && prevPageNum < pdfTotalPages) {
            newPage = prevPageNum + 1;
        }

        if (newPage !== prevPageNum) {
            stopSpeech(true);
        }
        return newPage;
    });
  };

  const navigateMobi = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'next' ? mobiCurrentIndex + 1 : mobiCurrentIndex - 1;
    loadMobiChapter(newIndex);
  };


  const handleViewScaleChange = (newScale: number) => { 
      if (isRenderingPdfPage || isLoadingDoc) return; 
      stopSpeech(true); 
      setViewScale(newScale); 
  };

  const navigateEpub = async (direction: 'prev' | 'next') => {
    const rendition = epubRenditionRef.current;
    if (!rendition || isEpubLoading || isEpubPaginating) return;
    stopSpeech(true);

    try {
        if (direction === 'prev') {
            await rendition.prev();
        } else {
            await rendition.next();
        }
    } catch (error) {
        console.warn(`[EPUB Nav] Error during rendition.${direction}():`, error);
        toast({ variant: "destructive", title: "EPUB Navigation Error", description: `Failed to turn page.` });
    }
};

  const handleSwitchToScratchpad = async () => {
    stopSpeech(true);
    await IndexedDBService.saveLastActiveDocId(null);
    router.push('/reader');
  };

  const handleClearScratchpad = () => {
    if (!isMountedRef.current || activeDoc) return;
    stopSpeech(true);
    setScratchpadText('');
    setScratchpadAnnotations([]);
    setCurrentTextForTTS('');
    LocalStorageService.clearScratchpad();
    toast({ title: readerDict.scratchpadCleared });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
      setTouchStart({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const touchEndX = e.changedTouches[0].clientX;
    const xDiff = touchStart.x - touchEndX;
    const swipeThreshold = 50; 

    if (Math.abs(xDiff) > swipeThreshold) {
      if (xDiff > 0) { // Swiped left
        if (activeDoc?.type === 'pdf' && !isPdfTextView) navigatePdf('next');
        if (activeDoc?.type === 'epub') navigateEpub('next');
        if (activeDoc?.type === 'mobi') navigateMobi('next');
      } else { // Swiped right
        if (activeDoc?.type === 'pdf' && !isPdfTextView) navigatePdf('prev');
        if (activeDoc?.type === 'epub') navigateEpub('prev');
        if (activeDoc?.type === 'mobi') navigateMobi('prev');
      }
    }
  };

  const getMainButtonState = () => {
    const isContentLoading = isLoadingDoc || isEpubLoading || (activeDoc?.type === 'pdf' && !isPdfTextView && isRenderingPdfPage);

    if (isContentLoading) {
      return { text: readerDict.loading, icon: <Loader2 className="h-4 w-4 animate-spin" />, disabled: true, variant: "outline" as const, title: readerDict.loading };
    }
    if (isLoadingTTS && speechOrigin === 'main') {
      return { text: readerDict.loading, icon: <Loader2 className="h-4 w-4 animate-spin" />, disabled: true, variant: "outline" as const, title: readerDict.loading };
    }

    if (isSpeaking && speechOrigin === 'main') {
      return isPaused 
        ? { text: readerDict.resume, icon: <Play className="h-4 w-4" />, disabled: false, variant: "default" as const, title: readerDict.resume }
        : { text: readerDict.pause, icon: <Pause className="h-4 w-4 text-blue-500" />, disabled: false, variant: "outline" as const, title: readerDict.pause };
    }
    
    if (typeof window !== 'undefined' && window.getSelection()?.toString().trim().length) {
      return { text: readerDict.playSelection, icon: <Play className="h-4 w-4" />, disabled: false, variant: "default" as const, title: readerDict.playSelection }
    }
    
    return { text: readerDict.playText, icon: <Play className="h-4 w-4" />, disabled: false, variant: "default" as const, title: readerDict.playText };
  };

  const openJumpDialog = (type: 'pdf' | 'epub', currentPage: number, totalPages: number) => {
    if (type === 'pdf' && totalPages <= 0) return;
    if (type === 'epub' && !isEpubReadyForJumping) {
      toast({ variant: "default", title: "EPUB Info", description: "Pagination is still calculating. Please try again shortly." });
      return;
    }
    
    setJumpDialogInfo({ open: true, type, currentPage, totalPages });
    jumpToPageInput.current = String(currentPage);
  };
  
  const handleCancelJump = () => {
    jumpToPageInput.current = "";
    setJumpDialogInfo({ open: false, type: null, currentPage: 0, totalPages: 0 });
  };

  const handleConfirmJump = () => {
    const pageNum = parseInt(jumpToPageInput.current, 10);
    const { type, totalPages } = jumpDialogInfo;
  
    if (!type || isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      toast({
        variant: 'destructive',
        title: 'Invalid Page Number',
        description: `Please enter a number between 1 and ${totalPages}.`,
      });
      return;
    }
  
    if (type === 'pdf') {
      if (pageNum !== currentPdfPageNum) {
        stopSpeech(true);
        setCurrentPdfPageNum(pageNum);
      }
    } else if (type === 'epub') {
        const bookInstance = epubBookRef.current;
        if (bookInstance && epubRenditionRef.current && isEpubReadyForJumping && pageNum !== epubCurrentPageNum) {
             const percentage = (pageNum - 1) / totalPages;
            if (typeof percentage === 'number' && percentage >= 0 && percentage <= 1) {
                stopSpeech(true);
                epubRenditionRef.current.display(percentage);
            } else {
                 toast({ variant: "destructive", title: "Jump Failed", description: "Could not find the location for the specified page." });
            }
        }
    }
    handleCancelJump();
  };
  
  const handleOpenAnnotationDialog = () => {
    const selectionInfo = getSelectedText();
    if (!selectionInfo.text.trim()) {
      toast({
        variant: 'destructive',
        title: readerDict.noTextToAnnotate,
        description: readerDict.noTextToAnnotateDesc,
      });
      return;
    }
    if (selectionInfo.startIndex === null) {
      toast({
        variant: 'destructive',
        title: readerDict.selectionError,
        description: readerDict.selectionErrorDesc,
      });
      return;
    }

    setSelectionForAnnotation({
        text: selectionInfo.text,
        startIndex: selectionInfo.startIndex
    });

    setAnnotationDialog({
      open: true,
      id: null,
      note: '',
      imageDataUrl: '',
      isSaving: false,
    });
  };

  const handleAnnotationImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAnnotationDialog((prev) => ({
          ...prev,
          imageDataUrl: event.target?.result as string,
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveAnnotation = async () => {
    setAnnotationDialog((prev) => ({ ...prev, isSaving: true }));
    try {
      if (!selectionForAnnotation || selectionForAnnotation.startIndex === null) {
        throw new Error("Could not get valid selection info to save annotation.");
      }
  
      const { id, note, imageDataUrl } = annotationDialog;
      const { text, startIndex } = selectionForAnnotation;
  
      let pageNum = 1;
       if (activeDoc?.type === 'pdf' && !isPdfTextView) pageNum = currentPdfPageNum;
       else if (activeDoc?.type === 'epub') pageNum = epubCurrentPageNum;

      const newOrUpdatedAnnotation: Annotation = {
        id: id || `ann_${Date.now()}`,
        pageNumber: pageNum,
        targetText: text,
        startIndex: startIndex,
        note,
        imageDataUrl: imageDataUrl || '',
        createdAt: id ? (activeDoc?.annotations?.find(a => a.id === id) || scratchpadAnnotations.find(a => a.id === id))?.createdAt || Date.now() : Date.now(),
      };
  
      if (activeDoc) {
        let updatedAnnotations;
        if (id) {
          updatedAnnotations = (activeDoc.annotations || []).map(ann => ann.id === id ? newOrUpdatedAnnotation : ann);
        } else {
          updatedAnnotations = [...(activeDoc.annotations || []), newOrUpdatedAnnotation];
        }
        const updatedDoc = { ...activeDoc, annotations: updatedAnnotations };
        await IndexedDBService.saveDocument(updatedDoc);
        setActiveDoc(updatedDoc);
      } else {
        let updatedAnnotations;
        if (id) {
          updatedAnnotations = scratchpadAnnotations.map(ann => ann.id === id ? newOrUpdatedAnnotation : ann);
        } else {
          updatedAnnotations = [...scratchpadAnnotations, newOrUpdatedAnnotation];
        }
        setScratchpadAnnotations(updatedAnnotations);
      }
      toast({ title: id ? readerDict.annotationUpdated : readerDict.annotationSaved });
    } catch (e: any) {
      toast({ variant: 'destructive', title: readerDict.failedToSave, description: readerDict.failedToSaveDesc.replace('{message}', e.message) });
    } finally {
      setAnnotationDialog({ open: false, id: null, note: '', imageDataUrl: '', isSaving: false });
      setSelectionForAnnotation(null);
    }
  };
  

  const performDeleteAnnotation = async () => {
    if (!annotationToDelete) return;
    const annotationId = annotationToDelete.id;

    try {
        if (activeDoc) {
            const updatedAnnotations = activeDoc.annotations?.filter(a => a.id !== annotationId);
            const updatedDoc = { ...activeDoc, annotations: updatedAnnotations };
            await IndexedDBService.saveDocument(updatedDoc);
            setActiveDoc(updatedDoc);
        } else {
            const updatedAnnotations = scratchpadAnnotations.filter(a => a.id !== annotationId);
            setScratchpadAnnotations(updatedAnnotations);
        }
        setViewingAnnotation(null);
        toast({ title: readerDict.annotationDeleted });
    } catch (e: any) {
        toast({ variant: 'destructive', title: readerDict.failedToDelete, description: readerDict.failedToDeleteDesc.replace('{message}', e.message) });
    } finally {
        setAnnotationToDelete(null);
    }
  };


  const handleDeleteAnnotation = (annotation: Annotation) => {
    setAnnotationToDelete(annotation);
  };

  const handleFavoriteAnnotation = (annotation: Annotation) => {
    const noteFavorite: NoteFavoriteItem = {
      id: annotation.id,
      annotation: annotation,
      sourceDocumentId: activeDoc?.id || 'scratchpad',
      sourceDocumentName: activeDoc?.title || readerDict.scratchpad,
      favoritedAt: Date.now(),
    }
    saveNoteFavoriteRemote(noteFavorite);
    toast({ title: readerDict.noteFavorited, description: readerDict.noteFavoritedDesc });
  };
  
  const handleEditAnnotation = (annotation: Annotation) => {
    setViewingAnnotation(null);
    setSelectionForAnnotation({
        text: annotation.targetText,
        startIndex: annotation.startIndex
    });
    setAnnotationDialog({
      open: true,
      id: annotation.id,
      note: annotation.note,
      imageDataUrl: annotation.imageDataUrl || '',
      isSaving: false,
    });
  };

  const handleEditTtsText = async () => {
    if (isSpeaking) {
        stopSpeech(true);
    }

    if (isEditingTtsText) {
        if (activeDoc) {
            let updatedDoc = { ...activeDoc };
            let docNeedsSave = false;

            if (updatedDoc.type === 'image') {
                updatedDoc.extractedText = currentTextForTTS;
                docNeedsSave = true;
            } else if (updatedDoc.type === 'pdf' && !isPdfTextView) {
                const pageNum = currentPdfPageNum;
                if (!updatedDoc.ocrTextPerPage) {
                    updatedDoc.ocrTextPerPage = {};
                }
                updatedDoc.ocrTextPerPage[pageNum] = currentTextForTTS;
                docNeedsSave = true;
            } else if (updatedDoc.type === 'txt' || (updatedDoc.type === 'pdf' && isPdfTextView) || updatedDoc.type === 'mobi') {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = currentTextForTTS;
                const textContentForSave = tempDiv.textContent || tempDiv.innerText || '';

                const encoder = new TextEncoder();
                updatedDoc.fileData = encoder.encode(textContentForSave);
                
                docNeedsSave = true;
            }
            
            if (docNeedsSave) {
                try {
                    await IndexedDBService.saveDocument(updatedDoc);
                    setActiveDoc(updatedDoc);
                    toast({ title: "Changes Saved", description: "Your edits have been saved to the local database." });
                } catch (e: any) {
                    toast({ variant: "destructive", title: "Save Error", description: `Could not save changes: ${e.message}` });
                }
            }
        }
    }
    setIsEditingTtsText(!isEditingTtsText);
};
  
  const handleToggleTtsArea = () => {
    setTtsAreaState(currentState => {
        if (currentState === 'hidden') return 'caption';
        if (currentState === 'caption') return 'fullscreen';
        return 'hidden';
    });
  };

  const getTtsAreaIcon = () => {
    if (ttsAreaState === 'fullscreen') return <Shrink className="h-4 w-4" />;
    return <Expand className="h-4 w-4" />;
  };

  const getTtsAreaTitle = () => {
    if (ttsAreaState === 'fullscreen') return readerDict.shrinkTTS;
    return readerDict.expandTTS;
  };

  const handleTocItemClick = (href: string) => {
    if (activeDoc?.type === 'epub' && epubRenditionRef.current) {
        epubRenditionRef.current.display(href);
        setIsTocOpen(false);
    } else if (activeDoc?.type === 'mobi' && mobiBookRef.current) {
        const resolved = mobiBookRef.current.resolveHref(href);
        if (!resolved) {
            console.warn(`Could not resolve MOBI TOC href "${href}".`);
            return;
        }
        const chapterIndex = mobiSpine.findIndex((ch) => ch.id === resolved.id);
        if (chapterIndex < 0) return;

        const loaded = loadMobiChapter(chapterIndex);
        setIsTocOpen(false);
        if (loaded && resolved.selector) {
            // Wait for the new chapter's HTML to actually be in the DOM before
            // trying to scroll to the specific element within it.
            requestAnimationFrame(() => {
                const el = mainHighlightedContentRef.current?.querySelector(resolved.selector);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    }
  };
  
  
  const mainButtonState = getMainButtonState();
  
  const showInitialLoader = isLoadingDoc && !activeDoc && !docErrorMessage;
  const showDocumentError = !!docErrorMessage;
  
  const groupedLocalVoices = groupVoicesByLanguage(availableVoices);

  const mainContent = useMemo(() => {
    if (activeDoc?.type === 'pdf' && isPdfTextView) {
        return (
             <div className="w-full h-full px-3 py-2 text-sm">
                <HighlightableContent
                    ref={mainHighlightedContentRef}
                    text={currentTextForTTS}
                    textSegments={textSegments}
                    highlightedSegmentIndex={highlightedSegmentIndex}
                    isSpeaking={isSpeaking}
                    isPaused={isPaused}
                    manualHighlightRange={manualHighlightRange}
                >
                    <AnnotationMarkers containerRef={mainHighlightedContentRef} annotations={sortedAnnotations} text={currentTextForTTS} />
                </HighlightableContent>
            </div>
        );
    }

    if (activeDoc?.type === 'pdf' && !isPdfTextView && isContinuousScroll) {
        return (
            <div className="w-full h-full overflow-y-auto flex flex-col items-center gap-2 p-2 bg-muted/30">
                {isRenderingContinuous && continuousPageImages.every((img) => !img) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                        <Loader2 className="h-4 w-4 animate-spin" /> 正在准备连续滚动视图...
                    </div>
                )}
                {continuousPageImages.map((img, index) => (
                    <div key={index} className="w-full max-w-3xl bg-background shadow-sm" style={{ transform: `scale(${viewScale})`, transformOrigin: 'top center' }}>
                        {img ? (
                            <img src={img} alt={`Page ${index + 1}`} className="w-full h-auto block" />
                        ) : (
                            <div className="w-full aspect-[1/1.4] flex items-center justify-center text-xs text-muted-foreground border">
                                {readerDict.loadingContent} {index + 1}...
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    }

    if (activeDoc?.type === 'pdf' && !isPdfTextView) {
        return (
            <div className="w-full h-full relative"
                 onTouchStart={handleTouchStart}
                 onTouchMove={handleTouchMove}
                 onTouchEnd={handleTouchEnd}
            >
                {pdfPageImage && (
                    <NextImage
                        src={pdfPageImage}
                        alt={`Page ${currentPdfPageNum}`}
                        layout="fill"
                        objectFit="contain"
                        className="transition-transform duration-200"
                        style={{ 
                            transform: `scale(${viewScale})`,
                            transformOrigin: 'top left',
                        }}
                    />
                )}
            </div>
        );
    }
    
    if (activeDoc?.type === 'epub') {
        const viewerStyle: React.CSSProperties = {
            transform: `scale(${viewScale})`,
            transformOrigin: 'top left',
            transition: 'transform 0.2s ease-out',
            width: `${100 / viewScale}%`,
            height: `${100 / viewScale}%`,
        };
        return (
            <div className="w-full h-full">
                <div id="epub-viewer" ref={epubViewerRef} style={viewerStyle} />
            </div>
        );
    }

    if (activeDoc?.type === 'txt') {
        return (
            <div className="w-full h-full px-3 py-2 text-sm">
                <HighlightableContent
                    ref={mainHighlightedContentRef}
                    text={currentTextForTTS}
                    textSegments={textSegments}
                    highlightedSegmentIndex={highlightedSegmentIndex}
                    isSpeaking={isSpeaking}
                    isPaused={isPaused}
                    manualHighlightRange={manualHighlightRange}
                >
                    <AnnotationMarkers containerRef={mainHighlightedContentRef} annotations={sortedAnnotations} text={currentTextForTTS} />
                </HighlightableContent>
            </div>
        );
    }

    if (activeDoc?.type === 'mobi') {
        return (
             <HighlightableContent
                ref={mainHighlightedContentRef}
                text={mobiHtmlContent}
                textSegments={textSegments}
                highlightedSegmentIndex={highlightedSegmentIndex}
                isSpeaking={isSpeaking}
                isPaused={isPaused}
                isHtml={true}
                className="p-4 md:p-6"
              >
                <AnnotationMarkers containerRef={mainHighlightedContentRef} annotations={sortedAnnotations} text={currentTextForTTS} />
            </HighlightableContent>
        );
    }

    if (activeDoc?.type === 'docx') {
        return (
             <HighlightableContent
                ref={mainHighlightedContentRef}
                text={docxHtmlContent}
                textSegments={textSegments}
                highlightedSegmentIndex={highlightedSegmentIndex}
                isSpeaking={isSpeaking}
                isPaused={isPaused}
                isHtml={true}
                className="p-4 md:p-6 max-w-none leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-2 [&_h4]:text-base [&_h4]:font-bold [&_h4]:mt-3 [&_h4]:mb-1 [&_h5]:text-base [&_h5]:font-semibold [&_h6]:text-sm [&_h6]:font-semibold [&_p]:mb-3 [&_p]:indent-8 [&_strong]:font-bold [&_em]:italic [&_u]:underline [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_li]:indent-0 [&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-3 [&_table]:border-collapse [&_table]:mb-3 [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:bg-muted [&_th]:font-semibold [&_img]:max-w-full [&_img]:h-auto [&_img]:my-3 [&_hr]:my-4"
              >
                <AnnotationMarkers containerRef={mainHighlightedContentRef} annotations={sortedAnnotations} text={currentTextForTTS} />
            </HighlightableContent>
        );
    }

    if (activeDoc?.type === 'image') {
        return (
            <div className="w-full h-full flex items-center justify-center">
                {displayedImageSrc && (
                    <NextImage
                        src={displayedImageSrc}
                        alt={activeDoc.title || 'Uploaded Image'}
                        width={800}
                        height={600}
                        style={{ 
                            objectFit: 'contain', 
                            width: 'auto', 
                            height: 'auto', 
                            maxHeight: '100%', 
                            maxWidth: '100%',
                            transform: `scale(${viewScale})`,
                            transformOrigin: 'top left',
                            transition: 'transform 0.2s ease-out'
                        }}
                        className="shadow-lg border rounded-md"
                        data-ai-hint="illustration abstract"
                    />
                )}
            </div>
        );
    }
    
    // Scratchpad View
    if (!activeDoc) {
      return (
        <Card className="flex-grow flex flex-col h-full">
            <CardHeader>
                <CardTitle>{readerDict.scratchpad}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow">
                <Textarea
                    ref={mainTextAreaRef}
                    value={scratchpadText}
                    onChange={(e) => {
                        setScratchpadText(e.target.value);
                        setCurrentTextForTTS(e.target.value);
                    }}
                    className="w-full h-full resize-none bg-background text-foreground text-sm"
                    placeholder={readerDict.scratchpadPlaceholder}
                />
            </CardContent>
        </Card>
      );
    }

    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc, isPdfTextView, pdfPageImage, currentPdfPageNum, displayedImageSrc, docId, currentTextForTTS, textSegments, highlightedSegmentIndex, isSpeaking, isPaused, readerDict.scratchpadPlaceholder, sortedAnnotations, scratchpadText, mobiHtmlContent, docxHtmlContent, viewScale, isContinuousScroll, continuousPageImages, isRenderingContinuous]);

  if (showInitialLoader) { 
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">{readerDict.loadingDocument}</p></div>; 
  }
  
  return (
    <>
      <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)] overflow-hidden relative">
         <div 
            className="flex-grow flex flex-col p-2 md:p-4 min-h-0 min-w-0 h-full"
        >
             {activeDoc ? (
            <Card className="flex-grow flex flex-col min-h-0 shadow-inner relative transition-all duration-300"
                style={{
                  height: ttsAreaState === 'hidden' ? '100%' : (ttsAreaState === 'caption' ? 'calc(100% - 6rem)' : '0'),
                  opacity: ttsAreaState === 'fullscreen' ? 0 : 1,
                  visibility: ttsAreaState === 'fullscreen' ? 'hidden' : 'visible',
                  backgroundColor: readingAreaBg
                }}
            >
                <CardContent
                  ref={scrollContainerRef}
                  className="flex-grow p-0 overflow-auto relative"
                >
                {(isLoadingDoc || isEpubLoading || isRenderingPdfPage) && ttsAreaState === 'hidden' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="ml-3">{readerDict.loadingContent}</p>
                  </div>
                )}
                {showDocumentError && (
                  <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-20 flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm">{readerDict.docDisplayIssue}</p>
                      <p className="text-xs">{docErrorMessage}</p>
                      <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => setDocErrorMessage(null)}>{readerDict.dismiss}</Button>
                    </div>
                  </div>
                )}
                
                <div
                    className="w-full h-full flex items-center justify-center"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    style={{
                        width: viewScale > 1 ? `${viewScale * 100}%` : '100%',
                        height: viewScale > 1 ? `${viewScale * 100}%` : '100%',
                    }}
                  >
                   {mainContent}
                </div>
                </CardContent>
            </Card>
             ) : (
                 mainContent
            )}
        </div>
        
        <div
            className={cn(
                "absolute bottom-0 left-0 right-0 p-2 md:p-4 transition-all duration-300 z-20",
                ttsAreaState === 'hidden' ? "h-0 opacity-0 invisible" : "",
                ttsAreaState === 'caption' ? "h-28" : "",
                ttsAreaState === 'fullscreen' ? "h-full bg-background/95 backdrop-blur-sm" : ""
            )}
        >
            <Card className="flex-grow flex flex-col min-h-0 h-full" style={{ backgroundColor: readingAreaBg }}>
                <CardContent className="flex-grow p-2 overflow-auto">
                    <div className="w-full h-full whitespace-pre-wrap select-text overflow-y-auto" style={{ fontSize: `${ttsTextSize}px` }}>
                        {isEditingTtsText ? (
                            <Textarea
                            ref={ttsBoxTextAreaRef}
                            value={currentTextForTTS}
                            onChange={(e) => setCurrentTextForTTS(e.target.value)}
                            className="w-full h-full resize-none bg-background text-foreground"
                            autoFocus
                            />
                        ) : (
                             <HighlightableContent
                                ref={ttsBoxHighlightedContentRef}
                                text={activeDoc?.type === 'mobi' ? currentTextForTTS : currentTextForTTS}
                                textSegments={textSegments}
                                highlightedSegmentIndex={highlightedSegmentIndex}
                                isSpeaking={isSpeaking}
                                isPaused={isPaused}
                                manualHighlightRange={manualHighlightRange}
                                isHtml={false} // TTS area should always be plain text
                            >
                               <AnnotationMarkers containerRef={ttsBoxHighlightedContentRef} annotations={sortedAnnotations} text={currentTextForTTS} />
                            </HighlightableContent>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>

        <motion.div
            drag
            dragMomentum={false}
            className="absolute bottom-4 left-4 z-30"
        >
            <Button 
                className="h-12 w-12 rounded-full shadow-lg"
                size="icon"
                onClick={() => setIsTtsBarVisible(v => !v)}
                >
                    <Settings className="h-6 w-6" />
            </Button>
        </motion.div>
        
        <AnimatePresence>
        {isTtsBarVisible && (
            <motion.div
                drag
                dragMomentum={false}
                className="absolute bottom-4 right-4 z-30"
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
                <div className="flex items-center gap-1 flex-wrap justify-end p-2 bg-background/80 backdrop-blur-sm rounded-lg border shadow-lg cursor-move">
                    <Button 
                        onClick={playPauseSpeech} 
                        disabled={mainButtonState.disabled || isEditingTtsText} 
                        variant={mainButtonState.variant}
                        size="icon"
                        className={cn("h-9 w-9", mainButtonState.variant === "outline" && "border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950")}
                        title={mainButtonState.title}
                    >
                        {mainButtonState.icon}
                    </Button>
                    <Button onClick={handleFavoriteSelection} variant="outline" size="icon" className="h-9 w-9 border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950" title={readerDict.favorite} disabled={isEditingTtsText}>
                        <Star className="h-4 w-4 text-amber-500" />
                    </Button>
                    <Button 
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            const selection = getSelectedText();
                            const trimmedSelection = selection.text.trim();
                            const textToSpeak = trimmedSelection || lastSpokenTextRef.current;
                            if (textToSpeak) {
                                // Only a live selection (with a known offset into the
                                // reading text) can be highlighted precisely; the
                                // lastSpokenTextRef fallback has no reliable position.
                                let range: { start: number; end: number } | null = null;
                                if (trimmedSelection && selection.startIndex !== null) {
                                    const leadingWhitespace = selection.text.length - selection.text.trimStart().length;
                                    const start = selection.startIndex + leadingWhitespace;
                                    range = { start, end: start + trimmedSelection.length };
                                }
                                speakTextOnce(textToSpeak, range);
                            } else {
                                toast({ title: readerDict.noSelection, description: readerDict.selectToRepeat });
                            }
                        }}
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950"
                        disabled={isLoadingTTS || isEditingTtsText}
                        title={readerDict.repeat}
                    >
                        <Repeat className="h-4 w-4 text-purple-500" />
                    </Button>
                    <Button
                        onClick={handleToggleTtsArea}
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950"
                        title={getTtsAreaTitle()}
                    >
                        {React.cloneElement(getTtsAreaIcon(), { className: "h-4 w-4 text-teal-500" })}
                    </Button>
                    <Button
                        onClick={handleOpenAnnotationDialog}
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 border-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950"
                        title={readerDict.addAnnotation}
                        disabled={isEditingTtsText}
                    >
                        <MessageSquarePlus className="h-4 w-4 text-pink-500" />
                    </Button>
                    <Button
                        onClick={handleEditTtsText}
                        size="icon"
                        variant={isEditingTtsText ? "default" : "outline"}
                        className={isEditingTtsText ? "h-9 w-9" : "h-9 w-9 border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950"}
                        title={isEditingTtsText ? "Confirm Changes" : "Edit TTS Text"}
                    >
                        {isEditingTtsText ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4 text-orange-500" />}
                    </Button>
                    {((activeDoc?.type === 'pdf' && !isPdfTextView && pdfPageImage && !isRenderingPdfPage && !pdfPageIsTextBased) || 
                      (activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc) || 
                      (activeDoc?.type === 'epub' && epubPageIsImage && !isLoadingDoc)) && (
                        <Button
                            onClick={handlePerformOcr}
                            disabled={isPerformingOcr || isEditingTtsText}
                            size="icon"
                            variant="outline"
                            className="h-9 w-9 border-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950"
                            title={activeDoc?.type === 'image' ? readerDict.ocrImage : readerDict.ocrPage}
                        >
                            {isPerformingOcr ? <Loader2 className="h-4 w-4 animate-spin text-cyan-500" /> : <ScanText className="h-4 w-4 text-cyan-500" />}
                        </Button>
                    )}
                    {(activeDoc?.type === 'epub' && epubToc.length > 0 || activeDoc?.type === 'mobi' && mobiToc.length > 0) && (
                        <Popover open={isTocOpen} onOpenChange={setIsTocOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="icon" className="h-9 w-9 border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950" title="Table of Contents">
                                    <ListTree className="h-4 w-4 text-indigo-500" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-0" align="end">
                                <Card className="bg-white">
                                    <PopoverClose className="absolute right-2 top-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                                        <X className="h-4 w-4" />
                                        <span className="sr-only">Close</span>
                                    </PopoverClose>
                                    <CardHeader>
                                        <CardTitle>{readerDict.docTitle}: {activeDoc.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="max-h-80 overflow-y-auto">
                                        <ul className="space-y-1">
                                             {(activeDoc?.type === 'epub' ? epubToc : mobiToc).map((item, index) => (
                                                <li key={index} style={{ paddingLeft: `${(item.level - 1) * 1}rem` }}>
                                                    <Button
                                                        variant="link"
                                                        className="p-0 h-auto text-left whitespace-normal text-blue-600"
                                                        onClick={() => handleTocItemClick(item.href || item.id)}
                                                    >
                                                        {item.label.trim()}
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    </CardContent>
                                </Card>
                            </PopoverContent>
                        </Popover>
                    )}
                    <Popover>
                        <PopoverTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9 border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950" title="Document Actions">
                            <BookOpen className="h-4 w-4 text-blue-500" />
                            <span className="sr-only">Document Actions</span>
                        </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 bg-background" align="end">
                        <PopoverClose className="absolute right-2 top-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                            <X className="h-4 w-4" />
                            <span className="sr-only">Close</span>
                        </PopoverClose>
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <p className="text-sm font-medium truncate">{activeDoc?.title || readerDict.scratchpad}</p>
                                <p className="text-xs text-muted-foreground">
                                {activeDoc ? `${readerDict.docType.replace('{type}', activeDoc.type?.toUpperCase() || '')}` : readerDict.customInput}
                                </p>
                            </div>
                            
                            {(activeDoc?.type === 'pdf' && !isPdfTextView || activeDoc?.type === 'mobi') && (
                                <>
                                <Separator/>
                                <div className="flex items-center justify-between">
                                    <Button onClick={() => activeDoc?.type === 'pdf' ? navigatePdf('prev') : navigateMobi('prev')} disabled={isLoadingDoc || isRenderingPdfPage || (activeDoc?.type === 'pdf' ? currentPdfPageNum <= 1 : mobiCurrentIndex <= 0)} size="icon" variant="outline" aria-label="Previous Page"><ChevronLeft className="h-4 w-4"/></Button>
                                    {activeDoc?.type === 'pdf' && pdfTotalPages > 0 && 
                                        <Button variant="ghost" className="h-9 tabular-nums bg-yellow-200 hover:bg-yellow-300" onClick={() => openJumpDialog('pdf', currentPdfPageNum, pdfTotalPages)}>
                                            {currentPdfPageNum} / {pdfTotalPages}
                                        </Button>
                                    }
                                    {activeDoc?.type === 'mobi' && mobiSpine.length > 0 && <span className="text-sm text-muted-foreground tabular-nums">{mobiCurrentIndex + 1} / {mobiSpine.length}</span>}
                                    <Button onClick={() => activeDoc?.type === 'pdf' ? navigatePdf('next') : navigateMobi('next')} disabled={isLoadingDoc || isRenderingPdfPage || (activeDoc?.type === 'pdf' ? currentPdfPageNum >= pdfTotalPages : mobiCurrentIndex >= mobiSpine.length - 1)} size="icon" variant="outline" aria-label="Next Page"><ChevronRight className="h-4 w-4"/></Button>
                                </div>
                                </>
                            )}
                            {activeDoc?.type === 'epub' && (
                                <>
                                <Separator/>
                                <div className="flex items-center justify-between">
                                    <Button onClick={() => navigateEpub('prev')} size="icon" variant="outline" disabled={isEpubLoading || isEpubPaginating} aria-label="Previous Page"><ChevronLeft className="h-4 w-4"/></Button>
                                    {isEpubPaginating ? (
                                    <span className="text-sm text-muted-foreground px-2 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {readerDict.pageInfoLoading}</span>
                                    ) : epubTotalPages > 0 ? (
                                    <Button variant="ghost" className="h-9 tabular-nums bg-yellow-200 hover:bg-yellow-300" onClick={() => openJumpDialog('epub', epubCurrentPageNum, epubTotalPages)}>
                                        {epubCurrentPageNum} / {epubTotalPages}
                                    </Button>
                                    ) : (
                                    <span className="text-sm text-muted-foreground px-2">{readerDict.noPageInfo}</span>
                                    )}
                                    <Button onClick={() => navigateEpub('next')} size="icon" variant="outline" disabled={isEpubLoading || isEpubPaginating} aria-label="Next Page"><ChevronRight className="h-4 w-4"/></Button>
                                </div>
                                </>
                            )}
                            {(activeDoc?.type && ['pdf', 'image', 'epub'].includes(activeDoc.type)) && (
                                <>
                                <Separator/>
                                <div className="space-y-2">
                                  <Label className="flex items-center gap-2 text-xs"><Palette className="h-4 w-4"/> Background Color</Label>
                                   <div className="flex items-center gap-2">
                                        <input
                                            type="color"
                                            value={readingAreaBg}
                                            onChange={(e) => setReadingAreaBg(e.target.value)}
                                            className="w-8 h-8 p-0 border-none cursor-pointer"
                                            title="Custom Color"
                                        />
                                        {[
                                            { name: 'White', color: '#ffffff' },
                                            { name: 'Beige', color: '#f5f5dc' },
                                            { name: 'Slate', color: '#e2e8f0' },
                                            { name: 'Mint', color: '#f0fdf4' },
                                        ].map(({ name, color }) => (
                                            <Button
                                                key={color}
                                                size="icon"
                                                variant={readingAreaBg === color ? 'default' : 'outline'}
                                                className="h-7 w-7 rounded-full"
                                                style={{ backgroundColor: color }}
                                                onClick={() => setReadingAreaBg(color)}
                                                title={name}
                                            />
                                        ))}
                                    </div>
                                </div>
                                 <Separator/>
                                <div className="flex items-center gap-2">
                                    <Label className="flex-shrink-0 text-xs">Zoom</Label>
                                    <Slider value={[viewScale]} min={0.25} max={5} step={0.25} onValueChange={([val]) => handleViewScaleChange(val)} disabled={isRenderingPdfPage || isLoadingDoc} />
                                </div>
                                </>
                            )}
                            {activeDoc?.type === 'pdf' && (
                                <div className="pt-2 space-y-2">
                                    <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        stopSpeech(true);
                                        setIsPdfTextView(prev => !prev);
                                    }}
                                    disabled={isLoadingDoc || isRenderingPdfPage || !pdfTextContent}
                                    >
                                    {isPdfTextView ? readerDict.switchToImageView : readerDict.switchToTextView}
                                    </Button>
                                    {!isPdfTextView && (
                                        <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => {
                                            stopSpeech(true);
                                            setIsContinuousScroll(prev => !prev);
                                        }}
                                        disabled={isLoadingDoc || !pdfDocProxy}
                                        >
                                        {isContinuousScroll ? '切换到单页翻阅' : '切换到连续滚动阅读'}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                        </PopoverContent>
                    </Popover>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9 border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950" title="Scratchpad Actions">
                                <FileEdit className="h-4 w-4 text-rose-500" />
                                <span className="sr-only">Scratchpad Actions</span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2 space-y-2 bg-background">
                             <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleSwitchToScratchpad} disabled={isLoadingDoc}>
                                <Edit className="mr-2 h-4 w-4" />
                                {readerDict.switchToScratchpad}
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full justify-start"
                                onClick={handleClearScratchpad}
                                disabled={isLoadingDoc || !!activeDoc}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {readerDict.clearScratchpad}
                            </Button>
                        </PopoverContent>
                    </Popover>
                    <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9 border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950" title="TTS Settings">
                        <Settings2 className="h-4 w-4 text-emerald-500" />
                        <span className="sr-only">TTS Settings</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 bg-background" align="end">
                        <PopoverClose className="absolute right-2 top-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                            <X className="h-4 w-4" />
                            <span className="sr-only">Close</span>
                        </PopoverClose>
                        <div className="space-y-4">
                            <div className="space-y-2">
                            <Label htmlFor="tts-engine">{readerDict.ttsEngine}</Label>
                            <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={isSpeaking && !isPaused}>
                                <SelectTrigger id="tts-engine">
                                <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="local"><div className="flex items-center gap-1"><Smartphone className="h-4 w-4" />{readerDict.local}</div></SelectItem>
                                <SelectItem value="cloud"><div className="flex items-center gap-1"><CloudIcon className="h-4 w-4" />{readerDict.cloud}</div></SelectItem>
                                </SelectContent>
                            </Select>
                            </div>
                            {ttsSettings.engine === 'local' && (
                            <div className="space-y-2">
                                <Label htmlFor="tts-voice">{readerDict.voiceLocal}</Label>
                                <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPaused) || availableVoices.length === 0}>
                                <SelectTrigger id="tts-voice">
                                    <SelectValue placeholder={availableVoices.length > 0 ? readerDict.selectVoice : readerDict.noLocalVoices} />
                                </SelectTrigger>
                                <SelectContent className="max-h-60">
                                    {availableVoices.length === 0 ? (
                                    <SelectItem value="no-voices" disabled>{readerDict.noLocalVoices}</SelectItem>
                                    ) : (
                                    Object.entries(groupedLocalVoices).map(([lang, voices]) => (
                                        <SelectGroup key={lang}>
                                        <SelectLabel>{lang}</SelectLabel>
                                        {voices.map(voice => (
                                            <SelectItem key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</SelectItem>
                                        ))}
                                        </SelectGroup>
                                    ))
                                    )}
                                </SelectContent>
                                </Select>
                            </div>
                            )}
                            {ttsSettings.engine === 'cloud' && (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="cloud-tts-language">{readerDict.languageCloud}</Label>
                                    <Select value={ttsSettings.language} onValueChange={(v) => handleSettingChange('language', v as string)} disabled={isSpeaking && !isPaused}>
                                        <SelectTrigger id="cloud-tts-language"><SelectValue placeholder={readerDict.selectLanguage} /></SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {Object.entries(edgeTTSLanguageVoices).map(([locale, { language }]) => (
                                                <SelectItem key={locale} value={locale}>{language} ({locale})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="cloud-tts-voice">{readerDict.voiceCloud}</Label>
                                    <Select value={ttsSettings.cloudVoiceId || ""} onValueChange={(v) => handleSettingChange('cloudVoiceId', v)} disabled={(isSpeaking && !isPaused) || !ttsSettings.language}>
                                        <SelectTrigger id="cloud-tts-voice"><SelectValue placeholder={readerDict.selectVoice} /></SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {(edgeTTSLanguageVoices[ttsSettings.language]?.voices || []).map(voice => (
                                                <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                            )}
                            <div className="space-y-2">
                            <Label htmlFor="tts-rate">{readerDict.rate.replace('{rate}', ttsSettings.rate.toFixed(1))}</Label>
                            <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isSpeaking && !isPaused} />
                            </div>
                            <div className="space-y-2">
                            <Label htmlFor="tts-pitch">{readerDict.pitch.replace('{pitch}', ttsSettings.pitch.toFixed(1))}</Label>
                            <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isSpeaking && !isPaused} />
                            </div>
                            <div className="space-y-2">
                            <Label htmlFor="tts-font-size" className="text-sm">{readerDict.fontSize.replace('{size}', ttsTextSize.toString())}</Label>
                            <Slider
                                id="tts-font-size"
                                min={10}
                                max={32}
                                step={1}
                                value={[ttsTextSize]}
                                onValueChange={([v]) => setTtsTextSize(v)}
                            />
                            </div>
                        </div>
                    </PopoverContent>
                    </Popover>
                </div>
            </motion.div>
        )}
        </AnimatePresence>
      </div>

      <AlertDialog open={jumpDialogInfo.open} onOpenChange={(isOpen) => !isOpen && handleCancelJump()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{readerDict.jumpDialogTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {readerDict.jumpDialogDescription.replace('{totalPages}', jumpDialogInfo.totalPages.toString())}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <Input
                type="number"
                defaultValue={jumpToPageInput.current}
                onChange={(e) => jumpToPageInput.current = e.target.value}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirmJump()}
                placeholder={readerDict.jumpDialogInputPlaceholder.replace('{totalPages}', jumpDialogInfo.totalPages.toString())}
                className="text-center"
                autoFocus
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancelJump}>{commonDict.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmJump}>{readerDict.jump}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={annotationDialog.open}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setAnnotationDialog((p) => ({ ...p, open: false }));
              setSelectionForAnnotation(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{annotationDialog.id ? readerDict.editAnnotationTitle : readerDict.addAnnotationTitle}</DialogTitle>
              <DialogDescription>
                {readerDict.addAnnotationDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="annotation-note">{readerDict.yourNote}</Label>
                <Textarea
                  id="annotation-note"
                  placeholder={readerDict.notePlaceholder}
                  value={annotationDialog.note}
                  onChange={(e) => setAnnotationDialog((p) => ({ ...p, note: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="annotation-image">{readerDict.attachImage}</Label>
                <Input
                  id="annotation-image"
                  type="file"
                  accept="image/*"
                  ref={annotationImageInputRef}
                  onChange={handleAnnotationImageUpload}
                />
              </div>
              {annotationDialog.imageDataUrl && (
                <div className="relative group">
                  <p className="text-sm font-medium mb-1">{readerDict.imagePreview}</p>
                  <img src={annotationDialog.imageDataUrl} alt="Annotation preview" className="max-h-32 rounded-md border" />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      setAnnotationDialog((p) => ({ ...p, imageDataUrl: '' }));
                      if(annotationImageInputRef.current) annotationImageInputRef.current.value = "";
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <DialogFooter>
               <DialogClose asChild><Button variant="outline">{commonDict.cancel}</Button></DialogClose>
              <Button onClick={handleSaveAnnotation} disabled={annotationDialog.isSaving}>
                {annotationDialog.isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {readerDict.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!viewingAnnotation} onOpenChange={(isOpen) => !isOpen && setViewingAnnotation(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{readerDict.annotationDetailsTitle}</DialogTitle>
              <DialogDescription>
                {readerDict.noteFor.replace('{text}', viewingAnnotation?.targetText || '')}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {viewingAnnotation?.note && (
                <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-sm whitespace-pre-wrap">{viewingAnnotation.note}</p>
                </div>
              )}
              {viewingAnnotation?.imageDataUrl && (
                <div>
                    <img src={viewingAnnotation.imageDataUrl} alt="Annotation attachment" className="rounded-md border max-w-full" />
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
                <Button variant="outline" size="sm" onClick={() => {
                  if (viewingAnnotation) {
                    handleEditAnnotation(viewingAnnotation);
                  }
                }}>
                    <Pencil className="mr-2 h-4 w-4" /> {readerDict.edit}
                </Button>
                <Button variant="outline" size="sm" onClick={() => viewingAnnotation && handleFavoriteAnnotation(viewingAnnotation)}>
                  <Star className="mr-2 h-4 w-4" /> {readerDict.favoriteNote}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => viewingAnnotation && handleDeleteAnnotation(viewingAnnotation)}>
                  <Trash2 className="mr-2 h-4 w-4" /> {readerDict.delete}
                </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!annotationToDelete} onOpenChange={(isOpen) => !isOpen && setAnnotationToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
              <AlertDialogTitle>{readerDict.confirmDeleteAnnotationTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                  {readerDict.confirmDeleteAnnotationDesc.replace('{text}', annotationToDelete?.targetText || '')}
              </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
              <AlertDialogCancel>{commonDict.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={performDeleteAnnotation}>
                  {commonDict.continue}
              </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  );
}


function ReaderContent() {
    const searchParams = useSearchParams();
    const docId = searchParams.get('docId');
    const isMobile = useIsMobile();

    return (
        <AuthGuard>
            <ReaderPageComponent docId={docId} isMobile={isMobile} />
        </AuthGuard>
    )
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">加载中...</p></div>}>
      <ReaderContent />
    </Suspense>
  );
}
