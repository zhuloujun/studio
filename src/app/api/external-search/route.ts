import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getEnv } from '@/lib/cloudflare';
import { signUrl } from '@/lib/urlSigning';

export interface ExternalSearchResult {
  id: string;
  source: 'arxiv' | 'gutenberg' | 'semanticscholar' | 'core';
  title: string;
  authors: string;
  year?: string;
  format: 'pdf' | 'epub' | 'txt';
  // A short-lived signed token that /api/external-search/proxy will accept -
  // NOT the raw URL. Open-access papers/books are hosted on all kinds of
  // domains (publishers, institutional repositories, etc.), so instead of a
  // fixed domain allowlist, only URLs we ourselves just issued can be fetched.
  fileUrl: string;
}

interface RawResult {
  id: string;
  source: ExternalSearchResult['source'];
  title: string;
  authors: string;
  year?: string;
  format: ExternalSearchResult['format'];
  rawUrl: string;
}

async function searchArxiv(query: string): Promise<RawResult[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=6`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const xml = await res.text();

  // Minimal Atom feed parsing (no XML DOM parser available server-side in
  // this runtime) - split on <entry> blocks and pull out the fields we need.
  const results: RawResult[] = [];
  const entries = xml.split('<entry>').slice(1);
  for (const entry of entries) {
    const idMatch = /<id>(.*?)<\/id>/.exec(entry);
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(entry);
    const publishedMatch = /<published>(\d{4})-/.exec(entry);
    const authorMatches = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map((m) => m[1]);
    const pdfLinkMatch = /<link title="pdf"[^>]*href="(.*?)"/.exec(entry);
    if (!idMatch || !titleMatch) continue;

    const arxivId = idMatch[1].split('/abs/')[1] || idMatch[1];
    const pdfUrl = pdfLinkMatch ? pdfLinkMatch[1] : `https://arxiv.org/pdf/${arxivId}`;

    results.push({
      id: `arxiv-${arxivId}`,
      source: 'arxiv',
      title: titleMatch[1].replace(/\s+/g, ' ').trim(),
      authors: authorMatches.join(', ') || '未知作者',
      year: publishedMatch ? publishedMatch[1] : undefined,
      format: 'pdf',
      rawUrl: pdfUrl,
    });
  }
  return results;
}

async function searchGutenberg(query: string): Promise<RawResult[]> {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: { id: number; title: string; authors: { name: string }[]; formats: Record<string, string> }[];
  };

  const results: RawResult[] = [];
  for (const book of data.results || []) {
    const epubUrl = Object.entries(book.formats).find(([k]) => k.includes('epub'))?.[1];
    const txtUrl = Object.entries(book.formats).find(([k]) => k.startsWith('text/plain'))?.[1];
    const rawUrl = epubUrl || txtUrl;
    if (!rawUrl) continue;

    results.push({
      id: `gutenberg-${book.id}`,
      source: 'gutenberg',
      title: book.title,
      authors: book.authors.map((a) => a.name).join(', ') || '未知作者',
      format: epubUrl ? 'epub' : 'txt',
      rawUrl,
    });
  }
  return results;
}

async function searchSemanticScholar(query: string): Promise<RawResult[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
    query
  )}&fields=title,authors,year,openAccessPdf&limit=6`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: { paperId: string; title: string; year?: number; authors?: { name: string }[]; openAccessPdf?: { url: string } | null }[];
  };

  const results: RawResult[] = [];
  for (const paper of data.data || []) {
    // Only include papers that actually have a fetchable open-access PDF -
    // Semantic Scholar indexes far more papers than are actually open access.
    if (!paper.openAccessPdf?.url) continue;

    results.push({
      id: `semanticscholar-${paper.paperId}`,
      source: 'semanticscholar',
      title: paper.title,
      authors: (paper.authors || []).map((a) => a.name).join(', ') || '未知作者',
      year: paper.year ? String(paper.year) : undefined,
      format: 'pdf',
      rawUrl: paper.openAccessPdf.url,
    });
  }
  return results;
}

async function searchCore(query: string, apiKey: string | undefined): Promise<RawResult[]> {
  if (!apiKey) return []; // Silently skipped when no key is configured.

  const url = `https://api.core.ac.uk/v3/search/works/?q=${encodeURIComponent(query)}&limit=6`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: { id: number; title: string; authors?: { name: string }[]; yearPublished?: number; downloadUrl?: string }[];
  };

  const results: RawResult[] = [];
  for (const work of data.results || []) {
    if (!work.downloadUrl) continue;
    results.push({
      id: `core-${work.id}`,
      source: 'core',
      title: work.title,
      authors: (work.authors || []).map((a) => a.name).join(', ') || '未知作者',
      year: work.yearPublished ? String(work.yearPublished) : undefined,
      format: 'pdf',
      rawUrl: work.downloadUrl,
    });
  }
  return results;
}

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  const query = req.nextUrl.searchParams.get('q')?.trim();
  if (!query) {
    return NextResponse.json({ success: false, message: '请输入搜索关键词。' }, { status: 400 });
  }

  try {
    const env = getEnv();
    const [arxivResults, gutenbergResults, semanticScholarResults, coreResults] = await Promise.all([
      searchArxiv(query).catch((e) => {
        console.error('[external-search] arxiv failed', e);
        return [];
      }),
      searchGutenberg(query).catch((e) => {
        console.error('[external-search] gutenberg failed', e);
        return [];
      }),
      searchSemanticScholar(query).catch((e) => {
        console.error('[external-search] semantic scholar failed', e);
        return [];
      }),
      searchCore(query, env.CORE_API_KEY).catch((e) => {
        console.error('[external-search] core failed', e);
        return [];
      }),
    ]);

    const rawResults = [...arxivResults, ...gutenbergResults, ...semanticScholarResults, ...coreResults];
    const results: ExternalSearchResult[] = await Promise.all(
      rawResults.map(async ({ rawUrl, ...rest }) => ({ ...rest, fileUrl: await signUrl(rawUrl) }))
    );

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error('[external-search]', err);
    return NextResponse.json(
      { success: false, message: '搜索失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
