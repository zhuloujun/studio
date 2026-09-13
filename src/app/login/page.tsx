
"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { loginUser, requestForgotPasswordOtp, resetForgottenPassword } from '@/lib/authService';
import * as LocalStorageService from '@/lib/localStorageService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 60;

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');

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
    const rememberedEmail = LocalStorageService.getRememberedEmail();
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
    generateCaptcha();
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Forgot password state ---
  const [mode, setMode] = useState<'login' | 'forgot-request' | 'forgot-reset'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [isSendingForgotOtp, setIsSendingForgotOtp] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, []);

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

  const handleLogin = async () => {
    setError('');

    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
        setError(loginDict.incorrectAnswer);
        generateCaptcha();
        return;
    }

    setIsSubmitting(true);
    const result = await loginUser(email, password);
    setIsSubmitting(false);
    if (result.success) {
      if (rememberMe) {
        LocalStorageService.saveRememberedEmail(email);
      } else {
        LocalStorageService.clearRememberedEmail();
      }
      toast({ title: loginDict.loginSuccessful });
      router.push('/library');
    } else {
      setError(result.message || loginDict.loginFailed);
      generateCaptcha();
    }
  };

  const openForgotPassword = () => {
    setForgotEmail(email); // pre-fill with whatever they already typed
    setForgotError('');
    setMode('forgot-request');
  };

  const handleSendForgotOtp = async () => {
    setForgotError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) {
      setForgotError('请输入有效的邮箱地址。');
      return;
    }

    setIsSendingForgotOtp(true);
    const result = await requestForgotPasswordOtp(forgotEmail);
    setIsSendingForgotOtp(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: result.message });
      setMode('forgot-reset');
      startCooldown();
    } else {
      setForgotError(result.message || '发送验证码失败。');
    }
  };

  const handleResetPassword = async () => {
    setForgotError('');
    if (forgotCode.length !== 6) {
      setForgotError('请输入 6 位验证码。');
      return;
    }
    if (forgotNewPassword.length < 4) {
      setForgotError('密码长度至少为 4 位。');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('两次输入的密码不一致。');
      return;
    }

    setIsResettingPassword(true);
    const result = await resetForgottenPassword(forgotEmail, forgotCode, forgotNewPassword);
    setIsResettingPassword(false);

    if (result.success) {
      toast({ title: '密码已重置', description: '请使用新密码登录。' });
      setEmail(forgotEmail);
      setPassword('');
      setMode('login');
      setForgotCode('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      generateCaptcha();
    } else {
      setForgotError(result.message || '重置密码失败。');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40">
      <div className="absolute top-8 flex items-center gap-2">
        <MangaTalkLogo className="h-8 w-8" />
        <h1 className="text-2xl font-bold text-primary">MangaTalk</h1>
      </div>
      <Card className="w-full max-w-sm">
        {mode === 'login' ? (
          <>
            <CardHeader>
              <CardTitle>{loginDict.title}</CardTitle>
              <CardDescription>{loginDict.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{commonDict.email}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={loginDict.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{commonDict.password}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
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
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  required
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox id="remember-me" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(Boolean(checked))} />
                  <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer">{loginDict.rememberEmail}</Label>
                </div>
                <button
                  type="button"
                  onClick={openForgotPassword}
                  className="text-sm text-primary hover:underline"
                >
                  忘记密码？
                </button>
              </div>
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleLogin} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '登录中...' : dictionary.nav.login}
              </Button>
            </CardContent>
            <CardFooter className="flex justify-center">
              <p className="text-sm text-muted-foreground">
                {loginDict.dontHaveAccount}{' '}
                <Link href="/register" className="text-primary hover:underline">
                  {loginDict.registerLink}
                </Link>
              </p>
            </CardFooter>
          </>
        ) : mode === 'forgot-request' ? (
          <>
            <CardHeader>
              <CardTitle>找回密码</CardTitle>
              <CardDescription>输入注册时使用的邮箱，我们会发送验证码用于重置密码。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">{commonDict.email}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendForgotOtp()}
                  required
                />
              </div>
              {forgotError && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{forgotError}</p>}
              <Button onClick={handleSendForgotOtp} className="w-full" disabled={isSendingForgotOtp}>
                {isSendingForgotOtp ? '发送中...' : '发送邮箱验证码'}
              </Button>
              <Button variant="ghost" type="button" className="w-full" onClick={() => setMode('login')}>
                返回登录
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>重置密码</CardTitle>
              <CardDescription>请输入发送到 {forgotEmail} 的验证码和新密码。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-code">邮箱验证码</Label>
                <Input
                  id="forgot-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={forgotCode}
                  onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, ''))}
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
                  onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                  required
                />
              </div>
              {forgotError && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{forgotError}</p>}
              <Button onClick={handleResetPassword} className="w-full" disabled={isResettingPassword}>
                {isResettingPassword ? '提交中...' : '重置密码'}
              </Button>
              <Button
                variant="link"
                type="button"
                className="w-full"
                disabled={cooldown > 0 || isSendingForgotOtp}
                onClick={handleSendForgotOtp}
              >
                {cooldown > 0 ? `重新发送 (${cooldown}s)` : '没收到？重新发送验证码'}
              </Button>
              <Button variant="ghost" type="button" className="w-full" onClick={() => { setMode('login'); setForgotCode(''); setForgotError(''); }}>
                返回登录
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
