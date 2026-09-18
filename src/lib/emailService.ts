// src/lib/emailService.ts
// Server-only. Sends transactional email via the Resend HTTP API.
import { getEnv } from '@/lib/cloudflare';

export type OtpPurpose =
  | 'register'
  | 'reset_password'
  | 'admin_login'
  | 'admin_reset_password'
  | 'change_admin_login_url'
  | 'admin_settings_change';

const SUBJECTS: Record<OtpPurpose, string> = {
  register: 'MangaTalk 注册验证码',
  reset_password: 'MangaTalk 修改密码验证码',
  admin_login: 'MangaTalk 管理员登录验证码',
  admin_reset_password: 'MangaTalk 管理员找回密码验证码',
  change_admin_login_url: 'MangaTalk 修改管理员登录地址验证码',
  admin_settings_change: 'MangaTalk 后台设置修改验证码',
};

const BODIES: Record<OtpPurpose, (code: string) => string> = {
  register: (code) => `您的注册验证码是 <b>${code}</b>，10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。`,
  reset_password: (code) => `您正在修改密码，验证码是 <b>${code}</b>，10 分钟内有效。如果这不是您本人的操作，请忽略此邮件并尽快检查账户安全。`,
  admin_login: (code) => `管理员登录验证码是 <b>${code}</b>，10 分钟内有效。如果这不是您本人的操作，请立即检查后台安全。`,
  admin_reset_password: (code) => `您正在找回管理员密码，验证码是 <b>${code}</b>，10 分钟内有效。如果这不是您本人的操作，请立即检查后台安全。`,
  change_admin_login_url: (code) => `您正在修改管理员后台登录地址，验证码是 <b>${code}</b>，10 分钟内有效。如果这不是您本人的操作，请立即检查后台安全。`,
  admin_settings_change: (code) => `您正在修改后台设置（文献库链接、存储限额等），验证码是 <b>${code}</b>，10 分钟内有效。如果这不是您本人的操作，请立即检查后台安全。`,
};

export async function sendOtpEmail(email: string, code: string, purpose: OtpPurpose): Promise<void> {
  const env = getEnv();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: email,
      subject: SUBJECTS[purpose],
      html: `<p>${BODIES[purpose](code)}</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend 邮件发送失败 (${res.status}): ${text}`);
  }
}
