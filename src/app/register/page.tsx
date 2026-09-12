"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { requestRegisterOtp, verifyRegisterOtp } from '@/lib/authService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 60;

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const loginDict = dictionary.login;
  const registerDict = dictionary.register;

  // Captcha state (kept as a first line of anti-bot defense before we even send an OTP)
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

  const handleSendOtp = async () => {
    setError('');

    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
      setError(loginDict.incorrectAnswer);
      generateCaptcha();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址。');
      return;
    }
    if (password !== confirmPassword) {
      setError(registerDict.passwordsDoNotMatch);
      return;
    }
    if (password.length < 4) {
      setError(registerDict.passwordLengthError);
      return;
    }

    setIsSending(true);
    const result = await requestRegisterOtp(email);
    setIsSending(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收邮箱中的 6 位验证码。' });
      setStep('otp');
      startCooldown();
    } else {
      setError(result.message || '发送验证码失败。');
      generateCaptcha();
    }
  };

  const handleVerifyAndRegister = async () => {
    setError('');
    if (otpCode.length !== 6) {
      setError('请输入 6 位验证码。');
      return;
    }

    setIsSubmitting(true);
    const result = await verifyRegisterOtp(email, otpCode, password);
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: registerDict.registrationSuccessful, description: registerDict.pleaseLogin });
      router.push('/library');
    } else {
      setError(result.message || '注册失败。');
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
          <CardTitle>{registerDict.title}</CardTitle>
          <CardDescription>{step === 'form' ? registerDict.description : '请输入发送到您邮箱的验证码以完成注册'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'form' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">{commonDict.email}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="me@example.com"
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
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{commonDict.confirmNewPassword}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleSendOtp} className="w-full" disabled={isSending}>
                {isSending ? '发送中...' : '发送邮箱验证码'}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{commonDict.email}</Label>
                <Input value={email} readOnly disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="otp-code">邮箱验证码</Label>
                <Input
                  id="otp-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyAndRegister()}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
              <Button onClick={handleVerifyAndRegister} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '注册中...' : registerDict.createAccount}
              </Button>
              <Button
                variant="link"
                type="button"
                className="w-full"
                disabled={cooldown > 0 || isSending}
                onClick={handleSendOtp}
              >
                {cooldown > 0 ? `重新发送 (${cooldown}s)` : '没收到？重新发送验证码'}
              </Button>
              <Button variant="ghost" type="button" className="w-full" onClick={() => { setStep('form'); setOtpCode(''); setError(''); }}>
                返回修改邮箱
              </Button>
            </>
          )}
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {registerDict.alreadyHaveAccount}{' '}
            <Link href="/login" className="text-primary hover:underline">
              {registerDict.loginLink}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
