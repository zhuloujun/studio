import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { verifySignedUrl } from '@/lib/urlSigning';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const token = req.nextUrl.searchParams.get('url');
  if (!token) {
    return new NextResponse('Missing url', { status: 400 });
  }

  // Only fetch URLs that were signed by our own /api/external-search moments
  // ago - this is what prevents this endpoint from being used as an open
  // SSRF relay, without needing to maintain a fixed domain allowlist (open
  // access papers/books are hosted on all kinds of domains).
  const targetUrl = await verifySignedUrl(token);
  if (!targetUrl) {
    return new NextResponse('Invalid or expired url', { status: 403 });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }
  if (parsed.protocol !== 'https:') {
    return new NextResponse('URL not allowed', { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        // Some open-access hosts (repositories, university servers) reject
        // requests that don't look like they come from a real browser.
        // This won't get past dedicated bot-protection systems (those check
        // far more than headers), but it does help with simpler filters.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'application/pdf,text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
      redirect: 'follow',
    });

    if (!upstream.ok || !upstream.body) {
      // Distinguish "the source rejected/blocked us" from a hard network
      // failure so the client can show an accurate message instead of a bare
      // status code.
      return new NextResponse('Source rejected the request (likely bot protection on their end)', {
        status: 502,
      });
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    headers.set('Content-Type', contentType);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);
    headers.set('Cache-Control', 'private, max-age=3600');

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    console.error('[external-search/proxy]', err);
    return new NextResponse('Proxy fetch failed', { status: 502 });
  }
}
