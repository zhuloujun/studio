"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { requestAdminLoginOtp, verifyAdminLoginOtp } from '@/lib/authService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 60;

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
    generateCaptcha();
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
      setStep('otp');
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40">
       <div className="absolute top-8 flex items-center gap-2">
        <MangaTalkLogo className="h-8 w-8" />
        <h1 className="text-2xl font-bold text-primary">MangaTalk</h1>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{loginDict.adminTitle}</CardTitle>
          <CardDescription>{step === 'credentials' ? loginDict.adminDescription : '管理员每次登录都需要邮箱验证码'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'credentials' ? (
            <>
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
                <Label htmlFor="password">{commonDict.password}</Label>
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
            </>
          ) : (
            <>
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
              <Button variant="ghost" type="button" className="w-full" onClick={() => { setStep('credentials'); setOtpCode(''); setError(''); }}>
                返回重新输入密码
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
