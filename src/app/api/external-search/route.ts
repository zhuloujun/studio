import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';

export interface ExternalSearchResult {
  id: string;
  source: 'arxiv' | 'gutenberg';
  title: string;
  authors: string;
  year?: string;
  format: 'pdf' | 'epub' | 'txt';
  // A URL that /api/external-search/proxy is willing to fetch on the
  // client's behalf (validated against an allowlist there).
  fileUrl: string;
}

async function searchArxiv(query: string): Promise<ExternalSearchResult[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=8`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const xml = await res.text();

  // Minimal Atom feed parsing (no XML DOM parser available server-side in
  // this runtime) - split on <entry> blocks and pull out the fields we need.
  const results: ExternalSearchResult[] = [];
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
      fileUrl: pdfUrl,
    });
  }
  return results;
}

async function searchGutenberg(query: string): Promise<ExternalSearchResult[]> {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: { id: number; title: string; authors: { name: string }[]; formats: Record<string, string> }[];
  };

  const results: ExternalSearchResult[] = [];
  for (const book of data.results || []) {
    const epubUrl = Object.entries(book.formats).find(([k]) => k.includes('epub'))?.[1];
    const txtUrl = Object.entries(book.formats).find(([k]) => k.startsWith('text/plain'))?.[1];
    const fileUrl = epubUrl || txtUrl;
    if (!fileUrl) continue;

    results.push({
      id: `gutenberg-${book.id}`,
      source: 'gutenberg',
      title: book.title,
      authors: book.authors.map((a) => a.name).join(', ') || '未知作者',
      format: epubUrl ? 'epub' : 'txt',
      fileUrl,
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
    const [arxivResults, gutenbergResults] = await Promise.all([
      searchArxiv(query).catch((e) => {
        console.error('[external-search] arxiv failed', e);
        return [];
      }),
      searchGutenberg(query).catch((e) => {
        console.error('[external-search] gutenberg failed', e);
        return [];
      }),
    ]);

    return NextResponse.json({ success: true, results: [...arxivResults, ...gutenbergResults] });
  } catch (err) {
    console.error('[external-search]', err);
    return NextResponse.json(
      { success: false, message: '搜索失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
