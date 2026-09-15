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
      headers: { 'User-Agent': 'MangaTalk/1.0 (open-access literature reader)' },
      redirect: 'follow',
    });

    if (!upstream.ok || !upstream.body) {
      return new NextResponse('Upstream fetch failed', { status: 502 });
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
