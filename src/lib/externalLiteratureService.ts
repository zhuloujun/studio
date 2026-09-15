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
};

const FORMAT_TO_DOC_TYPE: Record<ExternalSearchResult['format'], StoredMangaDocument['type']> = {
  pdf: 'pdf',
  epub: 'epub',
  txt: 'txt',
};

/** Fetches the actual file through our proxy and builds an in-memory document ready for the reader - never saved to our storage. */
export async function fetchExternalDocument(result: ExternalSearchResult): Promise<StoredMangaDocument> {
  const res = await fetch(`/api/external-search/proxy?url=${encodeURIComponent(result.fileUrl)}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`获取文献内容失败 (HTTP ${res.status})`);
  }
  const fileData = await res.arrayBuffer();

  return {
    id: result.id,
    title: result.title,
    fileData,
    originalType: FORMAT_TO_MIME[result.format],
    type: FORMAT_TO_DOC_TYPE[result.format],
    createdAt: Date.now(),
  } as StoredMangaDocument;
}
