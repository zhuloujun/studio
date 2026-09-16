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

    // Some sources (scanned books especially, e.g. Internet Archive) can be
    // very large - streaming an oversized file through the Worker is what
    // was causing "Error 1102: Worker exceeded resource limits" crashes
    // (and, worse, occasionally leaving the Worker instance in a bad state
    // for a moment afterwards, making unrelated requests fail too). Reject
    // clearly up front instead of risking that.
    const MAX_BYTES = 40 * 1024 * 1024; // 40MB
    const declaredLength = upstream.headers.get('content-length');
    if (declaredLength && parseInt(declaredLength, 10) > MAX_BYTES) {
      return new NextResponse('File too large', { status: 413 });
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    headers.set('Content-Type', contentType);
    if (declaredLength) headers.set('Content-Length', declaredLength);
    headers.set('Cache-Control', 'private, max-age=3600');

    // No Content-Length was declared (common with chunked responses) - guard
    // against an unexpectedly huge body by counting bytes as they stream
    // through and aborting if the limit is exceeded, rather than trusting
    // the source to be well-behaved.
    if (!declaredLength) {
      let total = 0;
      let aborted = false;
      const limiter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_BYTES) {
            aborted = true;
            controller.error(new Error('File too large'));
            return;
          }
          controller.enqueue(chunk);
        },
      });
      const limitedBody = upstream.body.pipeThrough(limiter);
      return new NextResponse(limitedBody, { status: 200, headers });
    }

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    console.error('[external-search/proxy]', err);
    return new NextResponse('Proxy fetch failed', { status: 502 });
  }
}
