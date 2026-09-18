import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getDefaultQuotaBytes, setDefaultQuotaBytes } from '@/lib/storageQuota';
import { isVerificationTokenValid } from '@/lib/adminSettingsVerification';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const env = getEnv();
    const quotaBytes = await getDefaultQuotaBytes();

    const { results } = await env.DB.prepare(
      `SELECT
         u.email as email,
         COALESCE((SELECT SUM(size_bytes) FROM documents WHERE user_id = u.id), 0) +
         COALESCE((SELECT SUM(size_bytes) FROM media_items WHERE user_id = u.id), 0) as usedBytes
       FROM users u
       WHERE u.is_admin = 0
       ORDER BY usedBytes DESC`
    ).all<{ email: string; usedBytes: number }>();

    const users = (results || []).map((row) => ({
      email: row.email,
      usedBytes: row.usedBytes,
      quotaBytes,
      percentage: quotaBytes > 0 ? Math.min(100, Math.round((row.usedBytes / quotaBytes) * 1000) / 10) : 0,
    }));

    return NextResponse.json({ success: true, users, quotaBytes });
  } catch (err) {
    console.error('[admin/storage GET]', err);
    return NextResponse.json(
      { success: false, message: '获取储存用量失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const { quotaGB, verificationToken } = (await req.json()) as { quotaGB?: number; verificationToken?: string };
    if (!(await isVerificationTokenValid(verificationToken))) {
      return NextResponse.json({ success: false, message: '请先完成邮箱验证码验证，再修改设置。' }, { status: 403 });
    }
    if (typeof quotaGB !== 'number' || !Number.isFinite(quotaGB) || quotaGB <= 0) {
      return NextResponse.json({ success: false, message: '请输入一个大于 0 的数字（单位 GB）。' }, { status: 400 });
    }

    await setDefaultQuotaBytes(Math.floor(quotaGB * 1024 * 1024 * 1024));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/storage POST]', err);
    return NextResponse.json(
      { success: false, message: '保存失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
