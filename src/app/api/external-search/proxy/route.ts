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
  // When present, forces a real browser download (Content-Disposition:
  // attachment) instead of streaming the file for our own reader to parse.
  // This is also why it gets a much higher size ceiling below: a download
  // is a pure byte pass-through to the browser's download manager, not
  // buffered into memory for pdf.js/mammoth/etc. to parse, so it doesn't
  // carry the same crash risk that "open in reader" does.
  const downloadFilename = req.nextUrl.searchParams.get('download');

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

    // Cloudflare's own limits documentation confirms it does not enforce a
    // response body size limit for Workers (the 100/200/500MB limits people
    // usually cite are for REQUEST bodies coming into a Worker, not what it
    // streams back out) - and CPU time only counts actual JS execution, not
    // time spent waiting on the network, so a long pure pass-through of even
    // a multi-GB file shouldn't cost meaningful CPU time either. So a
    // download (nothing on our side ever buffers or parses it - it's piped
    // straight through to the browser's download manager) genuinely has no
    // size ceiling here. "Open in reader" is different: that DOES get fully
    // buffered client-side and handed to pdf.js/mammoth/etc, which is what
    // was crashing on oversized files - that path keeps its 40MB cap.
    const MAX_BYTES = 40 * 1024 * 1024;
    const declaredLength = upstream.headers.get('content-length');
    if (!downloadFilename && declaredLength && parseInt(declaredLength, 10) > MAX_BYTES) {
      return new NextResponse('File too large', { status: 413 });
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    headers.set('Content-Type', contentType);
    if (declaredLength) headers.set('Content-Length', declaredLength);
    headers.set('Cache-Control', 'private, max-age=3600');
    if (downloadFilename) {
      // Quote-escape the filename per RFC 6266; browsers fall back gracefully
      // for any characters they don't like.
      headers.set('Content-Disposition', `attachment; filename="${downloadFilename.replace(/"/g, "'")}"`);
    }

    // No Content-Length was declared (common with chunked responses) - for
    // the "open in reader" path, guard against an unexpectedly huge body by
    // counting bytes as they stream through and aborting if the limit is
    // exceeded, rather than trusting the source to be well-behaved. Downloads
    // skip this entirely - see the no-size-limit note above.
    if (!declaredLength && !downloadFilename) {
      let total = 0;
      const limiter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_BYTES) {
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
