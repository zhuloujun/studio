
"use client";

import { useState, useEffect, useRef, useContext } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, Info, Trash2, BookOpen, FileText, Image as ImageIcon, RefreshCw, Loader2, Save, FileType2, Book, Search, ExternalLink, Star, Download } from 'lucide-react';
import * as IndexedDBService from '@/lib/indexedDBService';
import { getLibraryLink } from '@/lib/authService';
import * as LocalStorageService from '@/lib/localStorageService';
import type { StoredMangaDocument } from '@/types';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { searchExternalLiterature, fetchExternalDocument, type ExternalSearchResult } from '@/lib/externalLiteratureService';
import { setEphemeralDocument } from '@/lib/ephemeralDocumentStore';
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
import { AuthGuard } from '@/components/auth/AuthGuard';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

function arrayBufferToBlob(buffer: ArrayBuffer, type: string): Blob {
  return new Blob([buffer], { type });
}

function truncateTitle(title: string, maxWords: number = 4): string {
    const words = title.split(/\s+/);
    if (words.length > maxWords) {
        // Simple middle truncation
        const start = words.slice(0, Math.floor(maxWords / 2)).join(' ');
        const end = words.slice(words.length - Math.floor(maxWords / 2)).join(' ');
        return `${start} ... ${end}`;
    }
    return title;
}


const TYPE_TO_EXTENSION: Record<string, string> = {
  pdf: 'pdf',
  epub: 'epub',
  mobi: 'mobi',
  txt: 'txt',
  docx: 'docx',
  image: '',
  scratchpad: 'txt',
};

function externalSourceLabel(source: ExternalSearchResult['source']): string {
  switch (source) {
    case 'arxiv': return 'arXiv';
    case 'gutenberg': return 'Project Gutenberg';
    case 'semanticscholar': return 'Semantic Scholar';
    case 'core': return 'CORE';
    case 'openalex': return 'OpenAlex';
    case 'crossref': return 'Crossref';
    case 'zenodo': return 'Zenodo';
    case 'pmc': return 'PubMed Central';
    case 'hcommons': return 'Knowledge Commons Works';
    case 'archive': return 'Internet Archive';
    case 'doaj': return 'DOAJ';
    default: return source;
  }
}

function LibraryPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  // Initialize with empty/loading state to match server render and prevent hydration errors
  const [storedDocuments, setStoredDocuments] = useState<StoredMangaDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingToDevice, setIsSavingToDevice] = useState<string | null>(null);
  const [docToDelete, setDocToDelete] = useState<StoredMangaDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // External literature search (arXiv / Project Gutenberg) - results are
  // never stored on our own R2/D1, only fetched on demand when opened.
  const [externalQuery, setExternalQuery] = useState('');
  const [externalResults, setExternalResults] = useState<ExternalSearchResult[]>([]);
  const [isSearchingExternal, setIsSearchingExternal] = useState(false);
  const [openingExternalId, setOpeningExternalId] = useState<string | null>(null);
  const [savingExternalId, setSavingExternalId] = useState<string | null>(null);
  const [externalSearchError, setExternalSearchError] = useState('');
  const [libraryLink, setLibraryLink] = useState<{ url: string; label: string } | null>(null);

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const libraryDict = dictionary.library;

  const fetchDocuments = async (forceRefresh: boolean = false, operationLabel: string = "Fetching documents") => {
    // Only show the full-page loader on a hard refresh, not on the initial background sync
    if (forceRefresh) {
      setIsLoading(true);
    }
    try {
      const docs = await IndexedDBService.getAllDocuments(forceRefresh);
      setStoredDocuments(docs);
    } catch (error: any) {
      toast({ variant: "destructive", title: libraryDict.errorLoadingDocuments, description: libraryDict.errorLoadingDocumentsMessage.replace('{message}', error.message) });
    } finally {
      // After any fetch, loading should be false.
      setIsLoading(false);
    }
  };

  // This effect runs once on the client after hydration
  useEffect(() => {
    // To avoid hydration mismatch, we populate initial state from localStorage on the client.
    const cachedDocs = LocalStorageService.loadDocumentMetadata() as StoredMangaDocument[];
    if (cachedDocs.length > 0) {
      setStoredDocuments(cachedDocs);
      setIsLoading(false); // We have something to show, so no need for the main loader
    }

    // Now, fetch the full, up-to-date list from IndexedDB in the background.
    // This will update the list if it has changed and also handles the initial
    // load case where localStorage is empty.
    fetchDocuments();

    if (typeof window !== 'undefined') {
      // Use the version of pdf.worker.min.mjs that is installed with pdfjs-dist
      GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
    }
    // Restore the last external literature search so refreshing the page
    // (or navigating away and back) doesn't lose it - but only if it's
    // still within the signed-download-link validity window (4 hours, see
    // urlSigning.ts). Restoring an older cache would show results whose
    // "read" links have already expired, which just looks like a broken
    // link with no obvious cause.
    const cachedSearch = LocalStorageService.loadExternalSearchCache<ExternalSearchResult>();
    const CACHE_MAX_AGE_MS = 3.5 * 60 * 60 * 1000;
    if (cachedSearch && Date.now() - cachedSearch.savedAt < CACHE_MAX_AGE_MS) {
      setExternalQuery(cachedSearch.query);
      setExternalResults(cachedSearch.results);
    }

    getLibraryLink().then(setLibraryLink);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only once on mount

  const handleExternalSearch = async () => {
    const query = externalQuery.trim();
    if (!query) return;
    setExternalSearchError('');
    setIsSearchingExternal(true);
    const result = await searchExternalLiterature(query);
    setIsSearchingExternal(false);

    if (result.success) {
      setExternalResults(result.results);
      LocalStorageService.saveExternalSearchCache(query, result.results);
      if (result.results.length === 0) {
        setExternalSearchError('没有找到相关结果，换个关键词试试。');
      }
    } else {
      setExternalResults([]);
      setExternalSearchError(result.message || '搜索失败。');
    }
  };

  const handleSaveExternalResult = async (result: ExternalSearchResult) => {
    setSavingExternalId(result.id);
    try {
      const doc = await fetchExternalDocument(result);
      // Give it a fresh id distinct from the search-result id: that prefix
      // (arxiv-/gutenberg-/etc.) is what marks a document as ephemeral
      // (see ephemeralDocumentStore.ts) - a genuinely saved copy needs its
      // own real id so it gets uploaded to R2/D1 like any other document,
      // not treated as a throwaway search result.
      const savedDoc: StoredMangaDocument = { ...doc, id: crypto.randomUUID(), createdAt: Date.now() };
      await IndexedDBService.saveDocument(savedDoc);
      toast({ title: '已收藏', description: `《${result.title}》已保存到你的书库。` });
      await fetchDocuments(true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: '收藏失败', description: e?.message || '保存文献失败。' });
    } finally {
      setSavingExternalId(null);
    }
  };

  const handleOpenExternalResult = async (result: ExternalSearchResult) => {
    setOpeningExternalId(result.id);
    try {
      const doc = await fetchExternalDocument(result);
      const stored = await setEphemeralDocument(doc);
      if (!stored) {
        toast({
          variant: 'destructive',
          title: '打开失败',
          description: '这份文献文件太大，暂时无法在阅读器中打开。',
        });
        return;
      }
      router.push(`/reader?docId=${encodeURIComponent(doc.id)}`);
    } catch (e: any) {
      const status = typeof e?.message === 'string' ? e.message.match(/HTTP (\d+)/)?.[1] : undefined;
      let description = e?.message || '获取文献内容失败。';
      if (status === '403') {
        description = '这条搜索结果的链接已过期，请重新搜索一次再打开。';
      } else if (status === '502') {
        description = '该文献所在的平台拒绝了我们的访问请求（对方有反爬虫限制），暂时无法在本站直接打开，建议前往原平台查看。';
      } else if (status === '413') {
        description = '这份文献文件过大（超过 40MB），暂不支持在线打开，建议前往原平台下载查看。';
      }
      toast({ variant: 'destructive', title: '打开失败', description });
    } finally {
      setOpeningExternalId(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const docId = `doc_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    let newDocument: StoredMangaDocument | null = null;
    const lowerCaseName = file.name.toLowerCase();

    try {
      const fileBuffer = await file.arrayBuffer();
      const commonDocProps = {
        id: docId,
        title: file.name,
        fileData: fileBuffer,
        originalType: file.type,
        createdAt: Date.now(),
      };

      if (file.type.startsWith('image/')) {
        newDocument = { ...commonDocProps, type: 'image', extractedText: undefined };
      } else if (file.type === 'application/pdf') {
         try {
            const pdfLoadingTask = getDocument({ data: fileBuffer.slice(0) }); // Use slice(0) to create a copy for pdf.js
            const pdfInstance = await pdfLoadingTask.promise;
            newDocument = { ...commonDocProps, type: 'pdf', numPages: pdfInstance.numPages, ocrTextPerPage: {} };
          } catch (pdfError: any) {
            toast({ variant: "default", title: "PDF Info", description: libraryDict.pdfPageCountIssue.replace('{name}', file.name).replace('{message}', pdfError.message) });
            newDocument = { ...commonDocProps, type: 'pdf', numPages: undefined, ocrTextPerPage: {} }; // Save even if page count fails
          }
      } else if (file.type === 'application/epub+zip' || lowerCaseName.endsWith('.epub')) {
        newDocument = { ...commonDocProps, type: 'epub', originalType: 'application/epub+zip' };
      } else if (file.type === 'application/x-mobipocket-ebook' || lowerCaseName.endsWith('.mobi') || lowerCaseName.endsWith('.azw') || lowerCaseName.endsWith('.azw3')) {
        newDocument = { ...commonDocProps, type: 'mobi', originalType: file.type || 'application/x-mobipocket-ebook' };
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lowerCaseName.endsWith('.docx')
      ) {
        newDocument = {
          ...commonDocProps,
          type: 'docx',
          originalType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      } else if (file.type === 'text/plain' || lowerCaseName.endsWith('.txt')) {
        newDocument = { ...commonDocProps, type: 'txt', originalType: 'text/plain' };
      } else {
        toast({ variant: "destructive", title: libraryDict.unsupportedFileType, description: libraryDict.unsupportedFileTypeError.replace('{type}', file.type || 'unknown').replace('{name}', file.name) });
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (newDocument) {
        await IndexedDBService.saveDocument(newDocument);
        toast({ title: libraryDict.documentSaved, description: libraryDict.documentSavedMessage.replace('{title}', newDocument.title) });
        await fetchDocuments(true, "Post-upload document fetch");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: libraryDict.uploadError, description: libraryDict.uploadErrorMessage.replace('{name}', file.name).replace('{message}', error.message) });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Reset file input
      }
    }
  };

  const performDelete = async () => {
    if (!docToDelete) return;

    const docIdToDelete = docToDelete.id;
    const docTitleToDelete = docToDelete.title;
    setDocToDelete(null);

    try {
        await IndexedDBService.deleteDocumentById(docIdToDelete);
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (lastActiveId === docIdToDelete) {
            await IndexedDBService.saveLastActiveDocId(null);
        }
        await fetchDocuments(true, "Data refresh after deletion");
        toast({ title: commonDict.success, description: libraryDict.deletionSuccess.replace('{title}', docTitleToDelete) });
    } catch (error: any) {
        console.error("Deletion failed:", error);
        toast({ variant: "destructive", title: libraryDict.deletionFailed, description: error.message || "An unknown error occurred." });
    }
  };

  const handleSaveToDevice = async (doc: StoredMangaDocument) => {
    if (!doc.title) {
        toast({variant: "destructive", title: commonDict.error, description: libraryDict.saveErrorIncomplete});
        return;
    }
    setIsSavingToDevice(doc.id);

    try {
      // Goes through the same streaming download endpoint the reader uses
      // to open documents, with Content-Disposition set to force a real
      // download - this works for any file size (no need to hold the whole
      // file in browser memory as a Blob first, which the old
      // fileData-in-memory approach required and which isn't guaranteed to
      // be populated since the document list itself only carries metadata).
      const ext = TYPE_TO_EXTENSION[doc.type] || '';
      const filename = doc.title.toLowerCase().endsWith(`.${ext}`) ? doc.title : `${doc.title}${ext ? `.${ext}` : ''}`;
      const a = document.createElement('a');
      a.href = `/api/documents/${encodeURIComponent(doc.id)}/file?download=${encodeURIComponent(filename)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: libraryDict.downloadStarted, description: libraryDict.downloadStartedMessage.replace('{title}', doc.title) });

    } catch (error: any) {
      toast({ variant: "destructive", title: commonDict.error, description: libraryDict.saveToDeviceFailed.replace('{title}', doc.title).replace('{message}', error.message) });
    } finally {
        setIsSavingToDevice(null);
    }
  };
  
  const getDocumentIcon = (docType: StoredMangaDocument['type']) => {
    switch (docType) {
      case 'image': return <ImageIcon className="h-8 w-8 text-primary flex-shrink-0" />;
      case 'pdf': return <FileType2 className="h-8 w-8 text-primary flex-shrink-0" />; 
      case 'epub': return <BookOpen className="h-8 w-8 text-primary flex-shrink-0" />;
      case 'mobi': return <Book className="h-8 w-8 text-primary flex-shrink-0" />; 
      case 'docx': return <FileType2 className="h-8 w-8 text-primary flex-shrink-0" />;
      case 'txt': return <FileText className="h-8 w-8 text-primary flex-shrink-0" />;
      default: return <FileText className="h-8 w-8 text-primary flex-shrink-0" />; 
    }
  };
  
  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" />{libraryDict.addDocumentTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid w-full max-w-md items-center gap-1.5">
              <Label htmlFor="doc-upload-library">{libraryDict.fileInputLabel}</Label>
              <Input
                ref={fileInputRef}
                id="doc-upload-library"
                type="file"
                accept="application/epub+zip,application/pdf,text/plain,image/*,application/x-mobipocket-ebook,.mobi,.azw,.azw3,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                onChange={handleFileUpload}
                disabled={isUploading || isLoading}
              />
            </div>
            {isUploading && <p className="mt-2 text-sm text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{libraryDict.processingAndSaving}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2"><Search className="text-primary" />从学术文献库搜索</CardTitle>
              {libraryLink && (
                <Button size="sm" variant="outline" asChild>
                  <a href={libraryLink.url} target="_blank" rel="noopener noreferrer">
                    {libraryLink.label} <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
            </div>
            <CardDescription>
              目前接入 arXiv、Semantic Scholar、OpenAlex、Crossref、Zenodo、DOAJ（学术论文/期刊）、PubMed Central（医学文献）、Knowledge Commons Works、Internet Archive、Project Gutenberg（电子书，含 EPUB/TXT/MOBI 格式），点击"阅读"直接在线浏览，不会占用你的存储空间。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 max-w-md">
              <Input
                placeholder="输入关键词，如书名、论文主题、作者"
                value={externalQuery}
                onChange={(e) => setExternalQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExternalSearch()}
                disabled={isSearchingExternal}
              />
              <Button onClick={handleExternalSearch} disabled={isSearchingExternal || !externalQuery.trim()}>
                {isSearchingExternal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {externalSearchError && <p className="mt-2 text-sm text-muted-foreground">{externalSearchError}</p>}
            {externalResults.length > 0 && (
              <ul className="mt-4 space-y-2">
                {externalResults.map((result) => (
                  <li key={result.id} className="flex items-center justify-between gap-3 p-3 border rounded-md">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{result.title}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {result.authors}{result.year ? ` · ${result.year}` : ''} · {externalSourceLabel(result.source)} · {result.format.toUpperCase()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSaveExternalResult(result)}
                        disabled={savingExternalId === result.id}
                        title="收藏到书库"
                      >
                        {savingExternalId === result.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Star className="h-4 w-4" />
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" asChild title="下载到本地设备（没有大小限制）">
                        <a
                          href={`/api/external-search/proxy?url=${encodeURIComponent(result.fileUrl)}&download=${encodeURIComponent(`${result.title}.${result.format}`)}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenExternalResult(result)}
                        disabled={openingExternalId === result.id}
                      >
                        {openingExternalId === result.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>阅读 <ExternalLink className="ml-1 h-3 w-3" /></>
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="text-primary" />{libraryDict.storedDocumentsTitle}</CardTitle>
            <CardDescription>
              {libraryDict.storedDocumentsDescription}
            </CardDescription>
            <Button variant="outline" size="sm" onClick={() => fetchDocuments(true, "Manual refresh of document list")} disabled={isLoading || isUploading} className="mt-2 w-fit">
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading && !isUploading ? 'animate-spin' : ''}`} />{libraryDict.refreshList}
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{libraryDict.loadingDocuments}</p>}
            {!isLoading && storedDocuments.length === 0 && (
              <p className="text-muted-foreground">{libraryDict.noDocumentsFound}</p>
            )}
            {storedDocuments.length > 0 && (
              <ul className="space-y-3">
                {storedDocuments.map(doc => (
                    <li key={doc.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-card hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3 flex-grow min-w-0">
                        {getDocumentIcon(doc.type)}
                        <div className="min-w-0">
                           <p className="text-base font-medium" title={doc.title}>
                                {truncateTitle(doc.title || 'Untitled Document')}
                            </p>
                          <p className="text-xs text-muted-foreground">
                            {libraryDict.documentType}: {doc.originalType || doc.type} | {libraryDict.storedDate}: {new Date(doc.createdAt || 0).toLocaleDateString()}
                            {doc.type === 'pdf' && doc.numPages !== undefined && ` | ${commonDict.pages}: ${doc.numPages}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 self-end sm:self-center flex-shrink-0">
                        <Button size="icon" variant="outline" asChild disabled={isUploading || isLoading} title={libraryDict.openInReader}>
                           <Link href={`/reader?docId=${doc.id}`}>
                              <BookOpen className="h-4 w-4" />
                           </Link>
                        </Button>
                        <Button
                            size="icon"
                            variant="outline"
                            onClick={() => handleSaveToDevice(doc)}
                            disabled={isSavingToDevice === doc.id || isUploading || isLoading}
                            title={libraryDict.saveToDevice}
                        >
                            {isSavingToDevice === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDocToDelete(doc)}
                          disabled={isUploading || isLoading}
                          aria-label="Delete Document"
                          title="Delete Document"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  )
                )}
              </ul>
            )}
          </CardContent>
          {storedDocuments.length > 0 && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">{libraryDict.indexedDBNote}</p>
            </CardFooter>
          )}
        </Card>
        
        <AlertDialog open={!!docToDelete} onOpenChange={(isOpen) => !isOpen && setDocToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
              <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
              <AlertDialogDescription>
                  {libraryDict.deleteConfirmation.replace('{title}', docToDelete?.title || '')}
              </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
              <AlertDialogCancel>{commonDict.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={performDelete}>
                  {commonDict.continue}
              </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
      </div>
    </>
  );
}

export default function LibraryPage() {
    return (
        <AuthGuard>
            <LibraryPageContent />
        </AuthGuard>
    )
}
