// src/lib/storageQuota.ts
// Server-only. Tracks and enforces each user's total R2 storage usage
// (documents + media combined) against a quota, so one account uploading
// unbounded amounts of large files can't run up the site's storage bill or
// exhaust resources for everyone else.
import { getEnv } from '@/lib/cloudflare';
import { getSetting, setSetting } from '@/lib/adminSettings';

export const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

export async function getDefaultQuotaBytes(): Promise<number> {
  const value = await getSetting('default_storage_quota_bytes');
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTA_BYTES;
}

export async function setDefaultQuotaBytes(bytes: number): Promise<void> {
  await setSetting('default_storage_quota_bytes', String(Math.max(1, Math.floor(bytes))));
}

export async function getUserUsageBytes(userId: string): Promise<number> {
  const env = getEnv();
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(size_bytes), 0) FROM documents WHERE user_id = ?1) +
       (SELECT COALESCE(SUM(size_bytes), 0) FROM media_items WHERE user_id = ?1) AS total`
  )
    .bind(userId)
    .first<{ total: number }>();
  return row?.total || 0;
}

/** Throws a user-facing error if uploading `additionalBytes` more would exceed the user's quota. */
export async function assertWithinQuota(userId: string, additionalBytes: number): Promise<void> {
  const [usage, quota] = await Promise.all([getUserUsageBytes(userId), getDefaultQuotaBytes()]);
  if (usage + additionalBytes > quota) {
    const usageGB = (usage / (1024 * 1024 * 1024)).toFixed(2);
    const quotaGB = (quota / (1024 * 1024 * 1024)).toFixed(2);
    throw new Error(
      `已超出存储空间限额（已用 ${usageGB}GB / 共 ${quotaGB}GB），请先删除一些文档或媒体文件再试。`
    );
  }
}
