"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  requestAdminLoginOtp,
  verifyAdminLoginOtp,
  checkAdminLoginSlug,
  requestAdminForgotPasswordOtp,
  resetAdminForgottenPassword,
} from '@/lib/authService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle, Loader2 } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 60;

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-center px-4">
      <h1 className="text-4xl font-bold mb-2">404</h1>
      <p className="text-muted-foreground">This page could not be found.</p>
    </div>
  );
}

export default function AdminLoginSlugPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [slugValid, setSlugValid] = useState<boolean | null>(null); // null = checking

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  // credentials -> otp (normal login) OR forgot-request -> forgot-reset (forgot password)
  const [mode, setMode] = useState<'credentials' | 'otp' | 'forgot-request' | 'forgot-reset'>('credentials');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const loginDict = dictionary.login;

  // Captcha state
  const [num1, setNum1] = useState(0);
  const [num2, setNum2] = useState(0);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const generateCaptcha = () => {
    setNum1(Math.floor(Math.random() * 10));
    setNum2(Math.floor(Math.random() * 10));
    setCaptchaAnswer('');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const valid = await checkAdminLoginSlug(params.slug);
      if (!cancelled) setSlugValid(valid);
    })();
    generateCaptcha();
    return () => {
      cancelled = true;
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, [params.slug]);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestOtp = async () => {
    setError('');
    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
      setError(loginDict.incorrectAnswer);
      generateCaptcha();
      return;
    }

    setIsSubmitting(true);
    const result = await requestAdminLoginOtp(email, password);
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收管理员邮箱中的 6 位验证码。' });
      setMode('otp');
      startCooldown();
    } else {
      setError(result.message || loginDict.loginFailed);
      toast({ variant: 'destructive', title: loginDict.loginFailed, description: result.message });
      generateCaptcha();
    }
  };

  const handleVerifyOtp = async () => {
    setError('');
    if (otpCode.length !== 6) {
      setError('请输入 6 位验证码。');
      return;
    }

    setIsSubmitting(true);
    const result = await verifyAdminLoginOtp(email, otpCode);
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: loginDict.loginSuccessful, description: loginDict.redirectingToAdmin });
      router.push('/admin/management');
    } else {
      setError(result.message || loginDict.loginFailed);
    }
  };

  const handleSendForgotOtp = async () => {
    setError('');
    setIsSubmitting(true);
    const result = await requestAdminForgotPasswordOtp();
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收管理员邮箱中的 6 位验证码。' });
      setMode('forgot-reset');
      startCooldown();
    } else {
      setError(result.message || '发送验证码失败。');
    }
  };

  const handleForgotReset = async () => {
    setError('');
    if (otpCode.length !== 6) {
      setError('请输入 6 位验证码。');
      return;
    }
    if (forgotNewPassword.length < 4) {
      setError('密码长度至少为 4 位。');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }

    setIsSubmitting(true);
    const result = await resetAdminForgottenPassword(otpCode, forgotNewPassword);
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: '密码已重置', description: '请使用新密码登录。' });
      setMode('credentials');
      setPassword('');
      setOtpCode('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      generateCaptcha();
    } else {
      setError(result.message || '重置密码失败。');
    }
  };

  if (slugValid === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (slugValid === false) {
    return <NotFound />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40">
       <div className="absolute top-8 flex items-center gap-2">
        <MangaTalkLogo className="h-8 w-8" />
        <h1 className="text-2xl font-bold text-primary">MangaTalk</h1>
      </div>
      <Card className="w-full max-w-sm">
        {mode === 'credentials' && (
          <>
            <CardHeader>
              <CardTitle>{loginDict.adminTitle}</CardTitle>
              <CardDescription>{loginDict.adminDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{loginDict.adminEmailLabel}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{commonDict.password}</Label>
                  <button
                    type="button"
                    onClick={() => { setError(''); setMode('forgot-request'); }}
                    className="text-sm text-primary hover:underline"
                  >
                    忘记密码？
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRequestOtp()}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="captcha">{loginDict.verification.replace('{num1}', String(num1)).replace('{num2}', String(num2))}</Label>
                <Input
                  id="captcha"
                  type="number"
                  placeholder={loginDict.answerPlaceholder}
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRequestOtp()}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleRequestOtp} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '验证中...' : '验证密码并发送验证码'}
              </Button>
            </CardContent>
          </>
        )}

        {mode === 'otp' && (
          <>
            <CardHeader>
              <CardTitle>{loginDict.adminTitle}</CardTitle>
              <CardDescription>管理员每次登录都需要邮箱验证码</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp-code">邮箱验证码</Label>
                <Input
                  id="otp-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleVerifyOtp} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '登录中...' : dictionary.nav.login}
              </Button>
              <Button
                variant="link"
                type="button"
                className="w-full"
                disabled={cooldown > 0 || isSubmitting}
                onClick={handleRequestOtp}
              >
                {cooldown > 0 ? `重新发送 (${cooldown}s)` : '没收到？重新发送验证码'}
              </Button>
              <Button variant="ghost" type="button" className="w-full" onClick={() => { setMode('credentials'); setOtpCode(''); setError(''); }}>
                返回重新输入密码
              </Button>
            </CardContent>
          </>
        )}

        {mode === 'forgot-request' && (
          <>
            <CardHeader>
              <CardTitle>找回管理员密码</CardTitle>
              <CardDescription>验证码将发送到管理员邮箱。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleSendForgotOtp} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '发送中...' : '发送邮箱验证码'}
              </Button>
              <Button variant="ghost" type="button" className="w-full" onClick={() => { setMode('credentials'); setError(''); }}>
                返回登录
              </Button>
            </CardContent>
          </>
        )}

        {mode === 'forgot-reset' && (
          <>
            <CardHeader>
              <CardTitle>重置管理员密码</CardTitle>
              <CardDescription>请输入邮箱验证码和新密码。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-otp-code">邮箱验证码</Label>
                <Input
                  id="forgot-otp-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-new-password">{commonDict.newPassword}</Label>
                <Input
                  id="forgot-new-password"
                  type="password"
                  value={forgotNewPassword}
                  onChange={(e) => setForgotNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-confirm-password">{commonDict.confirmNewPassword}</Label>
                <Input
                  id="forgot-confirm-password"
                  type="password"
                  value={forgotConfirmPassword}
                  onChange={(e) => setForgotConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleForgotReset()}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleForgotReset} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '提交中...' : '重置密码'}
              </Button>
              <Button
                variant="link"
                type="button"
                className="w-full"
                disabled={cooldown > 0 || isSubmitting}
                onClick={handleSendForgotOtp}
              >
                {cooldown > 0 ? `重新发送 (${cooldown}s)` : '没收到？重新发送验证码'}
              </Button>
              <Button variant="ghost" type="button" className="w-full" onClick={() => { setMode('credentials'); setOtpCode(''); setError(''); }}>
                返回登录
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
