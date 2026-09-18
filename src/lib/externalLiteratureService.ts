// src/lib/externalLiteratureService.ts
// Client-side helpers for the "search external literature" feature -
// searches open-access sources (arXiv, Project Gutenberg) via our server
// (which avoids CORS since it's a server-to-server fetch) without ever
// storing the result in our own R2/D1.
import type { ExternalSearchResult } from '@/app/api/external-search/route';
import type { StoredMangaDocument } from '@/types';

export type { ExternalSearchResult };

export async function searchExternalLiterature(query: string): Promise<{ success: boolean; results: ExternalSearchResult[]; message?: string }> {
  try {
    const res = await fetch(`/api/external-search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!data.success) {
      return { success: false, results: [], message: data.message || '搜索失败。' };
    }
    return { success: true, results: data.results || [] };
  } catch (e: any) {
    return { success: false, results: [], message: e?.message || '搜索失败。' };
  }
}

const FORMAT_TO_MIME: Record<ExternalSearchResult['format'], string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  mobi: 'application/x-mobipocket-ebook',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const FORMAT_TO_DOC_TYPE: Record<ExternalSearchResult['format'], StoredMangaDocument['type']> = {
  pdf: 'pdf',
  epub: 'epub',
  txt: 'txt',
  mobi: 'mobi',
  docx: 'docx',
};

/** Checks the actual file bytes rather than trusting any header - some sources
 * return an HTML landing page instead of the PDF/EPUB they claim to be. */
function fileMatchesExpectedFormat(buffer: ArrayBuffer, format: ExternalSearchResult['format']): boolean {
  if (buffer.byteLength < 4) return false;
  const header = new Uint8Array(buffer.slice(0, 5));
  const asString = String.fromCharCode(...header);
  if (format === 'pdf') return asString.startsWith('%PDF-');
  if (format === 'epub' || format === 'docx') return header[0] === 0x50 && header[1] === 0x4b; // ZIP magic ("PK")
  return true; // txt/mobi aren't worth magic-byte checking here
}

/** Fetches the actual file through our proxy and builds an in-memory document ready for the reader - never saved to our storage. */
export async function fetchExternalDocument(result: ExternalSearchResult): Promise<StoredMangaDocument> {
  const res = await fetch(`/api/external-search/proxy?url=${encodeURIComponent(result.fileUrl)}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`获取文献内容失败 (HTTP ${res.status})`);
  }
  const fileData = await res.arrayBuffer();

  if (!fileMatchesExpectedFormat(fileData, result.format)) {
    // The source returned something that isn't actually a valid file of the
    // format it claimed (usually an HTML landing page instead of a direct
    // PDF/EPUB link) - fail clearly here instead of handing pdf.js/etc. a
    // file it can't parse, which surfaces as a much more confusing
    // "Invalid PDF structure"-style error deep in the reader.
    throw new Error('该来源返回的不是有效的文件内容（可能是网页而不是文件本身），建议前往原平台查看。');
  }

  return {
    id: result.id,
    title: result.title,
    fileData,
    originalType: FORMAT_TO_MIME[result.format],
    type: FORMAT_TO_DOC_TYPE[result.format],
    createdAt: Date.now(),
  } as StoredMangaDocument;
}
