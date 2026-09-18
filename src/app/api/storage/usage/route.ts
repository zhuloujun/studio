import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getUserUsageBytes, getDefaultQuotaBytes } from '@/lib/storageQuota';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const [usedBytes, quotaBytes] = await Promise.all([
      getUserUsageBytes(session.userId),
      getDefaultQuotaBytes(),
    ]);
    const percentage = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10) : 0;

    return NextResponse.json({ success: true, usedBytes, quotaBytes, percentage });
  } catch (err) {
    console.error('[storage/usage GET]', err);
    return NextResponse.json({ success: false, message: '获取储存用量失败。' }, { status: 500 });
  }
}
