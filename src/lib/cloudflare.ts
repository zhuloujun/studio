// src/lib/cloudflare.ts
// Helper to access Cloudflare bindings (D1, R2, env vars/secrets) from
// Next.js Route Handlers running on Cloudflare via the OpenNext adapter
// (@opennextjs/cloudflare). Bindings are declared in wrangler.toml.

import { getCloudflareContext } from '@opennextjs/cloudflare';

export interface CloudflareEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  // Secret: set with `npx wrangler secret put RESEND_API_KEY`
  // or via the Cloudflare dashboard -> Settings -> Variables and Secrets.
  RESEND_API_KEY: string;
  // Plain vars, safe to keep in wrangler.toml [vars]
  ADMIN_EMAIL: string;
  RESEND_FROM_EMAIL: string;
  // Optional: enables the CORE literature source in /api/external-search
  // when set. Free key from https://core.ac.uk/services/api - the feature
  // just silently skips CORE results if this isn't configured.
  CORE_API_KEY?: string;
  // Optional: without this, Semantic Scholar search shares the same public
  // rate-limit pool as every other unauthenticated request on the internet,
  // and gets silently throttled/empty-results fairly often. Free key from
  // https://www.semanticscholar.org/product/api#api-key.
  SEMANTIC_SCHOLAR_API_KEY?: string;
}

/**
 * Wraps getCloudflareContext() with clearer, distinguishable error messages
 * so that a 500 response tells us exactly which piece of Cloudflare
 * configuration is missing, instead of a generic "undefined" crash.
 */
export function getEnv(): CloudflareEnv {
  let env: Partial<CloudflareEnv>;
  try {
    env = getCloudflareContext().env as unknown as Partial<CloudflareEnv>;
  } catch (e) {
    throw new Error(
      `CONFIG_ERROR: 无法获取 Cloudflare 运行环境 (getCloudflareContext 失败: ${
        e instanceof Error ? e.message : String(e)
      })。`
    );
  }

  if (!env.DB) {
    throw new Error('CONFIG_ERROR: 缺少 D1 数据库绑定 (变量名应为 DB)，请检查 wrangler.toml 或 Cloudflare 项目的 D1 绑定设置。');
  }
  if (!env.RESEND_API_KEY) {
    throw new Error('CONFIG_ERROR: 缺少 RESEND_API_KEY 环境变量/密钥，请检查 Cloudflare 项目的 Variables and Secrets。');
  }
  if (!env.ADMIN_EMAIL) {
    throw new Error('CONFIG_ERROR: 缺少 ADMIN_EMAIL 环境变量。');
  }
  if (!env.RESEND_FROM_EMAIL) {
    throw new Error('CONFIG_ERROR: 缺少 RESEND_FROM_EMAIL 环境变量。');
  }

  return env as CloudflareEnv;
}
