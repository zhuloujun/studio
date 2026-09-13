// src/lib/authService.ts
// Client-side wrapper around the server API (D1 + Resend backed). No secrets
// or user data live in the browser anymore - only an httpOnly session cookie
// that the browser sends automatically with every request.
import { deleteDatabaseForUser, logoutAndClearPromises } from '@/lib/indexedDBService';
import { removeAllDataForUser } from '@/lib/localStorageService';

type ApiResult = { success: boolean; message?: string; debug?: string };

// --- Local (per-browser) cache of "who's using this browser" ---
// IMPORTANT: this is NOT a security/auth mechanism - it is only used to pick
// which local IndexedDB/localStorage namespace to read/write (per-user
// reading progress, favorites, etc. that live only in this browser). The
// actual authentication/authorization decision always comes from the
// httpOnly session cookie, verified server-side via /api/auth/me.
const CACHED_EMAIL_KEY = 'mangaTalk_cachedUserEmail';

export const getCachedUser = (): { email: string } | null => {
  if (typeof window === 'undefined') return null;
  const email = window.localStorage.getItem(CACHED_EMAIL_KEY);
  return email ? { email } : null;
};

const setCachedUser = (email: string | null) => {
  if (typeof window === 'undefined') return;
  if (email) window.localStorage.setItem(CACHED_EMAIL_KEY, email);
  else window.localStorage.removeItem(CACHED_EMAIL_KEY);
};

async function postJson<T extends ApiResult>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // fetch() itself threw - true network failure (offline, DNS, CORS block, etc.)
    return { success: false, message: `网络请求失败：${e instanceof Error ? e.message : String(e)}` } as T;
  }

  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    // The response wasn't JSON at all - likely an edge/WAF block page or an
    // unhandled crash, not something our API code produced.
    return {
      success: false,
      message: `服务器返回了非预期内容（HTTP ${res.status}），可能是 Cloudflare 安全规则拦截或函数崩溃。`,
      debug: text.slice(0, 300),
    } as T;
  }

  // Surface the temporary debug field (if the server included one) directly
  // in the message so it's visible without opening DevTools.
  if (data.debug && data.message) {
    data.message = `${data.message}（详细原因：${data.debug}）`;
  }
  return data;
}

// --- Registration (email OTP required) ---

export const requestRegisterOtp = (email: string) =>
  postJson<ApiResult>('/api/auth/register/request-otp', { email });

export const verifyRegisterOtp = async (email: string, code: string, password: string) => {
  const result = await postJson<ApiResult & { email?: string }>('/api/auth/register/verify', { email, code, password });
  if (result.success) setCachedUser(result.email || email);
  return result;
};

// --- Regular user login (no OTP) ---

export const loginUser = async (email: string, password: string) => {
  const result = await postJson<ApiResult>('/api/auth/login', { email, password });
  if (result.success) setCachedUser(email);
  return result;
};

// --- Admin login (password, then email OTP, every time) ---

export const requestAdminLoginOtp = (email: string, password: string) =>
  postJson<ApiResult>('/api/auth/admin/login', { email, password });

export const verifyAdminLoginOtp = async (email: string, code: string) => {
  const result = await postJson<ApiResult>('/api/auth/admin/verify-otp', { email, code });
  if (result.success) setCachedUser(email);
  return result;
};

// --- Change password while logged in (email OTP required, applies to both
//     regular users and the admin account) ---

export const requestPasswordChangeOtp = () => postJson<ApiResult>('/api/auth/password/request-otp');

export const changePassword = (code: string, newPassword: string) =>
  postJson<ApiResult>('/api/auth/password/change', { code, newPassword });

// --- Session ---

export const logout = async (): Promise<void> => {
  try {
    const me = await getCurrentUser();
    if (me) {
      logoutAndClearPromises(); // clear local IndexedDB connections/caches for this browser
    }
  } finally {
    setCachedUser(null);
    await postJson<ApiResult>('/api/auth/logout');
  }
};

export const getCurrentUser = async (): Promise<{ email: string } | null> => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = (await res.json()) as { user: { email: string } | null };
    return data.user ?? null;
  } catch {
    return null;
  }
};

export const isAdminSessionActive = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = (await res.json()) as { isAdmin?: boolean };
    return !!data.isAdmin;
  } catch {
    return false;
  }
};

// --- Admin management ---

export const getAllUsersForAdmin = async (): Promise<{ email: string }[]> => {
  try {
    const res = await fetch('/api/admin/users', { credentials: 'include' });
    if (!res.ok) return [];
    const data = (await res.json()) as { users?: { email: string }[] };
    return data.users ?? [];
  } catch {
    return [];
  }
};

export const deleteUserByAdmin = async (email: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = (await res.json()) as ApiResult;
    if (data.success) {
      // Best-effort cleanup of this browser's local data for that account.
      try {
        await deleteDatabaseForUser(email);
        removeAllDataForUser(email);
      } catch (e) {
        console.warn('[authService] local cleanup after delete failed', e);
      }
    }
    return data;
  } catch (error: any) {
    return { success: false, message: error?.message };
  }
};

export const getAdminLoginUrl = (): string => {
  return '/login/i1lbklewq-6b24678_vvw019-qo0liuuu_w5sc2467-8do1yyvvye7z2nnmai17yt8b13hnhm_o01-ilylcgylbgc99';
};
