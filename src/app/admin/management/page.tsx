"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AdminAuthGuard } from '@/components/auth/AuthGuard';
import {
  getAllUsersForAdmin,
  deleteUserByAdmin,
  getAdminLoginUrl,
  requestPasswordChangeOtp,
  changePassword,
} from '@/lib/authService';
import { Trash2, Users, KeyRound, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 60;

function AdminManagementPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<{ email: string }[]>([]);
  const [userToDelete, setUserToDelete] = useState<{email: string} | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [adminLoginUrl, setAdminLoginUrl] = useState('');

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const adminDict = dictionary.admin;

  const refreshUsers = async () => setUsers(await getAllUsersForAdmin());

  useEffect(() => {
    refreshUsers();
    setAdminLoginUrl(getAdminLoginUrl());
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

  const performDelete = async () => {
    if (!userToDelete) return;

    const result = await deleteUserByAdmin(userToDelete.email);

    if (result.success) {
      toast({ title: adminDict.userDeleted, description: adminDict.userDeletedMessage.replace('{email}', userToDelete.email) });
      await refreshUsers();
    } else {
      toast({
        variant: 'destructive',
        title: adminDict.errorDeletingUser,
        description: result.message || 'An unknown error occurred.'
      });
    }
    setUserToDelete(null);
  };

  const handleRequestOtp = async () => {
    if (newAdminPassword.length < 4) {
      toast({ variant: 'destructive', title: commonDict.error, description: dictionary.register.passwordLengthError });
      return;
    }
    setIsSending(true);
    const result = await requestPasswordChangeOtp();
    setIsSending(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收管理员邮箱中的 6 位验证码。' });
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
    const result = await changePassword(otpCode, newAdminPassword);
    setIsSubmitting(false);

    if (result.success) {
      toast({ title: commonDict.success, description: adminDict.adminPasswordUpdated });
      setNewAdminPassword('');
      setOtpCode('');
      setOtpRequested(false);
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || adminDict.failedToUpdateAdminPassword });
    }
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{adminDict.title}</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users />{adminDict.userManagement}</CardTitle>
            <CardDescription>{adminDict.userManagementDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length > 0 ? (
                <ul className="space-y-2">
                {users.map(user => (
                    <li key={user.email} className="flex items-center justify-between p-2 border rounded-md">
                    <span>{user.email}</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setUserToDelete(user)}
                        aria-label={`Delete user ${user.email}`}
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    </li>
                ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">{adminDict.noOtherUsers}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound />{adminDict.adminSettings}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="admin-password">{adminDict.changeAdminPassword}（需要邮箱验证码）</Label>
              <Input
                id="admin-password"
                type="password"
                value={newAdminPassword}
                onChange={e => setNewAdminPassword(e.target.value)}
                placeholder={adminDict.newAdminPasswordPlaceholder}
                disabled={otpRequested}
              />
              {!otpRequested ? (
                <Button onClick={handleRequestOtp} className="mt-2" disabled={isSending}>
                  {isSending ? '发送中...' : '发送邮箱验证码'}
                </Button>
              ) : (
                <div className="mt-2 space-y-2">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位验证码"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  />
                  <div className="flex gap-2">
                    <Button onClick={handlePasswordChange} disabled={isSubmitting}>
                      {isSubmitting ? '提交中...' : adminDict.savePassword}
                    </Button>
                    <Button variant="link" disabled={cooldown > 0 || isSending} onClick={handleRequestOtp}>
                      {cooldown > 0 ? `重新发送 (${cooldown}s)` : '重新发送'}
                    </Button>
                    <Button variant="ghost" onClick={() => { setOtpRequested(false); setOtpCode(''); }}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="admin-url">{adminDict.adminLoginURL}</Label>
              <Input
                id="admin-url"
                type="text"
                value={adminLoginUrl}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> {adminDict.urlNotChangeable}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!userToDelete} onOpenChange={(isOpen) => !isOpen && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
            <AlertDialogDescription>
              {commonDict.actionCannotBeUndone} {adminDict.deleteUserConfirmation.replace('{email}', userToDelete?.email || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonDict.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>{commonDict.continue}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminManagementPageWrapper() {
  return (
    <AdminAuthGuard>
      <AdminManagementPage />
    </AdminAuthGuard>
  );
}
