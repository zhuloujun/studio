import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';

// Streams the raw file bytes straight from R2, with basic HTTP Range support
// so <video>/<audio> elements can play and seek without loading the whole
// file into memory anywhere along the way.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const env = getEnv();
    const row = await env.DB.prepare(`SELECT user_id, r2_key, metadata_json FROM media_items WHERE id = ?1`)
      .bind(params.id)
      .first<{ user_id: string; r2_key: string; metadata_json: string }>();

    if (!row || row.user_id !== session.userId) {
      return new NextResponse('Not found', { status: 404 });
    }

    const metadata = JSON.parse(row.metadata_json) as { originalType?: string };
    const contentType = metadata.originalType || 'application/octet-stream';

    const head = await env.UPLOADS.head(row.r2_key);
    if (!head) {
      return new NextResponse('File missing', { status: 404 });
    }
    const size = head.size;

    let start = 0;
    let end = size - 1;
    let status = 200;

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        start = parseInt(match[1], 10);
        end = match[2] ? parseInt(match[2], 10) : size - 1;
        status = 206;
      }
    }
    if (end >= size) end = size - 1;
    const length = end - start + 1;

    const obj = await env.UPLOADS.get(row.r2_key, start > 0 || end < size - 1 ? { range: { offset: start, length } } : undefined);
    if (!obj) {
      return new NextResponse('File missing', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(length));
    headers.set('Cache-Control', 'private, max-age=3600');
    if (status === 206) {
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    return new NextResponse(obj.body as unknown as ReadableStream, { status, headers });
  } catch (err) {
    console.error('[media/:id/file GET]', err);
    return new NextResponse('Internal error', { status: 500 });
  }
}
