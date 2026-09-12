"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { getCurrentUser, requestPasswordChangeOtp, changePassword } from '@/lib/authService';
import { KeyRound, User as UserIcon } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 60;

function ProfilePageContent() {
  const { toast } = useToast();
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const profileDict = dictionary.profile;

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (user) setCurrentUserEmail(user.email);
    })();
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
    if (newPassword.length < 4) {
      toast({ variant: 'destructive', title: commonDict.error, description: dictionary.register.passwordLengthError });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: commonDict.error, description: profileDict.passwordsMismatch });
      return;
    }

    setIsSending(true);
    const result = await requestPasswordChangeOtp();
    setIsSending(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收邮箱中的 6 位验证码。' });
      setOtpRequested(true);
      startCooldown();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message });
    }
  };

  const handlePasswordChange = async () => {
    if (otpCode.length !== 6) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请输入 6 位验证码。' });
      return;
    }

    setIsSubmitting(true);
    const result = await changePassword(otpCode, newPassword);
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: commonDict.success, description: profileDict.passwordUpdated });
      setNewPassword('');
      setConfirmPassword('');
      setOtpCode('');
      setOtpRequested(false);
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || profileDict.passwordUpdateFailed });
    }
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">{profileDict.title}</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserIcon />{profileDict.yourInformation}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>{commonDict.email}</Label>
              <Input value={currentUserEmail} readOnly disabled />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound />{profileDict.changePassword}</CardTitle>
            <CardDescription>{profileDict.changePasswordDescription}（需要邮箱验证码）</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{commonDict.newPassword}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={commonDict.newPassword}
                disabled={otpRequested}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{commonDict.confirmNewPassword}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={commonDict.confirmNewPassword}
                disabled={otpRequested}
              />
            </div>

            {!otpRequested ? (
              <Button onClick={handleRequestOtp} disabled={isSending}>
                {isSending ? '发送中...' : '发送邮箱验证码'}
              </Button>
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
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handlePasswordChange} disabled={isSubmitting}>
                    {isSubmitting ? '提交中...' : profileDict.saveNewPassword}
                  </Button>
                  <Button variant="link" disabled={cooldown > 0 || isSending} onClick={handleRequestOtp}>
                    {cooldown > 0 ? `重新发送 (${cooldown}s)` : '重新发送验证码'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setOtpRequested(false); setOtpCode(''); }}>
                    取消
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function ProfilePage() {
    return (
        <AuthGuard>
            <ProfilePageContent />
        </AuthGuard>
    )
}
