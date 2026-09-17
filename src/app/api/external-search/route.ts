import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getEnv } from '@/lib/cloudflare';
import { signUrl } from '@/lib/urlSigning';

// Every source below hits a different third-party API with its own latency
// characteristics; a single slow/hanging one (this has happened with PMC and
// Internet Archive, which each chain several sequential requests) used to
// drag out - or occasionally blow the resource limits on - the whole search.
// Every fetch in this file goes through this wrapper so one bad source can
// only ever cost its own timeout, never the whole request.
const SOURCE_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ExternalSearchResult {
  id: string;
  source: 'arxiv' | 'gutenberg' | 'semanticscholar' | 'core' | 'openalex' | 'crossref' | 'zenodo' | 'pmc' | 'hcommons' | 'archive' | 'doaj';
  category: 'academic' | 'medicine' | 'books';
  title: string;
  authors: string;
  year?: string;
  format: 'pdf' | 'epub' | 'txt' | 'mobi' | 'docx';
  // A short-lived signed token that /api/external-search/proxy will accept -
  // NOT the raw URL. Open-access papers/books are hosted on all kinds of
  // domains (publishers, institutional repositories, etc.), so instead of a
  // fixed domain allowlist, only URLs we ourselves just issued can be fetched.
  fileUrl: string;
  // The real, unsigned source URL. Safe to expose directly - it's already a
  // public link - and used for "open/download at the source" links that go
  // straight from the browser to the source, bypassing our own proxy (and
  // its 40MB size limit) entirely. Downloads triggered by simple navigation
  // (an <a> tag) aren't subject to CORS the way a fetch()/XHR read would be,
  // so this works even for sources our proxy can't read into memory.
  originalUrl: string;
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

// ============ Academic ============

// Zenodo and Knowledge Commons Works both run InvenioRDM, but different
// versions/deployments of it have returned the record's file list in two
// different shapes over time: a flat array, or an object keyed by filename
// under `entries`. Rather than guess which one a given deployment uses (and
// silently drop every real match if we guess wrong - which is very likely
// what was happening here), this checks both.
function extractInvenioFile(
  files: unknown
): { key: string; url: string } | undefined {
  if (!files || typeof files !== 'object') return undefined;

  // Check the plain-array shape FIRST: arrays have a built-in `.entries()`
  // method (not a data property), which would otherwise be mistaken for the
  // "object keyed by filename" shape below.
  let candidates: any[];
  if (Array.isArray(files)) {
    candidates = files;
  } else if ((files as any).entries && typeof (files as any).entries === 'object') {
    candidates = Object.values((files as any).entries);
  } else {
    candidates = [];
  }

  for (const f of candidates) {
    const key: string | undefined = f?.key;
    const url: string | undefined = f?.links?.content || f?.links?.self || f?.links?.download;
    if (key && url && /\.(pdf|epub|txt|mobi|docx)$/i.test(key)) {
      return { key, url };
    }
  }
  return undefined;
}

function formatFromExtension(key: string): RawResult['format'] {
  const ext = key.split('.').pop()?.toLowerCase();
  return ext === 'epub' ? 'epub' : ext === 'txt' ? 'txt' : ext === 'mobi' ? 'mobi' : ext === 'docx' ? 'docx' : 'pdf';
}

async function searchArxiv(query: string): Promise<RawResult[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=10`;
  const res = await fetchWithTimeout(url);
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

// ============ Books ============
async function searchGutenberg(query: string): Promise<RawResult[]> {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: { id: number; title: string; authors: { name: string }[]; formats: Record<string, string> }[];
  };

  const results: RawResult[] = [];
  for (const book of data.results || []) {
    const epubUrl = Object.entries(book.formats).find(([k]) => k.includes('epub'))?.[1];
    const mobiUrl = Object.entries(book.formats).find(([k]) => k.includes('mobipocket'))?.[1];
    const txtUrl = Object.entries(book.formats).find(([k]) => k.startsWith('text/plain'))?.[1];
    const rawUrl = epubUrl || mobiUrl || txtUrl;
    if (!rawUrl) continue;

    results.push({
      id: `gutenberg-${book.id}`,
      source: 'gutenberg',
      title: book.title,
      authors: book.authors.map((a) => a.name).join(', ') || '未知作者',
      format: epubUrl ? 'epub' : mobiUrl ? 'mobi' : 'txt',
      rawUrl,
    });
  }
  return results;
}

// Major publisher platforms that reliably block non-browser (server-side)
// fetches even for genuinely open-access content - Semantic Scholar's
// openAccessPdf link often points here, but our proxy fetching it will just
// get rejected by their bot protection. Better to leave these out of the
// results than show a link that looks openable but never actually works.
const BOT_HOSTILE_HOSTS = [
  'link.springer.com',
  'springer.com',
  'onlinelibrary.wiley.com',
  'wiley.com',
  'tandfonline.com',
  'jstor.org',
  'ieeexplore.ieee.org',
  'dl.acm.org',
  'sciencedirect.com',
  'nature.com',
];

function isLikelyFetchable(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return !BOT_HOSTILE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

async function searchSemanticScholar(query: string, apiKey: string | undefined): Promise<RawResult[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
    query
  )}&fields=title,authors,year,openAccessPdf&limit=20`;
  // Without an API key this shares the single global rate-limit pool for
  // every unauthenticated Semantic Scholar request on the internet, and
  // gets silently throttled fairly often - which looked identical to "no
  // results from this source" before this comment was added.
  const res = await fetchWithTimeout(url, apiKey ? { headers: { 'x-api-key': apiKey } } : undefined);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: { paperId: string; title: string; year?: number; authors?: { name: string }[]; openAccessPdf?: { url: string } | null }[];
  };

  const results: RawResult[] = [];
  for (const paper of data.data || []) {
    // Only include papers that actually have a fetchable open-access PDF -
    // Semantic Scholar indexes far more papers than are actually open access.
    if (!paper.openAccessPdf?.url || !isLikelyFetchable(paper.openAccessPdf.url)) continue;

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

async function searchDoaj(query: string): Promise<RawResult[]> {
  // DOAJ (Directory of Open Access Journals) only indexes journals that are
  // ENTIRELY open access by policy - unlike Semantic Scholar's broader index
  // (mixed open/paywalled), so links found here are much more likely to
  // actually be fetchable.
  const url = `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=10`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: {
      id: string;
      bibjson?: {
        title?: string;
        author?: { name?: string }[];
        year?: string;
        link?: { url: string; type?: string }[];
      };
    }[];
  };

  const results: RawResult[] = [];
  for (const item of data.results || []) {
    const bib = item.bibjson;
    if (!bib?.title) continue;
    const fulltextLink = bib.link?.find((l) => l.type === 'fulltext') || bib.link?.[0];
    if (!fulltextLink?.url || !isLikelyFetchable(fulltextLink.url)) continue;

    results.push({
      id: `doaj-${item.id}`,
      source: 'doaj',
      title: bib.title,
      authors: (bib.author || []).map((a) => a.name).filter(Boolean).join(', ') || '未知作者',
      year: bib.year,
      format: 'pdf',
      rawUrl: fulltextLink.url,
    });
  }
  return results;
}

async function searchCore(query: string, apiKey: string | undefined): Promise<RawResult[]> {
  if (!apiKey) return []; // Silently skipped when no key is configured.

  const url = `https://api.core.ac.uk/v3/search/works/?q=${encodeURIComponent(query)}&limit=6`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${apiKey}` } });
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

async function searchOpenAlex(query: string): Promise<RawResult[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=6`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: {
      id: string;
      title: string;
      publication_year?: number;
      authorships?: { author?: { display_name?: string } }[];
      open_access?: { is_oa: boolean; oa_url?: string | null };
    }[];
  };

  const results: RawResult[] = [];
  for (const work of data.results || []) {
    if (!work.open_access?.is_oa || !work.open_access.oa_url || !isLikelyFetchable(work.open_access.oa_url)) continue;
    const workId = work.id.split('/').pop() || work.id;

    results.push({
      id: `openalex-${workId}`,
      source: 'openalex',
      title: work.title,
      authors: (work.authorships || []).map((a) => a.author?.display_name).filter(Boolean).join(', ') || '未知作者',
      year: work.publication_year ? String(work.publication_year) : undefined,
      format: 'pdf',
      rawUrl: work.open_access.oa_url,
    });
  }
  return results;
}

async function searchCrossref(query: string): Promise<RawResult[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=6`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    message?: {
      items?: {
        DOI: string;
        title?: string[];
        author?: { given?: string; family?: string }[];
        published?: { 'date-parts'?: number[][] };
        link?: { URL: string; 'content-type'?: string }[];
      }[];
    };
  };

  const results: RawResult[] = [];
  for (const item of data.message?.items || []) {
    // Crossref is primarily a DOI/metadata registry - only some records
    // (mostly fully open-access journals) also list a direct full-text link.
    const pdfLink = item.link?.find((l) => l['content-type']?.includes('pdf'));
    if (!pdfLink || !item.title?.[0] || !isLikelyFetchable(pdfLink.URL)) continue;

    results.push({
      id: `crossref-${item.DOI}`,
      source: 'crossref',
      title: item.title[0],
      authors: (item.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', ') || '未知作者',
      year: item.published?.['date-parts']?.[0]?.[0] ? String(item.published['date-parts'][0][0]) : undefined,
      format: 'pdf',
      rawUrl: pdfLink.URL,
    });
  }
  return results;
}

async function searchZenodo(query: string): Promise<RawResult[]> {
  const url = `https://zenodo.org/api/records/?q=${encodeURIComponent(query)}&size=10`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits?: {
      hits?: {
        id: number;
        metadata: { title: string; creators?: { name: string }[]; publication_date?: string };
        files?: unknown;
      }[];
    };
  };

  const results: RawResult[] = [];
  for (const record of data.hits?.hits || []) {
    const file = extractInvenioFile(record.files);
    if (!file) continue;

    results.push({
      id: `zenodo-${record.id}`,
      source: 'zenodo',
      title: record.metadata.title,
      authors: (record.metadata.creators || []).map((c) => c.name).join(', ') || '未知作者',
      year: record.metadata.publication_date?.slice(0, 4),
      format: formatFromExtension(file.key),
      rawUrl: file.url,
    });
  }
  return results;
}

// ============ Medicine ============
async function searchPmc(query: string): Promise<RawResult[]> {
  // Step 1: find matching PMC IDs.
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${encodeURIComponent(
    query
  )}&retmax=4&retmode=json`;
  const searchRes = await fetchWithTimeout(searchUrl);
  if (!searchRes.ok) return [];
  const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
  const uids = searchData.esearchresult?.idlist || [];
  if (uids.length === 0) return [];

  // Step 2: batch-fetch titles/authors/year for all of them at once.
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${uids.join(',')}&retmode=json`;
  const summaryRes = await fetchWithTimeout(summaryUrl);
  const summaryData = summaryRes.ok
    ? ((await summaryRes.json()) as { result?: Record<string, { title?: string; authors?: { name: string }[]; pubdate?: string }> })
    : { result: {} };

  // Step 3: check which of these are actually in the PMC Open Access subset
  // (most PMC articles are NOT full-text-downloadable without a subscription).
  const oaChecks = await Promise.all(
    uids.map(async (uid) => {
      const pmcId = `PMC${uid}`;
      try {
        const oaRes = await fetchWithTimeout(`https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=${pmcId}`);
        if (!oaRes.ok) return null;
        const xml = await oaRes.text();
        const pdfMatch = /<link format="pdf"[^>]*href="(.*?)"/.exec(xml);
        return pdfMatch ? { uid, pmcId, pdfUrl: pdfMatch[1] } : null;
      } catch {
        return null;
      }
    })
  );

  const results: RawResult[] = [];
  for (const check of oaChecks) {
    if (!check) continue;
    const meta = summaryData.result?.[check.uid];
    if (!meta) continue;

    results.push({
      id: `pmc-${check.pmcId}`,
      source: 'pmc',
      title: meta.title || check.pmcId,
      authors: (meta.authors || []).map((a) => a.name).join(', ') || '未知作者',
      year: meta.pubdate?.slice(0, 4),
      format: 'pdf',
      rawUrl: check.pdfUrl.startsWith('http') ? check.pdfUrl : `https:${check.pdfUrl}`,
    });
  }
  return results;
}

async function searchHCommons(query: string): Promise<RawResult[]> {
  // works.hcommons.org (KCWorks) runs on InvenioRDM - the same open-source
  // platform behind Zenodo - so the API shape is essentially identical.
  const url = `https://works.hcommons.org/api/records?q=${encodeURIComponent(query)}&size=10`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits?: {
      hits?: {
        id: string;
        metadata: { title: string; creators?: { person_or_org?: { name?: string } }[]; publication_date?: string };
        files?: unknown;
      }[];
    };
  };

  const results: RawResult[] = [];
  for (const record of data.hits?.hits || []) {
    const file = extractInvenioFile(record.files);
    if (!file) continue;

    results.push({
      id: `hcommons-${record.id}`,
      source: 'hcommons',
      title: record.metadata.title,
      authors: (record.metadata.creators || []).map((c) => c.person_or_org?.name).filter(Boolean).join(', ') || '未知作者',
      year: record.metadata.publication_date?.slice(0, 4),
      format: formatFromExtension(file.key),
      rawUrl: file.url,
    });
  }
  return results;
}

// (Books, continued)
async function searchInternetArchive(query: string): Promise<RawResult[]> {
  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
    query
  )}+AND+mediatype:texts&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=4&output=json`;
  const searchRes = await fetchWithTimeout(searchUrl);
  if (!searchRes.ok) return [];
  const searchData = (await searchRes.json()) as {
    response?: { docs?: { identifier: string; title: string; creator?: string | string[]; year?: string }[] };
  };
  const docs = searchData.response?.docs || [];
  if (docs.length === 0) return [];

  // Each item's actual downloadable files (and their exact names) vary, so
  // check each item's file manifest rather than guessing a URL pattern.
  const withFiles = await Promise.all(
    docs.map(async (doc) => {
      try {
        const metaRes = await fetchWithTimeout(`https://archive.org/metadata/${doc.identifier}`);
        if (!metaRes.ok) return null;
        const meta = (await metaRes.json()) as { files?: { name: string; format?: string }[] };
        const files = meta.files || [];
        const pick =
          files.find((f) => f.format === 'EPUB') ||
          files.find((f) => f.format === 'MOBI' || /\.mobi$/i.test(f.name)) ||
          files.find((f) => /\.pdf$/i.test(f.name)) ||
          files.find((f) => f.format === 'DjVuTXT' || /\.txt$/i.test(f.name));
        if (!pick) return null;
        const ext = pick.name.split('.').pop()?.toLowerCase();
        const format: RawResult['format'] =
          ext === 'epub' ? 'epub' : ext === 'txt' ? 'txt' : ext === 'mobi' ? 'mobi' : 'pdf';
        return { doc, url: `https://archive.org/download/${doc.identifier}/${pick.name}`, format };
      } catch {
        return null;
      }
    })
  );

  const results: RawResult[] = [];
  for (const item of withFiles) {
    if (!item) continue;
    const authors = Array.isArray(item.doc.creator) ? item.doc.creator.join(', ') : item.doc.creator;
    results.push({
      id: `archive-${item.doc.identifier}`,
      source: 'archive',
      title: item.doc.title,
      authors: authors || '未知作者',
      year: item.doc.year,
      format: item.format,
      rawUrl: item.url,
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

  // Temporarily scoped down to a single, easy-to-verify source while we
  // confirm the whole search -> read pipeline is solid end to end. Add
  // entries back to this list to re-enable them - each function is still
  // fully implemented below, just not called for now.
  // Both of these are "one request, one answer" sources with no internal
  // PMC and Internet Archive each do several sequential sub-requests
  // internally (search -> lookup details -> confirm downloadable), so they
  // add more latency than a single-fetch source - but per-source timeouts
  // (SOURCE_TIMEOUT_MS) now keep a slow one from dragging out or breaking
  // the whole search, so it's safe to run everything together.
  const ENABLED_SOURCES: ExternalSearchResult['source'][] = [
    'semanticscholar',
    'arxiv',
    'openalex',
    'crossref',
    'zenodo',
    'pmc',
    'hcommons',
    'archive',
    'gutenberg',
    'doaj',
  ];

  try {
    const env = getEnv();
    const sourceRunners: Record<ExternalSearchResult['source'], () => Promise<RawResult[]>> = {
      arxiv: () => searchArxiv(query),
      gutenberg: () => searchGutenberg(query),
      semanticscholar: () => searchSemanticScholar(query, env.SEMANTIC_SCHOLAR_API_KEY),
      core: () => searchCore(query, env.CORE_API_KEY),
      openalex: () => searchOpenAlex(query),
      crossref: () => searchCrossref(query),
      zenodo: () => searchZenodo(query),
      pmc: () => searchPmc(query),
      hcommons: () => searchHCommons(query),
      archive: () => searchInternetArchive(query),
      doaj: () => searchDoaj(query),
    };

    const rawResultLists = await Promise.all(
      ENABLED_SOURCES.map((source) =>
        sourceRunners[source]().catch((e) => {
          console.error(`[external-search] ${source} failed`, e);
          return [] as RawResult[];
        })
      )
    );

    // Interleave results round-robin across sources instead of
    // concatenating each source's block one after another - otherwise
    // whichever source happens to be listed last in ENABLED_SOURCES always
    // ends up at the bottom of every single results list, regardless of how
    // relevant its matches actually are (there's no single relevance score
    // comparable across totally different search engines, so round-robin is
    // the fairest simple approximation).
    const rawResults: RawResult[] = [];
    const maxLen = Math.max(0, ...rawResultLists.map((list) => list.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of rawResultLists) {
        if (list[i]) rawResults.push(list[i]);
      }
    }
    const CATEGORY_BY_SOURCE: Record<ExternalSearchResult['source'], ExternalSearchResult['category']> = {
      arxiv: 'academic',
      semanticscholar: 'academic',
      core: 'academic',
      openalex: 'academic',
      crossref: 'academic',
      zenodo: 'academic',
      hcommons: 'academic',
      pmc: 'medicine',
      gutenberg: 'books',
      archive: 'books',
      doaj: 'academic',
    };
    const results: ExternalSearchResult[] = await Promise.all(
      rawResults.map(async ({ rawUrl, ...rest }) => ({
        ...rest,
        category: CATEGORY_BY_SOURCE[rest.source],
        fileUrl: await signUrl(rawUrl),
        originalUrl: rawUrl,
      }))
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
